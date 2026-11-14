const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

// Data root resolution order: explicit argument > ANTIGRAVITY_DATA_DIR > %USERPROFILE%/.gemini/antigravity,
// falling back to the repo mock-data tree only when the default directory does not exist yet.
function resolveAntigravityDir(explicitDir) {
  if (explicitDir) return explicitDir;
  if (process.env.ANTIGRAVITY_DATA_DIR) return process.env.ANTIGRAVITY_DATA_DIR;
  const defaultDir = path.join(os.homedir(), '.gemini', 'antigravity');
  if (!fs.existsSync(defaultDir)) {
    const localMock = path.join(__dirname, '..', 'mock-data');
    if (fs.existsSync(localMock)) return localMock;
  }
  return defaultDir;
}

// Run state is owned by the host's summaries DB; the UI uses the same field. Unknown => idle,
// so a schema change can only lose the "generating" hint, never fabricate token numbers.
//
// The 1s pill heartbeat re-reads the active session, and every read used to re-open and scan
// this DB. A fingerprint-guarded snapshot (db + wal, so any host write invalidates) reduces
// the repeat cost to one statSync; the short TTL is a safety net for coarse-mtime filesystems.
// A failed read is not cached: a transient lock must not pin a stale run state.
const RUNNING_SNAPSHOT_TTL_MS = 1500;
let runningSnapshot = null; // { path, fingerprint, set, at }

function readRunningSessions(dataDir) {
  const running = new Set();
  const summaryPath = path.join(dataDir, 'conversation_summaries.db');
  if (!fs.existsSync(summaryPath)) {
    runningSnapshot = null;
    return running;
  }

  let fingerprint = null;
  try {
    fingerprint = getFileFingerprint(summaryPath, true);
  } catch (err) {
    return running;
  }
  const cached = runningSnapshot;
  if (cached && cached.path === summaryPath && fingerprintsEqual(cached.fingerprint, fingerprint)
    && Date.now() - cached.at < RUNNING_SNAPSHOT_TTL_MS) {
    return cached.set;
  }

  let db = null;
  try {
    db = new DatabaseSync(summaryPath, { readOnly: true });
    for (const row of db.prepare('SELECT conversation_id, status, not_fully_idle FROM conversation_summaries').all()) {
      if (row.status !== 'CASCADE_RUN_STATUS_IDLE' || Number(row.not_fully_idle) === 1) {
        running.add(row.conversation_id);
      }
    }
    runningSnapshot = { path: summaryPath, fingerprint, set: running, at: Date.now() };
  } catch (err) {
    // Summaries DB busy/locked while the host writes: treat everything as idle. Keep the
    // previous snapshot so a lock does not turn every heartbeat tick into a fresh open.
  } finally {
    if (db) {
      try { db.close(); } catch {}
    }
  }
  return running;
}

// In-memory incremental cache for unmodified databases
const dbCache = new Map();
const transcriptCache = new Map();
let lastScanTime = 0;
let lastAggregatedStats = null;
let lastAggregatedDir = null;
const FAST_SCAN_TTL = 300; // 300ms throttle for back-to-back incremental calls
const PERSIST_CACHE_VERSION = 11;
const CACHE_FLUSH_DELAY_MS = 50;
const CACHE_LOCK_MAX_AGE_MS = 10000;
let cacheDirty = false;
let cacheFlushTimer = null;
let cacheWarningLogged = false;

function isPersistentCacheDisabled() {
  return process.env.ANTIGRAVITY_DISABLE_PERSIST_CACHE === '1';
}

// One cache file per data root: the desktop client (~/.gemini/antigravity) and the
// IDE extension (~/.gemini/antigravity-ide) run in separate processes and must never
// overwrite each other's snapshots. ANTIGRAVITY_STATS_CACHE_PATH is an explicit user
// override and stays a single exact path across roots.
function getCacheFilePath(dataDir) {
  if (process.env.ANTIGRAVITY_STATS_CACHE_PATH) return process.env.ANTIGRAVITY_STATS_CACHE_PATH;
  const stateDir = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'AntiToken')
    : path.join(os.homedir(), '.antigravity-token-stats');
  const normalized = normalizePath(dataDir ?? resolveAntigravityDir());
  const hash = crypto.createHash('sha1').update(normalized).digest('hex').slice(0, 8);
  const slug = normalized.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'root';
  return path.join(stateDir, `stats-cache-${slug}-${hash}.json`);
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

// Persistent-cache hydration happens once per data root, lazily on first use —
// a process that serves two roots (e.g. tests, multi-host tooling) must not mix
// snapshots.
const hydratedRoots = new Set();

