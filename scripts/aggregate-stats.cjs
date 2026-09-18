const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');

function getAntigravityDir() {
  return process.env.ANTIGRAVITY_DATA_DIR || path.join(os.homedir(), '.gemini', 'antigravity');
}

// In-memory incremental cache for unmodified databases
const dbCache = new Map();
const transcriptCache = new Map();
let lastScanTime = 0;
let lastAggregatedStats = null;
const FAST_SCAN_TTL = 300; // 300ms throttle for back-to-back incremental calls
const PERSIST_CACHE_VERSION = 3;
const CACHE_FLUSH_DELAY_MS = 50;
const CACHE_LOCK_MAX_AGE_MS = 10000;
let cacheDirty = false;
let cacheFlushTimer = null;
let cacheWarningLogged = false;

function isPersistentCacheDisabled() {
  return process.env.ANTIGRAVITY_DISABLE_PERSIST_CACHE === '1';
}

function getCacheFilePath() {
  return process.env.ANTIGRAVITY_STATS_CACHE_PATH || path.join(getAntigravityDir(), 'stats-cache.json');
}

function normalizePath(value) {
  return path.normalize(path.resolve(value));
}

function getFileFingerprint(filePath, includeWal = false) {
  const stat = fs.statSync(filePath);
  if (!includeWal) {
    return { mtimeMs: stat.mtimeMs, size: stat.size };
  }

  let wal = null;
  try {
    const walStat = fs.statSync(`${filePath}-wal`);
    wal = { mtimeMs: walStat.mtimeMs, size: walStat.size };
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  return { db: { mtimeMs: stat.mtimeMs, size: stat.size }, wal };
}

function fingerprintsEqual(left, right) {
  return Boolean(left && right) &&
    left.mtimeMs === right.mtimeMs &&
    left.size === right.size &&
    (!left.db || (
      left.db.mtimeMs === right.db?.mtimeMs &&
      left.db.size === right.db?.size &&
      (left.wal?.mtimeMs || null) === (right.wal?.mtimeMs || null) &&
      (left.wal?.size || null) === (right.wal?.size || null)
    ));
}

function markCacheDirty() {
  if (isPersistentCacheDisabled()) return;
  cacheDirty = true;
  scheduleCacheFlush();
}

function hydrateCacheFromDisk() {
  if (isPersistentCacheDisabled()) return;

  const cachePath = getCacheFilePath();
  try {
    if (!fs.existsSync(cachePath)) return;
    const snapshot = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    if (snapshot.version !== PERSIST_CACHE_VERSION || normalizePath(snapshot.dataRoot) !== normalizePath(getAntigravityDir())) {
      return;
    }

    const conversationsDir = path.join(getAntigravityDir(), 'conversations');
    for (const entry of Object.values(snapshot.dbs || {})) {
      if (!entry?.file || !entry.fingerprint || !entry.metrics) continue;
      const filePath = path.resolve(conversationsDir, entry.file);
      if (path.relative(conversationsDir, filePath).startsWith('..') || !filePath.endsWith('.db')) continue;
      dbCache.set(filePath, {
        ...entry.metrics,
        fingerprint: entry.fingerprint,
        mtimeMs: entry.fingerprint.db?.mtimeMs,
      });
    }

    const brainDir = path.join(getAntigravityDir(), 'brain');
    for (const entry of Object.values(snapshot.transcripts || {})) {
      if (!entry?.sessionId || !entry.fingerprint || !entry.metrics) continue;
      const transcriptPath = path.resolve(brainDir, entry.sessionId, '.system_generated', 'logs', 'transcript.jsonl');
      if (path.relative(brainDir, transcriptPath).startsWith('..')) continue;
      const metrics = entry.metrics;
      transcriptCache.set(transcriptPath, {
        fingerprint: entry.fingerprint,
        mtimeMs: entry.fingerprint.mtimeMs,
        dailyMap: new Map(metrics.dailyMap || []),
        skills: new Set(metrics.skills || []),
        generationDates: metrics.generationDates || [],
        duration: metrics.duration || 0,
      });
    }
  } catch (err) {
    if (!cacheWarningLogged) {
      cacheWarningLogged = true;
      console.warn(`[Stats] Ignoring invalid persistent cache at ${cachePath}: ${err.message}`);
    }
  }
}

function serializeCache() {
  const agDir = getAntigravityDir();
  const conversationsDir = path.join(agDir, 'conversations');
  const brainDir = path.join(agDir, 'brain');
  const dbs = {};
  const transcripts = {};

  for (const [filePath, entry] of dbCache) {
    if (!entry.fingerprint) continue;
    const file = path.relative(conversationsDir, filePath);
    if (!file || file.startsWith('..')) continue;
    dbs[path.basename(file, '.db')] = {
      file,
      fingerprint: entry.fingerprint,
      metrics: {
        modelCalls: entry.modelCalls,
        toolCalls: entry.toolCalls,
        fastModeCalls: entry.fastModeCalls,
        sessionInputTokens: entry.sessionInputTokens,
        sessionOutputTokens: entry.sessionOutputTokens,
        sessionCacheReadTokens: entry.sessionCacheReadTokens,
        sessionThinkingTokens: entry.sessionThinkingTokens,
        sessionResponseTokens: entry.sessionResponseTokens,
        sessionSkills: entry.sessionSkills,
        sessionSkillsCount: entry.sessionSkillsCount,
        sessionModels: entry.sessionModels,
        generationUsages: entry.generationUsages,
      },
    };
  }

  for (const [transcriptPath, entry] of transcriptCache) {
    if (!entry.fingerprint) continue;
    const relative = path.relative(brainDir, transcriptPath);
    const parts = relative.split(path.sep);
    if (parts.length < 4) continue;
    transcripts[parts[0]] = {
      sessionId: parts[0],
      fingerprint: entry.fingerprint,
      metrics: {
        dailyMap: Array.from(entry.dailyMap.entries()),
        skills: Array.from(entry.skills),
        generationDates: entry.generationDates,
        duration: entry.duration,
      },
    };
  }

  return {
    version: PERSIST_CACHE_VERSION,
    dataRoot: normalizePath(agDir),
    updatedAt: new Date().toISOString(),
    dbs,
    transcripts,
  };
}

function persistCacheToDisk() {
  if (isPersistentCacheDisabled() || !cacheDirty) return;

  const cachePath = getCacheFilePath();
  const lockPath = `${cachePath}.lock`;
  // ponytail: one cache-wide lock; split per session only if concurrent writers become measurable.
  let lockFd = null;
  let tempPath = null;
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    try {
      lockFd = fs.openSync(lockPath, 'wx');
    } catch (err) {
      if (err.code === 'EEXIST') {
        try {
          if (Date.now() - fs.statSync(lockPath).mtimeMs > CACHE_LOCK_MAX_AGE_MS) fs.unlinkSync(lockPath);
          lockFd = fs.openSync(lockPath, 'wx');
        } catch {}
      }
      if (lockFd === null) return;
    }

    const serialized = JSON.stringify(serializeCache());
    tempPath = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, serialized, 'utf8');

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        fs.renameSync(tempPath, cachePath);
        tempPath = null;
        cacheDirty = false;
        return;
      } catch (err) {
        if (!['EEXIST', 'EPERM', 'EBUSY'].includes(err.code) || attempt === 2) throw err;
        try { fs.unlinkSync(cachePath); } catch {}
      }
    }
  } catch (err) {
    if (!cacheWarningLogged) {
      cacheWarningLogged = true;
      console.warn(`[Stats] Persistent cache write failed: ${err.message}`);
    }
  } finally {
    if (tempPath) {
      try { fs.unlinkSync(tempPath); } catch {}
    }
    if (lockFd !== null) {
      try { fs.closeSync(lockFd); } catch {}
      try { fs.unlinkSync(lockPath); } catch {}
    }
  }
}

