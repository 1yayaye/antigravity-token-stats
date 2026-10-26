#!/usr/bin/env node
/**
 * Comprehensive test suite for Antigravity Token Stats
 * Validates all bug fixes from 2026-09-07
 */

const fs = require('fs');
const path = require('path');
require('./test-stats-filter.cjs');
require('./test-token-breakdown.cjs');
require('./test-heatmap.cjs');
require('./test-theme.cjs');
require('./test-i18n-engine.cjs');

const TESTS = [];
let passCount = 0;
let failCount = 0;

function test(name, fn) {
  TESTS.push({ name, fn });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

// ============================================================================
// TEST SUITE
// ============================================================================

test('Bundle exists and has correct size', () => {
  const bundlePath = path.join(__dirname, '..', 'dist-bundle', 'antigravity-stats-bundle.js');
  assert(fs.existsSync(bundlePath), 'Bundle file should exist');

  const content = fs.readFileSync(bundlePath, 'utf8');
  assert(content.length > 200000, 'Bundle should be > 200KB');
  assert(content.length < 500000, 'Bundle should be < 500KB');
});

test('Bundle has CSS version tag', () => {
  const bundlePath = path.join(__dirname, '..', 'dist-bundle', 'antigravity-stats-bundle.js');
  const content = fs.readFileSync(bundlePath, 'utf8');

  assert(content.includes('data-version'), 'Should have data-version attribute');
  assert(content.includes('antigravity-stats-styles'), 'Should have style ID');
});

test('Aggregate script has sessionMetrics deduplication', () => {
  const aggregateScript = fs.readFileSync(path.join(__dirname, 'aggregate-stats.cjs'), 'utf8');

  assert(aggregateScript.includes('sessionMetrics = new Map()'), 'Should have sessionMetrics Map');
  assert(aggregateScript.includes('tokensFromDb'), 'Should track db tokens');
  assert(aggregateScript.includes('generationUsages'), 'Should retain per-generation usage rows');
  assert(!aggregateScript.includes('tokensFromTranscript'), 'Must not invent transcript token totals');
});

test('Daily token allocation falls back when generation/date counts differ', () => {
  const { pairGenerationDates } = require('./aggregate-stats.cjs');
  const usages = [{ totalTokens: 10 }, { totalTokens: 20 }];
  const exact = pairGenerationDates(usages, ['2026-09-16', '2026-09-17']);

  assert(exact.length === 2, 'Complete sequences should pair every generation');
  assert(exact[0].usage === usages[0] && exact[1].date === '2026-09-17', 'Pairing should preserve append order');
  const partial = pairGenerationDates(usages, ['2026-09-16'], '2026-09-18');
  assert(partial.length === 2 && partial[1].date === '2026-09-16', 'Partial sequences should use the latest known date');
  const missing = pairGenerationDates(usages, [], '2026-09-18');
  assert(missing.length === 2 && missing.every(pair => pair.date === '2026-09-18'), 'Missing dates should use the fallback date');
});

test('Aggregate script has self-checks', () => {
  const aggregateScript = fs.readFileSync(path.join(__dirname, 'aggregate-stats.cjs'), 'utf8');

  assert(aggregateScript.includes('function createEmptyStats'), 'Should have empty stats function');
  assert(aggregateScript.includes('Self-check #1'), 'Should have directory check');
  assert(aggregateScript.includes('Self-check #2'), 'Should have data source check');
  assert(aggregateScript.includes('data directory not found'), 'Should have error message');
});

test('Aggregate script has 3-phase architecture', () => {
  const aggregateScript = fs.readFileSync(path.join(__dirname, 'aggregate-stats.cjs'), 'utf8');

  assert(aggregateScript.includes('Phase 1: Scan SQLite'), 'Should have Phase 1');
  assert(aggregateScript.includes('Phase 2: Scan transcript'), 'Should have Phase 2');
  assert(aggregateScript.includes('Phase 3: Aggregate final lifetime metrics'), 'Should have Phase 3');
});

test('Aggregate script has improved error handling', () => {
  const aggregateScript = fs.readFileSync(path.join(__dirname, 'aggregate-stats.cjs'), 'utf8');

  assert(aggregateScript.includes('isTemporaryLock'), 'Should detect temporary locks');
  assert(aggregateScript.includes('SQLITE_BUSY'), 'Should check SQLite busy');
  assert(aggregateScript.includes('console.warn'), 'Should warn on non-lock errors');
});

test('Loader script exists and handles 127.0.0.1 origin filter', () => {
  const loaderScript = fs.readFileSync(path.join(__dirname, 'loader.cjs'), 'utf8');
  assert(loaderScript.includes('isAntigravityMainWindow'), 'Should define isAntigravityMainWindow');
  assert(loaderScript.includes('127.0.0.1'), 'Should filter for 127.0.0.1 origin');
  assert(loaderScript.includes('dev-bundle.path'), 'Should support dev-bundle.path DX redirect');

  const { isAntigravityMainWindow } = require('./loader.cjs');
  assert(isAntigravityMainWindow({ webContents: { getURL: () => 'https://127.0.0.1:3901/main' }, isDestroyed: () => false }) === true, 'Must allow 127.0.0.1 https origin');
  assert(isAntigravityMainWindow({ webContents: { getURL: () => 'http://127.0.0.1:8080/' }, isDestroyed: () => false }) === true, 'Must allow 127.0.0.1 http origin');
  assert(isAntigravityMainWindow({ webContents: { getURL: () => 'https://accounts.google.com/o/oauth2/v2/auth' }, isDestroyed: () => false }) === false, 'Must reject OAuth popups');
  assert(isAntigravityMainWindow({ webContents: { getURL: () => 'https://gemini.google.com/' }, isDestroyed: () => false }) === false, 'Must reject external web views');
  assert(isAntigravityMainWindow({ webContents: { getURL: () => 'https://127.0.0.1:3901/main' }, isDestroyed: () => true }) === false, 'Must reject destroyed windows');
  assert(isAntigravityMainWindow(null) === false, 'Must reject null window');
});

test('Patch script has ASAR unpack and factory backup safeguards', () => {
  const patchScript = fs.readFileSync(path.join(__dirname, 'patch-antigravity.cjs'), 'utf8');
  assert(patchScript.includes('extractAll'), 'Must call asar.extractAll');
  assert(patchScript.includes('createPackageWithOptions'), 'Must call asar.createPackageWithOptions');
  assert(patchScript.includes('chrome-devtools-mcp'), 'Must unpack chrome-devtools-mcp');
  assert(patchScript.includes('app.asar.backup'), 'Must manage factory backup');
  assert(patchScript.includes('__ANTIGRAVITY_STATS_INJECTION__'), 'Must inject main hook');
  assert(patchScript.includes('__ANTIGRAVITY_SYNC_BRIDGE__'), 'Must inject preload bridge');
});

test('Toast messages are inserted as text', () => {
  const standaloneCode = fs.readFileSync(path.join(__dirname, '..', 'src', 'standalone.tsx'), 'utf8');
  assert(standaloneCode.includes('data-toast-message'), 'Toast should have a message node');
  assert(standaloneCode.includes('messageNode.textContent = message'), 'Toast message must use textContent');
  assert(!standaloneCode.includes('white-space: nowrap;">${message}</span>'), 'Toast must not interpolate message into HTML');
});

test('Subscription quota countdown refreshes while mounted', () => {
  const cardCode = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'stats', 'SubscriptionQuotaCard.tsx'), 'utf8');
  assert(cardCode.includes('setInterval(() => setNowMs(Date.now()), 60_000)'), 'Quota card should refresh its clock every minute');
  assert(cardCode.includes('computeQuotaCycleMetrics(stats, liveQuota, selectedTier, nowMs)'), 'Quota card should recompute metrics against the refreshed clock');
  assert(cardCode.includes('clearInterval(timer)'), 'Quota card should clear its clock on unmount');
});