function hydrateCacheFromDisk(dataDir) {
  if (isPersistentCacheDisabled()) return;
  if (hydratedRoots.has(normalizePath(dataDir))) return;
  hydratedRoots.add(normalizePath(dataDir));

  const cachePath = getCacheFilePath(dataDir);
  try {
    if (!fs.existsSync(cachePath)) return;
    const snapshot = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    if (snapshot.version !== PERSIST_CACHE_VERSION || normalizePath(snapshot.dataRoot) !== normalizePath(dataDir)) {
      return;
    }

    const conversationsDir = path.join(dataDir, 'conversations');
    for (const entry of Object.values(snapshot.dbs || {})) {
      if (!entry?.file || !entry.fingerprint || !entry.metrics) continue;
      const filePath = path.resolve(conversationsDir, entry.file);
      if (path.relative(conversationsDir, filePath).startsWith('..') || !filePath.endsWith('.db')) continue;
      dbCache.set(filePath, {
        ...entry.metrics,
        generationDates: entry.metrics.generationDates || [],
        generationTimestampsMs: entry.metrics.generationTimestampsMs || [],
        dailyTasks: new Map(entry.metrics.dailyTasks || []),
        duration: entry.metrics.duration || 0,
        fingerprint: entry.fingerprint,
        mtimeMs: entry.fingerprint.db?.mtimeMs,
      });
    }

    const brainDir = path.join(dataDir, 'brain');
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
        generationTimestampsMs: metrics.generationTimestampsMs || [],
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

function serializeCache(dataDir) {
  const conversationsDir = path.join(dataDir, 'conversations');
  const brainDir = path.join(dataDir, 'brain');
  const dbs = {};
  const transcripts = {};

  for (const [filePath, entry] of dbCache) {
    if (!entry.fingerprint) continue;
    const file = path.relative(conversationsDir, filePath);
    if (!file || file.startsWith('..')) continue;
    const { fingerprint, mtimeMs, ...metrics } = entry;
    dbs[path.basename(file, '.db')] = {
      file,
      fingerprint,
      metrics: { ...metrics, dailyTasks: Array.from(metrics.dailyTasks) },
    };
  }

  for (const [transcriptPath, entry] of transcriptCache) {
    if (!entry.fingerprint) continue;
    const relative = path.relative(brainDir, transcriptPath);
    // Entries from another data root must never leak into this root's snapshot,
    // even when a flush lands mid-scan while the cache still holds both roots.
    if (!relative || relative.startsWith('..')) continue;
    const parts = relative.split(path.sep);
    if (parts.length < 4) continue;
    transcripts[parts[0]] = {
      sessionId: parts[0],
      fingerprint: entry.fingerprint,
      metrics: {
        dailyMap: Array.from(entry.dailyMap.entries()),
        skills: Array.from(entry.skills),
        generationDates: entry.generationDates,
        generationTimestampsMs: entry.generationTimestampsMs || [],
        duration: entry.duration,
      },
    };
  }

  return {
    version: PERSIST_CACHE_VERSION,
    dataRoot: normalizePath(dataDir),
    updatedAt: new Date().toISOString(),
    dbs,
    transcripts,
  };
}

function persistCacheToDisk() {
  if (isPersistentCacheDisabled() || !cacheDirty) return;
  // Serialize the root the cache entries actually belong to, resolved at flush
  // time — not whatever root happened to schedule this flush.
  const dataDir = lastAggregatedDir;
  if (!dataDir) return;

  const cachePath = getCacheFilePath(dataDir);
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

    const serialized = JSON.stringify(serializeCache(dataDir));
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
    const inputTokens = usage.get(2) ?? 0;
    const outputTokens = usage.get(3) ?? 0;
    const cacheReadTokens = usage.get(5) ?? 0;
    const thinkingTokens = usage.get(9) ?? 0;
    const responseTokens = Math.max(0, usage.get(10) ?? (outputTokens - thinkingTokens));

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

const OFFICIAL_MODEL_PRICING = {
  'gemini-4-carbon': {
    inputPerM: 2.00,
    cacheReadPerM: 0.10,
    outputPerM: 10.00,
    pool: 'gemini',
  },
  'gemini-4-argon': {
    inputPerM: 2.00,
    cacheReadPerM: 0.10,
    outputPerM: 10.00,
    pool: 'argon',
  },
  'gemini-4-hydrogen': {
    inputPerM: 1.50,
    cacheReadPerM: 0.075,
    outputPerM: 7.50,
    pool: 'gemini',
  },
  'gemini-3.8-flash': {
    inputPerM: 0.75,
    cacheReadPerM: 0.075,
    outputPerM: 3.75,
    pool: 'gemini',
  },
  'gemini-3.7-flash': {
    inputPerM: 0.75,
    cacheReadPerM: 0.075,
    outputPerM: 3.75,
    pool: 'gemini',
  },
  'gemini-3.6-flash': {
    inputPerM: 0.75,
    cacheReadPerM: 0.075,
    outputPerM: 3.75,
    pool: 'gemini',
  },
  'gemini-3.1-pro': {
    pool: 'gemini',
    promptTierThreshold: 200_000,
    standard: { inputPerM: 2.00, cacheReadPerM: 0.20, outputPerM: 12.00 },
    longContext: { inputPerM: 4.00, cacheReadPerM: 0.40, outputPerM: 18.00 },
  },
  'claude-opus-5-5': {
    inputPerM: 4.00,
    cacheReadPerM: 0.20,
    outputPerM: 20.00,
    pool: 'claude',
  },
  'claude-sonnet-5-5': {
    inputPerM: 2.00,
    cacheReadPerM: 0.10,
    outputPerM: 10.00,
    pool: 'claude',
  },
  'claude-opus-4-6': {
    inputPerM: 5.00,
    cacheReadPerM: 0.50,
    outputPerM: 25.00,
    pool: 'claude',
  },
  'claude-sonnet-4-6': {
    inputPerM: 3.00,
    cacheReadPerM: 0.30,
    outputPerM: 15.00,
    pool: 'claude',
  },
  'gpt-oss-120b': {
    inputPerM: 0,
    cacheReadPerM: 0,
    outputPerM: 0,
    pool: 'claude',
  },
};

function hasModelVersion(m, major, minor) {
  return new RegExp(`(?:^|[^0-9])${major}[._-]${minor}(?:[^0-9]|$)`).test(m);
}

function hasModelKeyword(m, keyword) {
  return new RegExp(`(?:^|[^a-z])${keyword}(?:$|[^a-z])`).test(m);
}

function resolveOfficialModelId(modelName) {
  const m = String(modelName || '').trim().toLowerCase();
  if (!m) return null;

  if (m.includes('gpt-oss') || hasModelKeyword(m, 'gpt')) {
    return 'gpt-oss-120b';
  }
  if (m.includes('carbon')) return 'gemini-4-carbon';
  if (m.includes('argon')) return 'gemini-4-argon';
  // worker must match before orchestrator and flash
  if (
    m.includes('hydrogen') ||
    m.includes('worker') ||
    /(?:^|[^a-z0-9])gemini[-_.]?4[-_.](?:low|medium|high|xhigh)(?:$|[^a-z0-9])/.test(m)
  ) {
    return 'gemini-4-hydrogen';
  }
  if (m.includes('orchestrator')) return 'gemini-4-argon';

  if (hasModelKeyword(m, 'pro') && hasModelVersion(m, 3, 1)) {
    return 'gemini-3.1-pro';
  }
  if (hasModelKeyword(m, 'flash')) {
    if (hasModelVersion(m, 3, 8)) return 'gemini-3.8-flash';
    if (hasModelVersion(m, 3, 7)) return 'gemini-3.7-flash';
    if (hasModelVersion(m, 3, 6)) return 'gemini-3.6-flash';
  }
  if (hasModelKeyword(m, 'opus')) {
    if (hasModelVersion(m, 5, 5)) return 'claude-opus-5-5';
    if (hasModelVersion(m, 4, 6)) return 'claude-opus-4-6';
  }
  if (hasModelKeyword(m, 'sonnet')) {
    if (hasModelVersion(m, 5, 5)) return 'claude-sonnet-5-5';
    if (hasModelVersion(m, 4, 6)) return 'claude-sonnet-4-6';
  }

  return null;
}

function getModelPricing(modelName, inputTokens = 0, cacheReadTokens = 0) {
  const modelId = resolveOfficialModelId(modelName);
  if (!modelId) return null;
  const spec = OFFICIAL_MODEL_PRICING[modelId];
  if (!spec) return null;
  if (spec.promptTierThreshold) {
    const promptTokens = Math.max(0, inputTokens || 0) + Math.max(0, cacheReadTokens || 0);
    return promptTokens > spec.promptTierThreshold ? spec.longContext : spec.standard;
  }
  return spec;
}

function computeGenerationCostUsd(modelName, inputTokens, cacheReadTokens, outputTokens) {
  const rate = getModelPricing(modelName, inputTokens, cacheReadTokens);
  if (!rate) return 0;
  return (
    (Math.max(0, inputTokens || 0) / 1e6) * rate.inputPerM +
    (Math.max(0, cacheReadTokens || 0) / 1e6) * rate.cacheReadPerM +
    (Math.max(0, outputTokens || 0) / 1e6) * rate.outputPerM
  );
}

function decodeStepTimestamp(buf) {
  if (!buf || buf.length < 4) return null;
  try {
    const top = parseProtoFields(buf);
    const msg1 = top.get(1);
    if (!msg1 || !msg1[0]) return null;
    const inner = parseProtoFields(msg1[0]);
    const seconds = inner.get(1);
    if (typeof seconds === 'number' && seconds > 1.6e9 && seconds < 2.5e9) {
      return new Date(seconds * 1000);
    }
  } catch {}
  return null;
}

function classifyQuotaPool(modelName) {
  const modelId = resolveOfficialModelId(modelName);
  if (modelId && OFFICIAL_MODEL_PRICING[modelId]) {
    return OFFICIAL_MODEL_PRICING[modelId].pool;
  }
  const m = String(modelName || '').toLowerCase();
  if (m.includes('claude') || m.includes('opus') || m.includes('sonnet') || m.includes('gpt') || m.includes('o1') || m.includes('o3')) {
    return 'claude';
  }
  return 'gemini';
}

function pairGenerationDates(generationUsages, generationDates, fallbackDateKey, generationTimestampsMs = [], fallbackTimestampMs = null) {
  if (!generationUsages || generationUsages.length === 0) {
    return [];
  }

  const hasDates = Array.isArray(generationDates) && generationDates.length > 0;
  const lastDate = hasDates ? generationDates[generationDates.length - 1] : fallbackDateKey;
  const hasTimestamps = Array.isArray(generationTimestampsMs) && generationTimestampsMs.length > 0;
  const lastTimestamp = hasTimestamps ? generationTimestampsMs[generationTimestampsMs.length - 1] : fallbackTimestampMs;
  return generationUsages.map((usage, index) => ({
    usage,
    date: (hasDates && index < generationDates.length)
      ? generationDates[index]
      : (lastDate || fallbackDateKey),
    tsMs: (hasTimestamps && index < generationTimestampsMs.length)
      ? generationTimestampsMs[index]
      : (lastTimestamp || fallbackTimestampMs),
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
    },
    activity: { heatmap: [], activeDaysCount: 0, totalTasks: 0 },
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
    sessions: {},
    meta: { scannedConversations: 0, updatedAt: new Date().toISOString(), hasStaleSessions: false },
  };
}

// Immutable usage snapshots are shared by full scans and session heartbeats; run state stays separate.
function readSessionSnapshot(filePath) {
  const fingerprint = getFileFingerprint(filePath, true);
  const mtimeMs = fingerprint.db.mtimeMs;
  const cached = dbCache.get(filePath);
  if (cached && fingerprintsEqual(cached.fingerprint, fingerprint)) {
    return { metrics: cached, stale: false, mtimeMs };
  }

  let db = null;
  try {
    db = new DatabaseSync(filePath, { readOnly: true });
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
    let sessionGenerationDates = [];
    let sessionGenerationTimestampsMs = [];
    let sessionDailyTasks = new Map();
    let sessionStepDuration = 0;
    let sessionTurnCalls = 0;
    let sessionTurnStartedAt = null;
    let sessionPerf = null;
    let sessionCostUsd = 0;
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
      const costUsd = computeGenerationCostUsd(usage.modelName, usage.inputTokens, usage.cacheReadTokens, usage.outputTokens);
      sessionCostUsd += costUsd;
      sessionGenerationUsages.push({
        modelName: usage.modelName,
        inputTokens: usage.inputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        outputTokens: usage.outputTokens,
        thinkingTokens: usage.thinkingTokens,
        responseTokens: usage.responseTokens,
        totalTokens: usage.inputTokens + usage.cacheReadTokens + usage.outputTokens,
        costUsd,
      });

      if (usage.thinkingTokens === 0) {
        fastModeCalls++;
      }

      if (usage.modelName) {
        sessionModels.set(usage.modelName, (sessionModels.get(usage.modelName) || 0) + 1);
      }
    }

    // Step 1.2: Tool execution steps, Skill distinction & native step timestamps from steps table
    let steps = [];
    try {
      steps = db.prepare('SELECT idx, step_type, step_payload, metadata FROM steps ORDER BY idx').all();
    } catch (e) {
      if (e.message && e.message.includes('no such column: metadata')) {
        steps = db.prepare('SELECT idx, step_type, step_payload FROM steps ORDER BY idx').all();
      } else {
        throw e;
      }
    }
    let firstStepTime = null;
    let lastStepTime = null;

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

      const stepDate = step.metadata ? decodeStepTimestamp(Buffer.from(step.metadata)) : null;
      if (stepDate) {
        const t = stepDate.getTime();
        if (!firstStepTime || t < firstStepTime) firstStepTime = t;
        if (!lastStepTime || t > lastStepTime) lastStepTime = t;
        const dKey = toLocalDateKey(stepDate);
        if (step.step_type === 14) {
          sessionDailyTasks.set(dKey, (sessionDailyTasks.get(dKey) || 0) + 1);
        }
        if (step.step_type === 15) {
          sessionGenerationDates.push(dKey);
          sessionGenerationTimestampsMs.push(t);
        }
      }

      // Turn boundary: a user input step (14) resets the counter, so the tally is
      // "model calls since the last user message" (i.e. the run currently on screen).
      if (step.step_type === 14) {
        sessionTurnCalls = 0;
        sessionTurnStartedAt = stepDate ? stepDate.getTime() : null;
      } else if (step.step_type === 15) {
        sessionTurnCalls++;
      }
    }
    sessionStepDuration = firstStepTime && lastStepTime ? lastStepTime - firstStepTime : 0;
    sessionPerf = extractSessionPerformanceMetrics(steps);

    let topModel = '';
    let topModelCalls = 0;
    for (const [name, count] of sessionModels) {
      if (count > topModelCalls) { topModel = name; topModelCalls = count; }
    }
    const turnUsages = sessionGenerationUsages.slice(Math.max(0, sessionGenerationUsages.length - sessionTurnCalls));
    const metrics = {
      fingerprint,
      mtimeMs,
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
      modelCounts: Array.from(sessionModels),
      tokensFromDb: sessionInputTokens + sessionCacheReadTokens + sessionOutputTokens,
      generationUsages: sessionGenerationUsages,
      generationRowCount: genRows.length,
      generationDates: sessionGenerationDates,
      generationTimestampsMs: sessionGenerationTimestampsMs,
      dailyTasks: sessionDailyTasks,
      duration: sessionStepDuration,
      turnCalls: sessionTurnCalls,
      turnStartedAt: sessionTurnStartedAt,
      turnTokens: turnUsages.reduce((sum, usage) => sum + usage.totalTokens, 0),
      turnOutputTokens: turnUsages.reduce((sum, usage) => sum + usage.outputTokens, 0),
      perf: sessionPerf,
      costUsd: Math.round(sessionCostUsd * 10000) / 10000,
      topModel,
    };
    if (fingerprintsEqual(fingerprint, getFileFingerprint(filePath, true))) {
      dbCache.set(filePath, metrics);
      markCacheDirty();
    }
    return { metrics, stale: false, mtimeMs };
  } catch (error) {
    const isTemporaryLock = error.code === 'SQLITE_BUSY' || error.message?.includes('database is locked') || error.message?.includes('SQLITE_BUSY');
    if (isTemporaryLock) return { metrics: cached || null, stale: true, mtimeMs };
    throw error;
  } finally {
    if (db) { try { db.close(); } catch {} }
  }
}

function computeStats(force = false, dataDir) {
  const nowMs = Date.now();
  const agDir = resolveAntigravityDir(dataDir);
  // The in-memory snapshot is only valid for the data root that produced it; switching
  // dataDir must never serve another root's numbers through the fast-scan TTL.
  if (!force && lastAggregatedStats && lastAggregatedDir === agDir && nowMs - lastScanTime < FAST_SCAN_TTL) {
    return lastAggregatedStats;
  }

  // Self-check #1: Data directory existence
  if (!fs.existsSync(agDir)) {
    console.error(`[Stats] ERROR: Antigravity data directory not found at: ${agDir}`);
    console.error(`[Stats] Have you used Antigravity 2.0 yet? The directory is created on first use.`);
    return createEmptyStats();
  }

  const convDir = path.join(agDir, 'conversations');
  const brainDir = path.join(agDir, 'brain');

  // Load this root's persistent cache before the eviction loop below prunes
  // entries not belonging to the current root.
  hydrateCacheFromDisk(agDir);

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
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalThinkingTokens = 0;
  let totalResponseTokens = 0;

  const realDailyMap = new Map();
  const realCostTimelineMap = new Map();
  const realActiveDates = new Set();
  const modelFrequency = new Map();
  let hasStaleSessions = false;

  function accumulateGenerations(pairs) {
    for (const { usage, date: dKey, tsMs } of pairs) {
      if (!realDailyMap.has(dKey)) realDailyMap.set(dKey, { tokens: 0, tasks: 0, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, thinkingTokens: 0, responseTokens: 0, costUsd: 0 });
      const e = realDailyMap.get(dKey);
      const genCost = typeof usage.costUsd === 'number'
        ? usage.costUsd
        : computeGenerationCostUsd(usage.modelName, usage.inputTokens, usage.cacheReadTokens, usage.outputTokens);
      e.tokens += usage.totalTokens;
      e.inputTokens = (e.inputTokens || 0) + usage.inputTokens;
      e.cacheReadTokens = (e.cacheReadTokens || 0) + usage.cacheReadTokens;
      e.outputTokens = (e.outputTokens || 0) + usage.outputTokens;
      e.thinkingTokens = (e.thinkingTokens || 0) + usage.thinkingTokens;
      e.responseTokens = (e.responseTokens || 0) + usage.responseTokens;
      e.costUsd = (e.costUsd || 0) + genCost;
      if (genCost > 0 && typeof tsMs === 'number' && !isNaN(tsMs)) {
        const bucketTs = Math.floor(tsMs / 60000) * 60000;
        const pool = classifyQuotaPool(usage.modelName);
        const key = `${bucketTs}:${pool}`;
        const existing = realCostTimelineMap.get(key);
        if (existing) {
          existing.costUsd += genCost;
        } else {
          realCostTimelineMap.set(key, { ts: bucketTs, costUsd: genCost, pool });
        }
      }
    }
  }

  // Phase 1: Scan SQLite databases (metadata & exact ModelUsageStats)
  for (const file of dbFiles) {
    const sessionId = path.basename(file, '.db');
    try {
      const { metrics, stale, mtimeMs } = readSessionSnapshot(path.join(convDir, file));
      if (stale) hasStaleSessions = true;
      if (!metrics) continue;
      sessionMetrics.set(sessionId, stale ? { ...metrics, mtimeMs } : metrics);
      totalModelCalls += metrics.modelCalls;
      totalInputTokens += metrics.inputTokens;
      totalOutputTokens += metrics.outputTokens;
      totalCacheReadTokens += metrics.cacheReadTokens;
      totalThinkingTokens += metrics.thinkingTokens;
      totalResponseTokens += metrics.responseTokens;
      for (const [name, count] of metrics.modelCounts) {
        modelFrequency.set(name, (modelFrequency.get(name) || 0) + count);
      }
    } catch (error) {
      console.warn(`[Stats] Failed to read ${file}: ${error.message}`);
    }
  }

  // Phase 2: Scan transcript logs for timestamps, calendar distribution, and task durations
  const processedSessions = new Set();
  if (brainFolders.length > 0) {
    for (const folder of brainFolders) {
      const sessionId = folder; // brain folder name is session ID
      const transcriptPath = path.join(brainDir, folder, '.system_generated', 'logs', 'transcript.jsonl');
      try {
        const fingerprint = getFileFingerprint(transcriptPath);
        const cached = transcriptCache.get(transcriptPath);

          let fileDailyMap = new Map();
          let generationDates = [];
          let generationTimestampsMs = [];

          if (cached && fingerprintsEqual(cached.fingerprint, fingerprint)) {
            fileDailyMap = cached.dailyMap;
            generationDates = cached.generationDates || [];
            generationTimestampsMs = cached.generationTimestampsMs || [];

            for (const [k, v] of fileDailyMap) {
              if (!realDailyMap.has(k)) realDailyMap.set(k, { tokens: 0, tasks: 0, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, thinkingTokens: 0, responseTokens: 0, costUsd: 0 });
              const e = realDailyMap.get(k);
              e.tasks += v.tasks;
              realActiveDates.add(k);
            }
          } else {
            const content = fs.readFileSync(transcriptPath, 'utf8');
            const lines = content.split('\n');

            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const item = JSON.parse(line);
                if (item.created_at) {
                  const dt = new Date(item.created_at);
                  const t = dt.getTime();
                  if (Number.isFinite(t)) {
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
                      generationTimestampsMs.push(t);
                    }
                  }
                }
              } catch (e) {}
            }

            const parsedTranscriptEntry = {
              mtimeMs: fingerprint.mtimeMs,
              fingerprint,
              dailyMap: fileDailyMap,
              skills: new Set(),
              generationDates,
              generationTimestampsMs,
              duration: 0,
            };
            const afterFingerprint = getFileFingerprint(transcriptPath);
            if (fingerprintsEqual(fingerprint, afterFingerprint)) {
              transcriptCache.set(transcriptPath, parsedTranscriptEntry);
              markCacheDirty();
            }

            for (const [k, v] of fileDailyMap) {
              if (!realDailyMap.has(k)) realDailyMap.set(k, { tokens: 0, tasks: 0, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, thinkingTokens: 0, responseTokens: 0, costUsd: 0 });
              const e = realDailyMap.get(k);
              e.tasks += v.tasks;
            }
          }

          // Pair SQLite usage rows with transcript planner responses, falling back
          // to the latest known date or the session's database modification date.
          const sessionData = sessionMetrics.get(sessionId);
          if (sessionData) {
            const fallbackTs = sessionData.mtimeMs || Date.now();
            const fallbackDateKey = toLocalDateKey(fallbackTs);
            const dbDates = sessionData.generationDates || [];
            const dbTimestamps = sessionData.generationTimestampsMs || [];
            // Exact per-generation step timestamps win whenever they cover every usage row; a
            // transcript trimmed by the auto-cleaner only knows its own tail and would clamp the rest.
            const dbComplete = dbDates.length >= sessionData.generationUsages.length && dbTimestamps.length >= sessionData.generationUsages.length;
            const effectiveDates = dbComplete ? dbDates : generationDates.length > 0 ? generationDates : dbDates;
            const effectiveTimestamps = dbComplete ? dbTimestamps : generationTimestampsMs.length > 0 ? generationTimestampsMs : dbTimestamps;
            accumulateGenerations(pairGenerationDates(sessionData.generationUsages, effectiveDates, fallbackDateKey, effectiveTimestamps, fallbackTs));
          }
          processedSessions.add(sessionId);

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

  // Phase 2.5: Resilient fallback for sessions whose transcript logs were cleared by auto-cleaner
  for (const [sessionId, sessionData] of sessionMetrics) {
    if (processedSessions.has(sessionId)) continue;

    const fallbackTs = sessionData.mtimeMs || Date.now();
    const fallbackDateKey = toLocalDateKey(fallbackTs);
    const finalDates = (sessionData.generationDates && sessionData.generationDates.length > 0)
      ? sessionData.generationDates
      : [fallbackDateKey];
    const finalTimestamps = (sessionData.generationTimestampsMs && sessionData.generationTimestampsMs.length > 0)
      ? sessionData.generationTimestampsMs
      : [fallbackTs];

    if (sessionData.dailyTasks) {
      for (const [dKey, count] of sessionData.dailyTasks) {
        realActiveDates.add(dKey);
        if (!realDailyMap.has(dKey)) realDailyMap.set(dKey, { tokens: 0, tasks: 0, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, thinkingTokens: 0, responseTokens: 0, costUsd: 0 });
        realDailyMap.get(dKey).tasks += count;
      }
    }

    const pairs = pairGenerationDates(sessionData.generationUsages, finalDates, fallbackDateKey, finalTimestamps, fallbackTs);
    for (const { date } of pairs) realActiveDates.add(date);
    accumulateGenerations(pairs);
  }

  // Phase 3: Aggregate final lifetime metrics from SQLite usage rows.
  let realTotalTokens = 0;
  const sessionsSummary = {};
  const runningSessions = readRunningSessions(agDir);
  // Full live detail is only needed where a pill or IDE status bar can still point at it:
  // running sessions, anything touched in the last day, and the single newest session (so
  // "the last conversation" survives even after days idle).
  const SESSION_LIVE_WINDOW_MS = 24 * 60 * 60 * 1000;
  let newestSessionId = null;
  let newestSessionAt = -1;
  let newestSessionSummary = null;

  for (const [sId, metrics] of sessionMetrics) {
    const finalTokens = metrics.tokensFromDb || 0;
    realTotalTokens += finalTokens;

    const sessionCostRounded = metrics.costUsd;
    const isRunning = runningSessions.has(sId);
    const lastActiveAt = metrics.mtimeMs || null;

    const summary = { ...buildSessionSummary(sId, metrics, isRunning), costUsd: sessionCostRounded };
    if (isRunning || (lastActiveAt !== null && nowMs - lastActiveAt < SESSION_LIVE_WINDOW_MS)) {
      sessionsSummary[sId] = summary;
    }
    if (lastActiveAt !== null && lastActiveAt > newestSessionAt) {
      newestSessionAt = lastActiveAt;
      newestSessionId = sId;
      newestSessionSummary = summary;
    }
  }
  if (newestSessionSummary && newestSessionId && !sessionsSummary[newestSessionId]) {
    sessionsSummary[newestSessionId] = newestSessionSummary;
  }

  // 1. Format tokens helper (B, M, K)
  function formatTokens(t) {
    if (t >= 1e9) return (t / 1e9).toFixed(2) + 'B';
    if (t >= 1e6) return (t / 1e6).toFixed(1) + 'M';
    if (t >= 1e3) return (t / 1e3).toFixed(1) + 'K';
    return String(Math.round(t));
  }

  // 2. Construct 39-Week Real Heatmap (273 days leading up to today)
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

  // 3. Prompt Cache Hit Rate (~94%)
  const totalPromptTokens = totalInputTokens + totalCacheReadTokens;
  const promptCacheHitRatePct = totalPromptTokens > 0
    ? ((totalCacheReadTokens / totalPromptTokens) * 100).toFixed(1) + '%'
    : '0%';
  // 4. Thinking vs Response Token breakdown
  const reasoningPct = totalOutputTokens > 0
    ? Number(((totalThinkingTokens / totalOutputTokens) * 100).toFixed(1))
    : 0;

  // 5. Model Call Breakdown
  const sortedModels = Array.from(modelFrequency.entries()).sort((a, b) => b[1] - a[1]);
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
      costUsd: Math.round(((val.costUsd || 0) + Number.EPSILON) * 100) / 100,
    };
  }

  const costTimeline = Array.from(realCostTimelineMap.values())
    .map(item => ({
      ts: item.ts,
      costUsd: Math.round((item.costUsd + Number.EPSILON) * 10000) / 10000,
      pool: item.pool,
    }))
    .sort((a, b) => a.ts - b.ts);
  // shortcut: deleted conversation files are invisible; add per-source coverage markers if that becomes a supported case.
  const earliestActivityDate = Array.from(realActiveDates).sort()[0];
  const costTimelineCoverageStartMs = earliestActivityDate
    ? new Date(`${earliestActivityDate}T00:00:00`).getTime() + 86400000
    : null;

  const result = {
    kpis: {
      lifetimeTokens: formatTokens(realTotalTokens),
      lifetimeTokensRaw: realTotalTokens,
    },
    activity: {
      heatmap: calendarCells,
      activeDaysCount: realActiveDates.size,
      totalTasks: Object.values(dailyStatsObj).reduce((sum, entry) => sum + entry.tasks, 0),
      dailyStats: dailyStatsObj,
      costTimeline,
      costTimelineCoverageStartMs,
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
    sessions: sessionsSummary,
    proxy: (function() {
      try {
        const pm = require('./proxy-manager.cjs');
        return pm.getAllStatus({ nonBlocking: true });
      } catch {
        return undefined;
      }
    })(),
    meta: {
      scannedConversations: dbFiles.length,
      updatedAt: new Date().toISOString(),
      models: modelBreakdown,
      hasStaleSessions,
    },
  };

  lastScanTime = Date.now();
  lastAggregatedStats = result;
  lastAggregatedDir = agDir;
  return result;
}

function extractSessionPerformanceMetrics(dbOrSteps) {
  let modelTimeMs = 0;
  let toolTimeMs = 0;
  let ttftSumMs = 0;
  let ttftStepsCount = 0;
  let roundsCount = 0;
  let stepsCount = 0;
  let responseMs = 0;
  let responseTokens = 0;

  let rows = [];
  if (Array.isArray(dbOrSteps)) {
    rows = dbOrSteps;
  } else if (dbOrSteps && typeof dbOrSteps.prepare === 'function') {
    try {
      rows = dbOrSteps.prepare('SELECT idx, step_type, metadata, step_payload FROM steps ORDER BY idx ASC').all();
    } catch {
      rows = [];
    }
  }

  for (const row of rows) {
    const stepType = row.step_type;
    if (stepType === 14) {
      roundsCount++;
      continue;
    }

    if (stepType === 15) {
      stepsCount++;
      if (!row.metadata) continue;
      try {
        const top = parseProtoFields(Buffer.from(row.metadata));
        const sTs = top.get(1)?.[0] ? parseProtoFields(top.get(1)[0]) : null;
        const fTs = top.get(8)?.[0] ? parseProtoFields(top.get(8)[0]) : (top.get(7)?.[0] ? parseProtoFields(top.get(7)[0]) : null);
        const firstTs = top.get(6)?.[0] ? parseProtoFields(top.get(6)[0]) : null;

        const startMs = sTs ? (Number(sTs.get(1)) || 0) * 1000 + (Number(sTs.get(2)) || 0) / 1e6 : 0;
        const finishMs = fTs ? (Number(fTs.get(1)) || 0) * 1000 + (Number(fTs.get(2)) || 0) / 1e6 : 0;
        const firstMs = firstTs ? (Number(firstTs.get(1)) || 0) * 1000 + (Number(firstTs.get(2)) || 0) / 1e6 : 0;

        if (startMs > 0 && finishMs >= startMs) {
          modelTimeMs += (finishMs - startMs);
        }

        // TTFT extraction: valid whenever first token arrives after start, regardless of fTs
        if (startMs > 0 && firstMs >= startMs) {
          const ttft = firstMs - startMs;
          if (ttft < 300_000) {
            ttftSumMs += ttft;
            ttftStepsCount++;
          }
        }

        const payload = row.step_payload ? parseProtoFields(Buffer.from(row.step_payload)) : null;
        const plannerBuf = payload?.get(20)?.[0];
        const usageBuf = top.get(9)?.[0];
        if (!plannerBuf || !usageBuf) continue;
        const planner = parseProtoFields(plannerBuf);
        // Exclude tool calls and non-text steps from text streaming speed calculation
        if (!planner.get(1)?.[0]?.length || planner.has(7)) continue;
        const usage = parseProtoFields(usageBuf);
        const totalOut = Number(usage.get(3) ?? 0);
        const thinkingTokens = Number(usage.get(9) ?? 0);
        const stepResponseTokens = Math.max(0, Number(usage.get(10) ?? (totalOut - thinkingTokens)));
        if (!Number.isFinite(stepResponseTokens) || stepResponseTokens <= 0) continue;

        const thinkingBuf = planner.get(11)?.[0];
        const thinking = thinkingBuf ? parseProtoFields(thinkingBuf) : null;
        const thinkingMs = thinking ? (Number(thinking.get(1) ?? 0) * 1000 + Number(thinking.get(2) ?? 0) / 1e6) : 0;

        // The host's thinking_duration includes the wait from created_at to the response phase.
        // Fall back to first token arrival (firstMs) if thinking_duration is not present.
        const responseStartMs = thinkingMs > 0 ? Math.max(firstMs, startMs + thinkingMs) : (firstMs > 0 ? firstMs : startMs);
        const generationTs = top.get(7)?.[0] ? parseProtoFields(top.get(7)[0]) : fTs;
        const generationEndMs = generationTs ? (Number(generationTs.get(1) ?? 0) * 1000 + Number(generationTs.get(2) ?? 0) / 1e6) : finishMs;
        const stepDurationMs = generationEndMs - responseStartMs;

        // Anti-jitter: valid streaming step must take at least 50ms and complete within step bounds
        if (startMs > 0 && responseStartMs >= startMs && generationEndMs <= finishMs + 100
          && stepDurationMs >= 50 && Number.isFinite(thinkingMs) && thinkingMs >= 0) {
          responseMs += stepDurationMs;
          responseTokens += stepResponseTokens;
        }
      } catch {}
      continue;
    }

    if (stepType === 132) {
      stepsCount++;
      if (!row.metadata) continue;
      try {
        const top = parseProtoFields(Buffer.from(row.metadata));
        const sTs = top.get(1)?.[0] ? parseProtoFields(top.get(1)[0]) : null;
        const fTs = top.get(8)?.[0] ? parseProtoFields(top.get(8)[0]) : (top.get(7)?.[0] ? parseProtoFields(top.get(7)[0]) : null);

        if (sTs && fTs) {
          const startMs = (Number(sTs.get(1)) || 0) * 1000 + (Number(sTs.get(2)) || 0) / 1e6;
          const finishMs = (Number(fTs.get(1)) || 0) * 1000 + (Number(fTs.get(2)) || 0) / 1e6;
          if (startMs > 0 && finishMs >= startMs) {
            const rawDuration = finishMs - startMs;
            toolTimeMs += Math.min(180_000, rawDuration);
          }
        }
      } catch {}
    }
  }

  const rate = responseMs > 0 ? responseTokens / (responseMs / 1000) : 0;
  const tps = rate > 0 ? Number(rate.toFixed(rate < 10 ? 1 : 0)) || null : null;

  return {
    rounds: Math.max(1, roundsCount),
    steps: stepsCount,
    tps,
    modelDurationSec: modelTimeMs / 1000,
    toolDurationSec: toolTimeMs / 1000,
    ttftSec: ttftStepsCount > 0 ? (ttftSumMs / ttftStepsCount / 1000) : null,
  };
}

function buildDshTelemetry({
  sessionId,
  isStreaming = false,
  perf,
  promptTokens = 0,
  totalInput = 0,
  totalCache = 0,
  totalOutput = 0,
}) {
  const SYSTEM_BASELINE = 8200;
  const TOOLS_BASELINE = 8300;
  const BASELINE_SUM = SYSTEM_BASELINE + TOOLS_BASELINE; // 16500

  let systemPromptTokens = 0;
  let toolDefinitionTokens = 0;
  let chatMessageTokens = 0;

  if (promptTokens <= 0) {
    systemPromptTokens = 0;
    toolDefinitionTokens = 0;
    chatMessageTokens = 0;
  } else if (promptTokens < BASELINE_SUM) {
    const scale = promptTokens / BASELINE_SUM;
    systemPromptTokens = Math.round(SYSTEM_BASELINE * scale);
    toolDefinitionTokens = Math.max(0, promptTokens - systemPromptTokens);
    chatMessageTokens = 0;
  } else {
    systemPromptTokens = SYSTEM_BASELINE;
    toolDefinitionTokens = TOOLS_BASELINE;
    chatMessageTokens = Math.max(0, promptTokens - BASELINE_SUM);
  }

  const billedInput = totalInput + totalCache;
  let cacheHitRatePct = null;
  if (billedInput > 0) {
    const rawPct = (totalCache / billedInput) * 100;
    cacheHitRatePct = Math.round(rawPct);
    if (totalInput > 0 && cacheHitRatePct >= 100) {
      cacheHitRatePct = 99;
    }
  }

  const limitTokens = 256000; // 256K
  const usedPct = promptTokens > 0 ? Math.min(100, Math.round((promptTokens / limitTokens) * 100)) : 0;
  const totalTokens = totalInput + totalCache + totalOutput;

  return {
    sessionId,
    isStreaming: Boolean(isStreaming),
    session: {
      rounds: perf.rounds,
      steps: perf.steps,
      tps: perf.tps,
      modelDurationSec: perf.modelDurationSec,
      toolDurationSec: perf.toolDurationSec,
      ttftSec: perf.ttftSec,
    },
    token: {
      totalTokens,
      cacheHitRatePct,
      uncachedInputTokens: totalInput,
      cacheReadTokens: totalCache,
      outputTokens: totalOutput,
    },
    context: {
      usedTokens: promptTokens,
      limitTokens,
      usedPct,
      systemPromptTokens,
      toolDefinitionTokens,
      chatMessageTokens,
    },
  };
}

function buildSessionSummary(sId, metrics, isRunning) {
  const usages = metrics.generationUsages;
  const lastUsage = usages.length > 0 ? usages[usages.length - 1] : null;
  const promptTokens = lastUsage ? (lastUsage.inputTokens + lastUsage.cacheReadTokens) : 0;
  const turnCalls = metrics.turnCalls || 0;
  const turnTokens = metrics.turnTokens;
  const perf = metrics.perf || { rounds: 1, steps: 0, tps: null, modelDurationSec: 0, toolDurationSec: 0, ttftSec: null };
  const dshTelemetry = buildDshTelemetry({
    sessionId: sId,
    isStreaming: isRunning,
    perf,
    promptTokens,
    totalInput: metrics.inputTokens || 0,
    totalCache: metrics.cacheReadTokens || 0,
    totalOutput: metrics.outputTokens || 0,
  });
  return {
    isRunning,
    turnCalls,
    turnTokens,
    turnStartedAt: metrics.turnStartedAt || null,
    promptTokens,
    latestInput: lastUsage ? lastUsage.inputTokens : 0,
    latestCacheRead: lastUsage ? lastUsage.cacheReadTokens : 0,
    latestOutput: lastUsage ? lastUsage.outputTokens : 0,
    latestThinking: lastUsage ? lastUsage.thinkingTokens : 0,
    latestResponse: lastUsage ? lastUsage.responseTokens : 0,
    modelName: lastUsage ? (lastUsage.modelName || '') : '',
    totalTokens: metrics.tokensFromDb || 0,
    totalInputTokens: metrics.inputTokens || 0,
    totalCacheReadTokens: metrics.cacheReadTokens || 0,
    totalOutputTokens: metrics.outputTokens || 0,
    compactionLimit: 256000,
    turnsCount: usages.length,
    rounds: perf.rounds,
    steps: perf.steps,
    tps: perf.tps,
    modelDurationSec: perf.modelDurationSec,
    toolDurationSec: perf.toolDurationSec,
    ttftSec: perf.ttftSec,
    dshTelemetry,
  };
}

function readSingleSession(sessionId, dataDir) {
  if (!sessionId || typeof sessionId !== 'string') return null;
  if (sessionId.includes('..') || sessionId.includes('/') || sessionId.includes('\\')) return null;
  const agDir = resolveAntigravityDir(dataDir);
  try {
    hydrateCacheFromDisk(agDir);
    const { metrics } = readSessionSnapshot(path.join(agDir, 'conversations', `${sessionId}.db`));
    if (!metrics) return null;
    return {
      sessionId,
      ...buildSessionSummary(sessionId, metrics, readRunningSessions(agDir).has(sessionId)),
      totalThinkingTokens: metrics.thinkingTokens,
      totalResponseTokens: metrics.responseTokens,
      turnOutputTokens: metrics.turnOutputTokens,
      turnsCount: metrics.generationRowCount,
    };
  } catch {
    return null;
  }
}

module.exports = {
  computeStats,
  readSingleSession,
  extractSessionPerformanceMetrics,
  buildDshTelemetry,
  pairGenerationDates,
  decodeVarint,
  parseProtoFields,
  decodeGenMetadata,
  decodeStepTimestamp,
  resolveOfficialModelId,
  computeGenerationCostUsd,
  classifyQuotaPool,
  FAST_SCAN_TTL,
  getCacheFilePath,
};

if (require.main === module) {
  console.log(JSON.stringify(computeStats(true), null, 2));
}