function scheduleCacheFlush() {
  if (isPersistentCacheDisabled() || cacheFlushTimer || !cacheDirty) return;
  cacheFlushTimer = setTimeout(() => {
    cacheFlushTimer = null;
    persistCacheToDisk();
  }, CACHE_FLUSH_DELAY_MS);
}

hydrateCacheFromDisk();

// Pure JS zero-dependency Protobuf decoder for SQLite gen_metadata BLOBs
function decodeVarint(buf, offset) {
  let res = 0n;
  let shift = 0n;
  let pos = offset;
  while (pos < buf.length) {
    const b = buf[pos++];
    res |= BigInt(b & 0x7f) << shift;
    shift += 7n;
    if ((b & 0x80) === 0 || shift >= 70n) break;
  }
  return { val: Number(res), nextOffset: pos };
}

function parseProtoFields(buf) {
  const fields = new Map();
  let offset = 0;
  while (offset < buf.length) {
    const { val: tagVal, nextOffset } = decodeVarint(buf, offset);
    if (nextOffset <= offset) break;
    offset = nextOffset;
    const wireType = tagVal & 7;
    const fieldNum = tagVal >> 3;
    if (fieldNum <= 0) break;
    if (wireType === 0) {
      const { val, nextOffset: no } = decodeVarint(buf, offset);
      offset = no;
      fields.set(fieldNum, val);
    } else if (wireType === 2) {
      const { val: len, nextOffset: no } = decodeVarint(buf, offset);
      offset = no;
      const sub = buf.subarray(offset, offset + Math.max(0, len));
      offset += Math.max(0, len);
      if (!Array.isArray(fields.get(fieldNum))) fields.set(fieldNum, []);
      fields.get(fieldNum).push(sub);
    } else if (wireType === 1) {
      offset += 8;
    } else if (wireType === 5) {
      offset += 4;
    } else {
      break;
    }
  }
  return fields;
}