test('Standalone has DOM race condition guards', () => {
  const standaloneCode = fs.readFileSync(path.join(__dirname, '..', 'src', 'standalone.tsx'), 'utf8');

  assert(standaloneCode.includes('DOM structure changed during injection scan'), 'Should warn about structure changes');
  assert(standaloneCode.includes('!parent.contains(modelsBtn)'), 'Should check parent containment');
  assert(standaloneCode.includes('DOM changed before button insertion'), 'Should warn about insertion race');
});

test('Aggregate script runs without errors', () => {
  const { computeStats } = require('./aggregate-stats.cjs');
  const stats = computeStats();

  assert(stats.kpis, 'Should have kpis');
  assert(stats.activity, 'Should have activity');
  assert(stats.insights, 'Should have insights');
  assert(stats.tokenBreakdown, 'Should have tokenBreakdown');
  assert(stats.meta, 'Should have meta');
  assert(typeof stats.kpis.lifetimeTokens === 'string', 'lifetimeTokens should be formatted string');
  assert(typeof stats.kpis.lifetimeTokensRaw === 'number', 'lifetimeTokensRaw should be number');
});

test('Aggregate script handles missing directory gracefully', () => {
  // This test would require mocking fs.existsSync
  // For now, just verify the code path exists
  const aggregateScript = fs.readFileSync(path.join(__dirname, 'aggregate-stats.cjs'), 'utf8');

  assert(aggregateScript.includes('return createEmptyStats()'), 'Should return empty stats on missing directory');
});

test('Zero-dependency Protobuf decoder for SQLite gen_metadata ModelUsageStats', () => {
  const { decodeGenMetadata, decodeVarint } = require('./aggregate-stats.cjs');

  // Synthetic protobuf payload with ModelUsageStats (Tag 1.4: 1.4.2, 1.4.3, 1.4.5, 1.4.9, 1.4.10)
  const usageParts = [
    Buffer.from([0x10, 0xe8, 0x07]),       // Tag 2: input_tokens = 1000
    Buffer.from([0x18, 0xc8, 0x01]),       // Tag 3: output_tokens = 200
    Buffer.from([0x28, 0xa8, 0x46]),       // Tag 5: cache_read_tokens = 9000
    Buffer.from([0x48, 0x96, 0x01]),       // Tag 9: thinking_output_tokens = 150
    Buffer.from([0x50, 0x32]),             // Tag 10: response_output_tokens = 50
  ];
  const usageBuf = Buffer.concat(usageParts);
  const tag4Header = Buffer.from([0x22, usageBuf.length]);

  const modelStr = Buffer.from('gemini-3.8-flash', 'utf8');
  const tag19Header = Buffer.from([0x9a, 0x01, modelStr.length]);

  const msg1Content = Buffer.concat([tag4Header, usageBuf, tag19Header, modelStr]);
  const tag1Header = Buffer.from([0x0a, msg1Content.length]);
  const syntheticPayload = Buffer.concat([tag1Header, msg1Content]);

  const decoded = decodeGenMetadata(syntheticPayload);
  assert(decoded !== null, 'Decoded should not be null');
  assert(decoded.inputTokens === 1000, 'inputTokens should be 1000');
  assert(decoded.outputTokens === 200, 'outputTokens should be 200');
  assert(decoded.cacheReadTokens === 9000, 'cacheReadTokens should be 9000');
  assert(decoded.thinkingTokens === 150, 'thinkingTokens should be 150');
  assert(decoded.responseTokens === 50, 'responseTokens should be 50');
  assert(decoded.modelName === 'gemini-3.8-flash', 'modelName should match');
});

test('No estimation heuristics (chars / 3.5, bytes / 3.8) in codebase', () => {
  // The renderer is scanned too: that is where character counting hid from this check.
  const files = [path.join(__dirname, 'aggregate-stats.cjs')];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx|js|cjs)$/.test(entry.name)) files.push(full);
    }
  };
  walk(path.join(__dirname, '..', 'src'));

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    for (const pattern of ['/ 3.5', '/ 3.8', 'Math.ceil(bytes /', 'Math.ceil(chars /']) {
      assert(!content.includes(pattern), `${path.basename(file)} must not contain ${pattern}`);
    }
  }
});