// Tag 1.4: ModelUsageStats (input_tokens 1.4.2, cache_read_tokens 1.4.5, output_tokens 1.4.3, thinking_output_tokens 1.4.9, response_output_tokens 1.4.10)
// Tag 1.19: Model Name (e.g. gemini-3.8-flash)
function decodeGenMetadata(buf) {
  try {
    const top = parseProtoFields(buf);
    const msg1 = top.get(1);
    if (!msg1 || !msg1[0]) return null;

    const f1 = parseProtoFields(msg1[0]);
    let modelName = '';
    const m19 = f1.get(19);
    if (m19 && m19[0]) {
      modelName = m19[0].toString('utf8');
    }

    const msg1_4 = f1.get(4);
    if (!msg1_4 || !msg1_4[0]) {
      return { modelName, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, thinkingTokens: 0, responseTokens: 0 };
    }

    const usage = parseProtoFields(msg1_4[0]);
    const inputTokens = usage.get(2) || 0;
    const outputTokens = usage.get(3) || 0;
    const cacheReadTokens = usage.get(5) || 0;
    const thinkingTokens = usage.get(9) || 0;
    const responseTokens = usage.get(10) || (outputTokens - thinkingTokens);

    return {
      modelName,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      thinkingTokens,
      responseTokens,
    };
  } catch {
    return null;
  }
}

function pairGenerationDates(generationUsages, generationDates, fallbackDateKey) {
  if (!generationUsages || generationUsages.length === 0) {
    return [];
  }

  const hasDates = Array.isArray(generationDates) && generationDates.length > 0;
  const lastDate = hasDates ? generationDates[generationDates.length - 1] : fallbackDateKey;
  return generationUsages.map((usage, index) => ({
    usage,
    date: (hasDates && index < generationDates.length)
      ? generationDates[index]
      : (lastDate || fallbackDateKey),
  }));
}