test('Ground truth Lifetime Tokens (>1B) and Prompt Cache Hit Rate (~94%)', () => {
  const { computeStats } = require('./aggregate-stats.cjs');
  const stats = computeStats();
  if (stats.meta.scannedConversations === 0) {
    // In clean environments without local Antigravity session data (e.g. CI or external machines),
    // skip local ground-truth assertions.
    return;
  }
  assert(stats.kpis.lifetimeTokensRaw > 1000000000, 'Lifetime tokens should be > 1B');
  const hitRate = parseFloat(stats.insights.cacheHitRate);
  assert(Math.round(hitRate) >= 92 && Math.round(hitRate) <= 95, `Cache hit rate should be ~94%, got ${stats.insights.cacheHitRate}`);
  assert(stats.insights.skillsExplored > 15, 'Should distinguish and count real Agent Skills');
  assert(stats.insights.toolPrimitivesUsed > 5000, 'Should track built-in tool primitives separately');
});

test('Live Sync and manual refresh IPC hooks exist', () => {
  const loaderCode = fs.readFileSync(path.join(__dirname, 'loader.cjs'), 'utf8');
  assert(loaderCode.includes('antigravity:request-sync'), 'Must register IPC handler');
  assert(loaderCode.includes('__ANTIGRAVITY_REQUEST_SYNC__'), 'Must wire sync function');
  assert(loaderCode.includes('antigravity:stats-updated'), 'Must emit stats-updated event');

  const patchCode = fs.readFileSync(path.join(__dirname, 'patch-antigravity.cjs'), 'utf8');
  assert(patchCode.includes('__ANTIGRAVITY_SYNC_BRIDGE__'), 'Must define preload contextBridge');

  const viewCode = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'stats', 'StatsView.tsx'), 'utf8');
  assert(viewCode.includes('antigravity:stats-updated'), 'StatsView must listen for stats-updated');
  assert(viewCode.includes('__ANTIGRAVITY_REQUEST_SYNC__'), 'StatsView must call __ANTIGRAVITY_REQUEST_SYNC__');
});

test('Live Sync keeps debounce, in-flight, and busy-lock safeguards', () => {
  const loaderCode = fs.readFileSync(path.join(__dirname, 'loader.cjs'), 'utf8');
  assert(loaderCode.includes('antigravity:stats-updated'), 'Must emit stats-updated event');
  assert(loaderCode.includes('fs.watch'), 'Must watch data files');
  assert(loaderCode.includes('debounce'), 'Must debounce updates');
  assert(loaderCode.includes('pushInFlight'), 'Must serialize pushes');
  assert(loaderCode.includes('retry-after-busy'), 'Must retry after SQLITE_BUSY');
});

test('SQLITE_BUSY fallback and auto-retry on busy lock exist', () => {
  const aggregateCode = fs.readFileSync(path.join(__dirname, 'aggregate-stats.cjs'), 'utf8');
  assert(aggregateCode.includes('hasStaleSessions'), 'aggregate-stats must track hasStaleSessions');
  assert(aggregateCode.includes('isTemporaryLock && cached'), 'aggregate-stats must fall back to cached data on active lock');

  const loaderCode = fs.readFileSync(path.join(__dirname, 'loader.cjs'), 'utf8');
  assert(loaderCode.includes('retry-after-busy'), 'loader must schedule push retry after busy lock');
  assert(loaderCode.includes('retryBusyTimer'), 'loader must manage retry timer');

  const viewCode = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'stats', 'StatsView.tsx'), 'utf8');
  assert(viewCode.includes('Request sync on mount error'), 'StatsView must request sync on mount');
});

test('decodeStepTimestamp handles both short (<128B) and long (>=128B) protobuf messages', () => {
  const { decodeStepTimestamp } = require('./aggregate-stats.cjs');
  function encodeVarint(num) {
    const bytes = [];
    let v = BigInt(num);
    while (v >= 0x80n) {
      bytes.push(Number((v & 0x7fn) | 0x80n));
      v >>= 7n;
    }
    bytes.push(Number(v));
    return Buffer.from(bytes);
  }

  const targetSec = 1760000000;
  const tsField = Buffer.concat([Buffer.from([0x08]), encodeVarint(targetSec)]);

  // Short inner message (<128 bytes, 1-byte length prefix)
  const shortMsg = Buffer.concat([Buffer.from([0x0a]), encodeVarint(tsField.length), tsField]);
  const dShort = decodeStepTimestamp(shortMsg);
  assert(dShort instanceof Date && dShort.getTime() === targetSec * 1000, 'Should decode short step timestamp');

  // Long inner message (>=128 bytes, 2-byte varint length prefix)
  const extraString = Buffer.alloc(140, 0x61);
  const extraField = Buffer.concat([Buffer.from([0x12]), encodeVarint(extraString.length), extraString]);
  const innerLong = Buffer.concat([tsField, extraField]);
  const longMsg = Buffer.concat([Buffer.from([0x0a]), encodeVarint(innerLong.length), innerLong]);
  const dLong = decodeStepTimestamp(longMsg);
  assert(dLong instanceof Date && dLong.getTime() === targetSec * 1000, 'Should decode >=128B step timestamp with 2-byte length varint');
});

test('Phase 2.5 recovers daily stats, costUsd, and duration when transcript.jsonl is absent', () => {
  const os = require('node:os');
  const { DatabaseSync } = require('node:sqlite');
  const { spawnSync } = require('node:child_process');

  function encodeVarint(num) {
    const bytes = [];
    let v = BigInt(num);
    while (v >= 0x80n) {
      bytes.push(Number((v & 0x7fn) | 0x80n));
      v >>= 7n;
    }
    bytes.push(Number(v));
    return Buffer.from(bytes);
  }

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-phase25-test-'));
  try {
    const convDir = path.join(tmpRoot, 'conversations');
    fs.mkdirSync(convDir, { recursive: true });
    const dbPath = path.join(convDir, 'no-transcript-session.db');
    const db = new DatabaseSync(dbPath);
    db.exec('CREATE TABLE gen_metadata (idx INTEGER, data BLOB); CREATE TABLE steps (idx INTEGER, step_type INTEGER, step_payload BLOB, metadata BLOB);');

    // Insert 1M input tokens on gemini-2.5-pro ($2.00)
    const usageBuf = Buffer.concat([Buffer.from([0x10]), encodeVarint(1000000)]);
    const modelStr = Buffer.from('gemini-2.5-pro', 'utf8');
    const msg1 = Buffer.concat([
      Buffer.from([0x22, usageBuf.length]), usageBuf,
      Buffer.from([0x9a, 0x01, modelStr.length]), modelStr,
    ]);
    const genBlob = Buffer.concat([Buffer.from([0x0a, msg1.length]), msg1]);
    db.prepare('INSERT INTO gen_metadata (idx, data) VALUES (?, ?)').run(1, genBlob);

    // Step 1: user input (step_type 14) at 1760000000
    const inner1 = Buffer.concat([Buffer.from([0x08]), encodeVarint(1760000000)]);
    const ts1 = Buffer.concat([Buffer.from([0x0a, inner1.length]), inner1]);
    // Step 2: planner response (step_type 15) 30 minutes (1800s) later at 1760001800
    const inner2 = Buffer.concat([Buffer.from([0x08]), encodeVarint(1760001800)]);
    const ts2 = Buffer.concat([Buffer.from([0x0a, inner2.length]), inner2]);
    db.prepare('INSERT INTO steps (idx, step_type, step_payload, metadata) VALUES (?, ?, ?, ?)').run(1, 14, null, ts1);
    db.prepare('INSERT INTO steps (idx, step_type, step_payload, metadata) VALUES (?, ?, ?, ?)').run(2, 15, null, ts2);
    db.close();

    const res = spawnSync(process.execPath, ['-e', "const { computeStats } = require('./scripts/aggregate-stats.cjs'); console.log(JSON.stringify(computeStats(true)));"], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      env: { ...process.env, ANTIGRAVITY_DATA_DIR: tmpRoot, ANTIGRAVITY_DISABLE_PERSIST_CACHE: '1' },
    });
    assert(res.status === 0, `Phase 2.5 subprocess failed: ${res.stderr}`);
    const out = JSON.parse(res.stdout.trim().split(/\r?\n/).at(-1));
    assert(out.activity.totalTasks === 1, `Expected 1 task from steps.metadata, got ${out.activity.totalTasks}`);
    assert(out.kpis.longestTask === '0h 30m', `Expected 0h 30m duration, got ${out.kpis.longestTask}`);
    const dayEntries = Object.values(out.activity.dailyStats || {});
    assert(dayEntries.length === 1 && dayEntries[0].costUsd === 2, `Expected $2.00 Pro model cost, got ${JSON.stringify(dayEntries)}`);
  } finally {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  }
});