function toLocalDateKey(input) {
  const d = input instanceof Date ? input : new Date(input);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function createEmptyStats() {
  return {
    kpis: {
      lifetimeTokens: '0',
      lifetimeTokensRaw: 0,
      peakTokens: '0',
      longestTask: '—',
      currentStreak: 0,
      longestStreak: 0,
    },
    activity: { heatmap: [], activeDaysCount: 0, totalTasks: 0 },
    insights: { fastMode: '—', mostUsedReasoning: '—', skillsExplored: 0, totalSkillsUsed: 0, totalThreads: 0 },
    tokenBreakdown: {
      inputTokens: 0,
      inputTokensFormatted: '0',
      cacheReadTokens: 0,
      cacheReadTokensFormatted: '0',
      totalPromptTokens: 0,
      totalPromptTokensFormatted: '0',
      cacheHitRate: '0%',
      outputTokens: 0,
      outputTokensFormatted: '0',
      thinkingTokens: 0,
      thinkingTokensFormatted: '0',
      responseTokens: 0,
      responseTokensFormatted: '0',
      reasoningPct: 0,
    },
    meta: { scannedConversations: 0, updatedAt: new Date().toISOString(), hasStaleSessions: false },
  };
}

function computeStats(force = false) {
  const nowMs = Date.now();
  if (!force && lastAggregatedStats && nowMs - lastScanTime < FAST_SCAN_TTL) {
    return lastAggregatedStats;
  }

  const agDir = getAntigravityDir();

  // Self-check #1: Data directory existence
  if (!fs.existsSync(agDir)) {
    console.error(`[Stats] ERROR: Antigravity data directory not found at: ${agDir}`);
    console.error(`[Stats] Have you used Antigravity 2.0 yet? The directory is created on first use.`);
    return createEmptyStats();
  }

  const convDir = path.join(agDir, 'conversations');
  const brainDir = path.join(agDir, 'brain');

  const dbFiles = fs.existsSync(convDir)
    ? fs.readdirSync(convDir).filter(f => f.endsWith('.db'))
    : [];
  const brainFolders = fs.existsSync(brainDir) ? fs.readdirSync(brainDir) : [];
  const currentDbPaths = new Set(dbFiles.map(file => path.join(convDir, file)));
  const currentTranscriptPaths = new Set(
    brainFolders.map(folder => path.join(brainDir, folder, '.system_generated', 'logs', 'transcript.jsonl'))
  );

  for (const filePath of dbCache.keys()) {
    if (!currentDbPaths.has(filePath)) {
      dbCache.delete(filePath);
      markCacheDirty();
    }
  }
  for (const transcriptPath of transcriptCache.keys()) {
    if (!currentTranscriptPaths.has(transcriptPath)) {
      transcriptCache.delete(transcriptPath);
      markCacheDirty();
    }
  }

  // Self-check #2: At least one data source exists
  const hasConversations = dbFiles.length > 0;
  const hasBrain = brainFolders.length > 0;

  if (!hasConversations && !hasBrain) {
    console.warn(`[Stats] No conversation data found. Using empty baseline.`);
    scheduleCacheFlush();
    return createEmptyStats();
  }

  // Session-level metrics to prevent double-counting
  const sessionMetrics = new Map();

  let totalModelCalls = 0;
  let totalToolCalls = 0;
  let totalFastModeCalls = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalThinkingTokens = 0;
  let totalResponseTokens = 0;
  let longestDurationMs = 0;

  const realDailyMap = new Map();
  const realActiveDates = new Set();
  const uniqueSkills = new Set();
  let totalSkillsInvoked = 0;
  const modelFrequency = new Map();
  let hasStaleSessions = false;

  // Phase 1: Scan SQLite databases (metadata & exact ModelUsageStats)
  for (const file of dbFiles) {
    const sessionId = path.basename(file, '.db');
    const filePath = path.join(convDir, file);
    try {
      const fingerprint = getFileFingerprint(filePath, true);
      const effectiveMtimeMs = fingerprint.db.mtimeMs;
      const cached = dbCache.get(filePath);

      let modelCalls = 0;
      let toolCalls = 0;
      let fastModeCalls = 0;
      let sessionInputTokens = 0;
      let sessionOutputTokens = 0;
      let sessionCacheReadTokens = 0;
      let sessionThinkingTokens = 0;
      let sessionResponseTokens = 0;
      let sessionSkills = new Set();
      let sessionSkillsCount = 0;
      let sessionModels = new Map();
      let sessionGenerationUsages = [];
      let parsedCacheEntry = null;

      if (cached && fingerprintsEqual(cached.fingerprint, fingerprint)) {
        // Reuse cached metrics instantly (<5ms incremental scan)
        modelCalls = cached.modelCalls;
        toolCalls = cached.toolCalls;
        fastModeCalls = cached.fastModeCalls;
        sessionInputTokens = cached.sessionInputTokens;
        sessionOutputTokens = cached.sessionOutputTokens;
        sessionCacheReadTokens = cached.sessionCacheReadTokens;
        sessionThinkingTokens = cached.sessionThinkingTokens;
        sessionResponseTokens = cached.sessionResponseTokens;
        sessionSkills = new Set(cached.sessionSkills);
        sessionSkillsCount = cached.sessionSkillsCount;
        sessionModels = new Map(cached.sessionModels);
        sessionGenerationUsages = (cached.generationUsages || []).map(usage => ({ ...usage }));
      } else {
        let db = null;
        try {
          db = new DatabaseSync(filePath, { readOnly: true });

          // Step 1.1: Exact ModelUsageStats from gen_metadata protobuf BLOBs
          const genRows = db.prepare('SELECT idx, data FROM gen_metadata ORDER BY idx').all();
          for (const row of genRows) {
            if (!row.data) continue;
            const usage = decodeGenMetadata(Buffer.from(row.data));
            if (!usage) continue;

            modelCalls++;
            sessionInputTokens += usage.inputTokens;
            sessionOutputTokens += usage.outputTokens;
            sessionCacheReadTokens += usage.cacheReadTokens;
            sessionThinkingTokens += usage.thinkingTokens;
            sessionResponseTokens += usage.responseTokens;
            sessionGenerationUsages.push({
              inputTokens: usage.inputTokens,
              cacheReadTokens: usage.cacheReadTokens,
              outputTokens: usage.outputTokens,
              thinkingTokens: usage.thinkingTokens,
              responseTokens: usage.responseTokens,
              totalTokens: usage.inputTokens + usage.cacheReadTokens + usage.outputTokens,
            });

            if (usage.thinkingTokens === 0) {
              fastModeCalls++;
            }

            if (usage.modelName) {
              sessionModels.set(usage.modelName, (sessionModels.get(usage.modelName) || 0) + 1);
            }
          }

          // Step 1.2: Tool execution steps & Skill distinction from steps table
          const steps = db.prepare('SELECT idx, step_type, step_payload FROM steps').all();
          for (const step of steps) {
            if (step.step_type === 132) { // Tool execution primitive
              toolCalls++;
              if (step.step_payload) {
                const payloadStr = Buffer.from(step.step_payload).toString('utf8');
                const match = payloadStr.match(/[\\/]skills[\\/]([^\\/]+)[\\/]SKILL\.md/i);
                if (match) {
                  const skillName = match[1];
                  sessionSkills.add(skillName);
                  sessionSkillsCount++;
                }
              }
            }
          }

          parsedCacheEntry = {
            mtimeMs: effectiveMtimeMs,
            fingerprint,
            modelCalls,
            toolCalls,
            fastModeCalls,
            sessionInputTokens,
            sessionOutputTokens,
            sessionCacheReadTokens,
            sessionThinkingTokens,
            sessionResponseTokens,
            sessionSkills: Array.from(sessionSkills),
            sessionSkillsCount,
            sessionModels: Array.from(sessionModels.entries()),
            generationUsages: sessionGenerationUsages,
          };
        } catch (dbErr) {
          const isTemporaryLock =
            dbErr.code === 'SQLITE_BUSY' ||
            dbErr.message?.includes('database is locked') ||
            dbErr.message?.includes('SQLITE_BUSY');

          if (isTemporaryLock && cached) {
            // Graceful fallback on active lock: reuse previous cached snapshot rather than dropping to zero
            modelCalls = cached.modelCalls;
            toolCalls = cached.toolCalls;
            fastModeCalls = cached.fastModeCalls;
            sessionInputTokens = cached.sessionInputTokens;
            sessionOutputTokens = cached.sessionOutputTokens;
            sessionCacheReadTokens = cached.sessionCacheReadTokens;
            sessionThinkingTokens = cached.sessionThinkingTokens;
            sessionResponseTokens = cached.sessionResponseTokens;
            sessionSkills = new Set(cached.sessionSkills);
            sessionSkillsCount = cached.sessionSkillsCount;
            sessionModels = new Map(cached.sessionModels);
            sessionGenerationUsages = (cached.generationUsages || []).map(usage => ({ ...usage }));
            hasStaleSessions = true;
          } else {
            if (isTemporaryLock) {
              hasStaleSessions = true;
            }
            throw dbErr;
          }
        } finally {
          if (db) {
            try { db.close(); } catch {}
          }
        }
        if (parsedCacheEntry) {
          const afterFingerprint = getFileFingerprint(filePath, true);
          if (fingerprintsEqual(fingerprint, afterFingerprint)) {
            dbCache.set(filePath, parsedCacheEntry);
            markCacheDirty();
          }
        }
      }

      const sessionTotalTokens = sessionInputTokens + sessionCacheReadTokens + sessionOutputTokens;

      sessionMetrics.set(sessionId, {
        modelCalls,
        toolCalls,
        fastModeCalls,
        inputTokens: sessionInputTokens,
        outputTokens: sessionOutputTokens,
        cacheReadTokens: sessionCacheReadTokens,
        thinkingTokens: sessionThinkingTokens,
        responseTokens: sessionResponseTokens,
        skillsInvoked: sessionSkillsCount,
        skillNames: Array.from(sessionSkills),
        tokensFromDb: sessionTotalTokens,
        generationUsages: sessionGenerationUsages,
        mtimeMs: effectiveMtimeMs,
      });

      totalModelCalls += modelCalls;
      totalToolCalls += toolCalls;
      totalFastModeCalls += fastModeCalls;
      totalInputTokens += sessionInputTokens;
      totalOutputTokens += sessionOutputTokens;
      totalCacheReadTokens += sessionCacheReadTokens;
      totalThinkingTokens += sessionThinkingTokens;
      totalResponseTokens += sessionResponseTokens;
      totalSkillsInvoked += sessionSkillsCount;
      sessionSkills.forEach(s => uniqueSkills.add(s));

      for (const [mName, cnt] of sessionModels) {
        modelFrequency.set(mName, (modelFrequency.get(mName) || 0) + cnt);
      }

    } catch (err) {
      const isTemporaryLock =
        err.code === 'SQLITE_BUSY' ||
        err.message?.includes('database is locked') ||
        err.message?.includes('SQLITE_BUSY');

      if (!isTemporaryLock) {
        console.warn(`[Stats] Failed to read ${file}: ${err.message}`);
      }
    }
  }

  // Phase 2: Scan transcript logs for timestamps, calendar distribution, and task durations
  if (brainFolders.length > 0) {
    for (const folder of brainFolders) {
      const sessionId = folder; // brain folder name is session ID
      const transcriptPath = path.join(brainDir, folder, '.system_generated', 'logs', 'transcript.jsonl');
      try {
        const fingerprint = getFileFingerprint(transcriptPath);
        const cached = transcriptCache.get(transcriptPath);

          let fileDailyMap = new Map();
          let fileSkills = new Set();
          let generationDates = [];
          let duration = 0;

          if (cached && fingerprintsEqual(cached.fingerprint, fingerprint)) {
            fileDailyMap = cached.dailyMap;
            fileSkills = cached.skills;
            generationDates = cached.generationDates || [];
            duration = cached.duration;

            for (const [k, v] of fileDailyMap) {
              if (!realDailyMap.has(k)) realDailyMap.set(k, { tokens: 0, tasks: 0, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, thinkingTokens: 0, responseTokens: 0 });
              const e = realDailyMap.get(k);
              e.tasks += v.tasks;
              realActiveDates.add(k);
            }
            fileSkills.forEach(s => uniqueSkills.add(s));
            if (duration > longestDurationMs) longestDurationMs = duration;
          } else {
            const content = fs.readFileSync(transcriptPath, 'utf8');
            const lines = content.split('\n');
            let firstTime = null;
            let lastTime = null;

            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const item = JSON.parse(line);
                if (item.created_at) {
                  const dt = new Date(item.created_at);
                  const dateKey = toLocalDateKey(dt);
                  realActiveDates.add(dateKey);

                  if (!fileDailyMap.has(dateKey)) {
                    fileDailyMap.set(dateKey, { tasks: 0 });
                  }
                  const entry = fileDailyMap.get(dateKey);
                  if (item.source === 'USER_EXPLICIT' || item.type === 'USER_INPUT') {
                    entry.tasks += 1;
                  }

                  if (item.type === 'PLANNER_RESPONSE') {
                    generationDates.push(dateKey);
                  }

                  const t = dt.getTime();
                  if (!firstTime || t < firstTime) firstTime = t;
                  if (!lastTime || t > lastTime) lastTime = t;
                }

                // Check tool_calls for Agent Skills vs built-in primitives
                if (item.tool_calls && Array.isArray(item.tool_calls)) {
                  for (const tc of item.tool_calls) {
                    if (tc.name === 'view_file' && tc.args && tc.args.AbsolutePath) {
                      const match = tc.args.AbsolutePath.match(/[\\/]skills[\\/]([^\\/]+)[\\/]SKILL\.md/i);
                      if (match) {
                        const sName = match[1];
                        fileSkills.add(sName);
                        uniqueSkills.add(sName);
                      }
                    }
                  }
                }
              } catch (e) {}
            }

            duration = firstTime && lastTime ? lastTime - firstTime : 0;
            if (duration > longestDurationMs) {
              longestDurationMs = duration;
            }

            const parsedTranscriptEntry = {
              mtimeMs: fingerprint.mtimeMs,
              fingerprint,
              dailyMap: fileDailyMap,
              skills: fileSkills,
              generationDates,
              duration,
            };
            const afterFingerprint = getFileFingerprint(transcriptPath);
            if (fingerprintsEqual(fingerprint, afterFingerprint)) {
              transcriptCache.set(transcriptPath, parsedTranscriptEntry);
              markCacheDirty();
            }

            for (const [k, v] of fileDailyMap) {
              if (!realDailyMap.has(k)) realDailyMap.set(k, { tokens: 0, tasks: 0, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, thinkingTokens: 0, responseTokens: 0 });
              const e = realDailyMap.get(k);
              e.tasks += v.tasks;
            }
          }

          // Pair SQLite usage rows with transcript planner responses, falling back
          // to the latest known date or the session's database modification date.
          const sessionData = sessionMetrics.get(sessionId);
          if (sessionData) {
            const fallbackDateKey = toLocalDateKey(sessionData.mtimeMs || Date.now());
            for (const { usage, date: dKey } of pairGenerationDates(sessionData.generationUsages, generationDates, fallbackDateKey)) {
              if (!realDailyMap.has(dKey)) realDailyMap.set(dKey, { tokens: 0, tasks: 0, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, thinkingTokens: 0, responseTokens: 0 });
              const e = realDailyMap.get(dKey);
              e.tokens += usage.totalTokens;
              e.inputTokens = (e.inputTokens || 0) + usage.inputTokens;
              e.cacheReadTokens = (e.cacheReadTokens || 0) + usage.cacheReadTokens;
              e.outputTokens = (e.outputTokens || 0) + usage.outputTokens;
              e.thinkingTokens = (e.thinkingTokens || 0) + usage.thinkingTokens;
              e.responseTokens = (e.responseTokens || 0) + usage.responseTokens;
            }
          }

        } catch (err) {
          const isTemporaryLock =
            err.code === 'EBUSY' ||
            err.message?.includes('EBUSY');

          if (!isTemporaryLock && err.code !== 'ENOENT') {
            console.warn(`[Stats] Failed to read transcript ${folder}: ${err.message}`);
          }
        }
      }
    }

  // Phase 3: Aggregate final lifetime metrics from SQLite usage rows.
  let realTotalTokens = 0;
  let realPeakTokens = 0;

  for (const metrics of sessionMetrics.values()) {
    const finalTokens = metrics.tokensFromDb || 0;
    realTotalTokens += finalTokens;
    if (finalTokens > realPeakTokens) realPeakTokens = finalTokens;
  }

  // 1. Format tokens helper (B, M, K)
  function formatTokens(t) {
    if (t >= 1e9) return (t / 1e9).toFixed(2) + 'B';
    if (t >= 1e6) return (t / 1e6).toFixed(1) + 'M';
    if (t >= 1e3) return (t / 1e3).toFixed(1) + 'K';
    return String(Math.round(t));
  }

  // 2. Real Streaks Calculation from active dates
  const activeDates = Array.from(realActiveDates).sort();
  let currentStreak = 0;
  let longestStreak = 0;
  let tempStreak = 0;
  let prevDate = null;
  const todayKey = toLocalDateKey(new Date());

  for (const d of activeDates) {
    if (prevDate) {
      const diffDays = Math.round((new Date(d) - new Date(prevDate)) / 86400000);
      if (diffDays === 1) {
        tempStreak++;
      } else if (diffDays > 1) {
        tempStreak = 1;
      }
    } else {
      tempStreak = 1;
    }
    if (tempStreak > longestStreak) longestStreak = tempStreak;
    prevDate = d;
  }

  if (activeDates.length > 0) {
    const lastActive = activeDates[activeDates.length - 1];
    const diffFromToday = Math.round((new Date(todayKey) - new Date(lastActive)) / 86400000);
    if (diffFromToday <= 1) {
      currentStreak = tempStreak;
    } else {
      currentStreak = 0;
    }
  }

  // 3. Construct 39-Week Real Heatmap (273 days leading up to today)
  const today = new Date();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const calendarCells = [];
  const totalWeeks = 39;
  const totalDays = totalWeeks * 7;

  for (let w = 0; w < totalWeeks; w++) {
    for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
      const overallDayIdx = w * 7 + dayIdx;
      const daysFromEnd = (totalDays - 1) - overallDayIdx;
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysFromEnd);
      const dKey = toLocalDateKey(d);
      const monthName = months[d.getMonth()];

      const dayData = realDailyMap.get(dKey);
      const tokens = dayData ? dayData.tokens : 0;
      const tasks = dayData ? dayData.tasks : 0;

      calendarCells.push({
        date: dKey,
        month: monthName,
        dayOfWeek: d.getDay(),
        tokens,
        tasks,
        level: 0,
      });
    }
  }

  // 5-Tier Quantile Distribution calculated from real non-zero days
  const activeTokenValues = calendarCells
    .map(c => c.tokens)
    .filter(t => t > 0)
    .sort((a, b) => a - b);

  if (activeTokenValues.length > 0) {
    const n = activeTokenValues.length;
    const q1 = activeTokenValues[Math.floor(n * 0.25)] || 50000;
    const q2 = activeTokenValues[Math.floor(n * 0.50)] || 200000;
    const q3 = activeTokenValues[Math.floor(n * 0.75)] || 500000;

    for (const cell of calendarCells) {
      if (cell.tokens === 0) {
        cell.level = 0;
      } else if (cell.tokens <= q1) {
        cell.level = 1;
      } else if (cell.tokens <= q2) {
        cell.level = 2;
      } else if (cell.tokens <= q3) {
        cell.level = 3;
      } else {
        cell.level = 4;
      }
    }
  }

  // 4. Real Task Duration
  const durationHours = Math.floor(longestDurationMs / (1000 * 60 * 60));
  const durationMinutes = Math.floor((longestDurationMs % (1000 * 60 * 60)) / (1000 * 60));
  const longestTaskFormatted = durationHours > 0 || durationMinutes > 0
    ? `${durationHours}h ${durationMinutes}m`
    : longestDurationMs > 0 ? '<1m' : '—';

  // 5. Prompt Cache Hit Rate (~94%)
  const totalPromptTokens = totalInputTokens + totalCacheReadTokens;
  const promptCacheHitRatePct = totalPromptTokens > 0
    ? ((totalCacheReadTokens / totalPromptTokens) * 100).toFixed(1) + '%'
    : '0%';
  // 6. Thinking vs Response Token breakdown
  const reasoningPct = totalOutputTokens > 0
    ? Number(((totalThinkingTokens / totalOutputTokens) * 100).toFixed(1))
    : 0;

  // 7. Real Model Invocations and Primary Reasoning
  const sortedModels = Array.from(modelFrequency.entries()).sort((a, b) => b[1] - a[1]);
  let primaryModelName = '—';
  let primaryModelPct = 0;
  if (sortedModels.length > 0 && totalModelCalls > 0) {
    const [topModel, topCount] = sortedModels[0];
    primaryModelPct = Math.round((topCount / totalModelCalls) * 100);
    if (topModel.includes('3.8-flash')) primaryModelName = 'Gemini 3.8 Flash';
    else if (topModel.includes('3.7-flash')) primaryModelName = 'Gemini 3.7 Flash';
    else if (topModel.includes('claude')) primaryModelName = 'Claude Opus';
    else primaryModelName = topModel;
  }
  const mostUsedReasoningFormatted = sortedModels.length > 0 && totalModelCalls > 0
    ? `${primaryModelName} · ${primaryModelPct}%` : '—';

  const fastModeRate = totalModelCalls > 0
    ? ((totalFastModeCalls / totalModelCalls) * 100).toFixed(1) + '%'
    : '—';

  const modelBreakdown = {};
  for (const [mName, cnt] of sortedModels) {
    modelBreakdown[mName] = {
      count: cnt,
      pct: totalModelCalls > 0 ? Number(((cnt / totalModelCalls) * 100).toFixed(1)) : 0,
    };
  }

  // Daily stats record for frontend range filtering
  const dailyStatsObj = {};
  for (const [d, val] of realDailyMap) {
    dailyStatsObj[d] = {
      tokens: val.tokens,
      tasks: val.tasks,
      inputTokens: val.inputTokens || 0,
      cacheReadTokens: val.cacheReadTokens || 0,
      outputTokens: val.outputTokens || 0,
      thinkingTokens: val.thinkingTokens || 0,
      responseTokens: val.responseTokens || 0,
    };
  }

  const result = {
    kpis: {
      lifetimeTokens: formatTokens(realTotalTokens),
      lifetimeTokensRaw: realTotalTokens,
      peakTokens: formatTokens(realPeakTokens),
      longestTask: longestTaskFormatted,
      currentStreak: currentStreak,
      longestStreak: longestStreak,
    },
    activity: {
      heatmap: calendarCells,
      activeDaysCount: realActiveDates.size,
      totalTasks: Object.values(dailyStatsObj).reduce((sum, entry) => sum + entry.tasks, 0),
      dailyStats: dailyStatsObj,
    },
    insights: {
      fastMode: fastModeRate,
      mostUsedReasoning: mostUsedReasoningFormatted,
      skillsExplored: uniqueSkills.size,
      totalSkillsUsed: totalSkillsInvoked,
      totalThreads: dbFiles.length,
      cacheHitRate: promptCacheHitRatePct,
      toolPrimitivesUsed: totalToolCalls,
    },
    tokenBreakdown: {
      inputTokens: totalInputTokens,
      inputTokensFormatted: formatTokens(totalInputTokens),
      cacheReadTokens: totalCacheReadTokens,
      cacheReadTokensFormatted: formatTokens(totalCacheReadTokens),
      totalPromptTokens: totalPromptTokens,
      totalPromptTokensFormatted: formatTokens(totalPromptTokens),
      cacheHitRate: promptCacheHitRatePct,
      outputTokens: totalOutputTokens,
      outputTokensFormatted: formatTokens(totalOutputTokens),
      thinkingTokens: totalThinkingTokens,
      thinkingTokensFormatted: formatTokens(totalThinkingTokens),
      responseTokens: totalResponseTokens,
      responseTokensFormatted: formatTokens(totalResponseTokens),
      reasoningPct,
    },
    meta: {
      scannedConversations: dbFiles.length,
      updatedAt: new Date().toISOString(),
      models: modelBreakdown,
      hasStaleSessions,
    },
  };

  lastScanTime = Date.now();
  lastAggregatedStats = result;
  return result;
}

module.exports = {
  computeStats,
  pairGenerationDates,
  decodeVarint,
  parseProtoFields,
  decodeGenMetadata,
  FAST_SCAN_TTL,
  getCacheFilePath,
};