test('Exact DB step timestamps win when the transcript only knows part of the session', () => {
  const os = require('node:os');
  const { DatabaseSync } = require('node:sqlite');
  const { spawnSync } = require('node:child_process');

  function encodeVarint(num) {
    const bytes = [];
    let v = BigInt(num);
    while (v >= 0x80n) {
      bytes.push(Number((v & 0x7fn) | 0x80n));
      v >>= 7n;
    }
    bytes.push(Number(v));
    return Buffer.from(bytes);
  }

  const localKey = (sec) => {
    const d = new Date(sec * 1000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const dayA = 1790000000;
  const dayB = dayA + 3 * 86400;
  const transcriptDay = dayA + 86400;
  const sessionId = 'partial-transcript-session';

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-db-timestamp-test-'));
  try {
    fs.mkdirSync(path.join(tmpRoot, 'conversations'), { recursive: true });

    const db = new DatabaseSync(path.join(tmpRoot, 'conversations', `${sessionId}.db`));
    db.exec('CREATE TABLE gen_metadata (idx INTEGER, data BLOB); CREATE TABLE steps (idx INTEGER, step_type INTEGER, step_payload BLOB, metadata BLOB);');
    const usageBuf = Buffer.concat([Buffer.from([0x10]), encodeVarint(1000000)]);
    const modelStr = Buffer.from('gemini-2.5-pro', 'utf8');
    const msg = Buffer.concat([
      Buffer.from([0x22, usageBuf.length]), usageBuf,
      Buffer.from([0x9a, 0x01, modelStr.length]), modelStr,
    ]);
    const genBlob = Buffer.concat([Buffer.from([0x0a, msg.length]), msg]);
    db.prepare('INSERT INTO gen_metadata (idx, data) VALUES (?, ?)').run(1, genBlob);
    db.prepare('INSERT INTO gen_metadata (idx, data) VALUES (?, ?)').run(2, genBlob);
    for (const [idx, ts] of [[1, dayA], [2, dayB]]) {
      const inner = Buffer.concat([Buffer.from([0x08]), encodeVarint(ts)]);
      const metadata = Buffer.concat([Buffer.from([0x0a, inner.length]), inner]);
      db.prepare('INSERT INTO steps (idx, step_type, step_payload, metadata) VALUES (?, ?, ?, ?)').run(idx, 15, null, metadata);
    }
    db.close();

    const transcriptPath = path.join(tmpRoot, 'brain', sessionId, '.system_generated', 'logs', 'transcript.jsonl');
    fs.mkdirSync(path.dirname(transcriptPath), { recursive: true });
    fs.writeFileSync(transcriptPath, JSON.stringify({
      created_at: new Date(transcriptDay * 1000).toISOString(),
      type: 'PLANNER_RESPONSE',
      content: 'partial',
    }) + '\n');

    const res = spawnSync(process.execPath, ['-e', "const { computeStats } = require('./scripts/aggregate-stats.cjs'); console.log(JSON.stringify(computeStats(true)));"], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      env: { ...process.env, ANTIGRAVITY_DATA_DIR: tmpRoot, ANTIGRAVITY_DISABLE_PERSIST_CACHE: '1' },
    });
    assert(res.status === 0, `DB timestamp subprocess failed: ${res.stderr}`);
    const out = JSON.parse(res.stdout.trim().split(/\r?\n/).at(-1));
    const daily = out.activity.dailyStats || {};
    const a = daily[localKey(dayA)];
    const b = daily[localKey(dayB)];
    assert(a && a.costUsd === 2 && a.tokens === 1000000, `Expected first DB day to keep its $2, got ${JSON.stringify(a)}`);
    assert(b && b.costUsd === 2 && b.tokens === 1000000, `Expected second DB day to keep its $2, got ${JSON.stringify(b)}`);
    assert(daily[localKey(transcriptDay)]?.costUsd === 0, `Transcript day must not absorb DB cost, got ${JSON.stringify(daily[localKey(transcriptDay)])}`);
  } finally {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  }
});

test('Transcript aggregation rejects invalid dates and counts transcript-only sessions', () => {
  const os = require('node:os');
  const { spawnSync } = require('node:child_process');
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-transcript-edge-'));
  try {
    const transcriptPath = path.join(tmpRoot, 'brain', 'transcript-only', '.system_generated', 'logs', 'transcript.jsonl');
    fs.mkdirSync(path.dirname(transcriptPath), { recursive: true });
    fs.writeFileSync(transcriptPath, [
      JSON.stringify({ created_at: 'not-a-date', type: 'USER_INPUT' }),
      JSON.stringify({ created_at: '2026-10-15T00:00:00.000Z', type: 'USER_INPUT' }),
    ].join('\n') + '\n');

    const result = spawnSync(process.execPath, ['-e', "const { computeStats } = require('./scripts/aggregate-stats.cjs'); console.log(JSON.stringify(computeStats(true)));"], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      env: { ...process.env, ANTIGRAVITY_DATA_DIR: tmpRoot, ANTIGRAVITY_DISABLE_PERSIST_CACHE: '1' },
    });
    assert(result.status === 0, `Transcript edge-case subprocess failed: ${result.stderr}`);
    const stats = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
    assert(stats.insights.totalThreads === 1, 'Transcript-only session should count as one thread');
    assert(stats.activity.totalTasks === 1, 'Only the valid timestamp should contribute a task');
    assert(!Object.keys(stats.activity.dailyStats).some(key => key.includes('NaN')), 'Invalid timestamps must not create NaN dates');
  } finally {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  }
});

test('Persistent cache defaults outside the Antigravity data directory', () => {
  const os = require('node:os');
  const { spawnSync } = require('node:child_process');
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-cache-location-'));
  try {
    const env = { ...process.env, ANTIGRAVITY_DATA_DIR: tmpRoot };
    delete env.ANTIGRAVITY_STATS_CACHE_PATH;
    const result = spawnSync(process.execPath, ['-e', "console.log(require('./scripts/aggregate-stats.cjs').getCacheFilePath())"], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      env,
    });
    assert(result.status === 0, `Cache path subprocess failed: ${result.stderr}`);
    const cachePath = result.stdout.trim().split(/\r?\n/).at(-1);
    assert(!cachePath.startsWith(tmpRoot), 'Default cache must not live under the Antigravity data directory');
  } finally {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  }
});


// ============================================================================
// TEST RUNNER
// ============================================================================

console.log('\n' + '='.repeat(60));
console.log('Antigravity Token Stats — Regression Test Suite');
console.log('='.repeat(60) + '\n');

for (const { name, fn } of TESTS) {
  try {
    fn();
    console.log('✅', name);
    passCount++;
  } catch (err) {
    console.log('❌', name);
    console.log('   Error:', err.message);
    failCount++;
  }
}

console.log('\n' + '='.repeat(60));
console.log(`Results: ${passCount} passed, ${failCount} failed`);
console.log('='.repeat(60) + '\n');

if (failCount > 0) {
  process.exit(1);
}
