const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { computeStats, readSingleSession } = require('./aggregate-stats.cjs');

console.log('--- Testing Context Usage Feature & Session Metadata ---');

const stats = computeStats(true);

assert.ok(stats, 'Stats should be computed');
assert.ok(stats.sessions, 'Stats should contain sessions dictionary');
assert.strictEqual(typeof stats.sessions, 'object', 'sessions must be an object');

const sessionIds = Object.keys(stats.sessions);
console.log(`PASS: Found ${sessionIds.length} sessions with per-session context metadata`);

if (sessionIds.length > 0) {
  const sample = stats.sessions[sessionIds[0]];
  assert.ok('promptTokens' in sample, 'Session should have promptTokens');
  assert.ok('latestInput' in sample, 'Session should have latestInput');
  assert.ok('latestCacheRead' in sample, 'Session should have latestCacheRead');
  assert.ok('latestOutput' in sample, 'Session should have latestOutput');
  assert.strictEqual(sample.compactionLimit, 256000, 'Compaction limit should be 256,000 (256k)');
  console.log('PASS: Sample session context structure verified:', {
    promptTokens: sample.promptTokens,
    latestInput: sample.latestInput,
    latestCacheRead: sample.latestCacheRead,
    compactionLimit: sample.compactionLimit,
  });

  // Warm up single-session path
  readSingleSession(sessionIds[0]);

  // Test readSingleSession (Fast-Path)
  console.log('--- Testing readSingleSession Fast-Path ---');
  const t0 = performance.now();
  const directSession = readSingleSession(sessionIds[0]);
  const duration = performance.now() - t0;

  assert.ok(directSession, 'Direct single session read should succeed');
  assert.strictEqual(directSession.sessionId, sessionIds[0]);
  assert.strictEqual(directSession.promptTokens, sample.promptTokens, 'Prompt tokens should match');
  assert.strictEqual(directSession.compactionLimit, 256000);
  // Includes the summaries-DB run-state lookup; still far below one full rescan.
  assert.ok(duration < 60, `Fast-path read should be < 60ms, got ${duration.toFixed(2)}ms`);
  console.log(`PASS: readSingleSession executed in ${duration.toFixed(2)}ms with matching ground truth`);

  // Edge cases
  assert.strictEqual(readSingleSession('non-existent-session-id-12345'), null);
  assert.strictEqual(readSingleSession('../traversal'), null);
  assert.strictEqual(readSingleSession(null), null);
  console.log('PASS: readSingleSession edge cases handled gracefully');
}

// --- Deterministic fixture: turn boundaries, run state, and brand-new conversations ---
console.log('--- Testing per-turn totals + run state on a synthetic session ---');

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

function makeUsage(input, output, cache, thinking, response) {
  // Same nesting as the real BLOB: outer 1 -> message, message.4 -> usage, message.19 -> model.
  const usage = Buffer.concat([
    Buffer.concat([Buffer.from([0x10]), encodeVarint(input)]),
    Buffer.concat([Buffer.from([0x18]), encodeVarint(output)]),
    Buffer.concat([Buffer.from([0x28]), encodeVarint(cache)]),
    Buffer.concat([Buffer.from([0x48]), encodeVarint(thinking)]),
    Buffer.concat([Buffer.from([0x50]), encodeVarint(response)]),
  ]);
  const model = Buffer.from('gemini-3.8-flash', 'utf8');
  const message = Buffer.concat([
    Buffer.from([0x22, usage.length]), usage,
    Buffer.from([0x9a, 0x01, model.length]), model,
  ]);
  return Buffer.concat([Buffer.from([0x0a, message.length]), message]);
}

function makeTimestamp(seconds) {
  const inner = Buffer.concat([Buffer.from([0x08]), encodeVarint(seconds)]);
  return Buffer.concat([Buffer.from([0x0a, inner.length]), inner]);
}

const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-context-'));
process.on('exit', () => {
  try { fs.rmSync(fixtureDir, { recursive: true, force: true }); } catch {}
});

const convDir = path.join(fixtureDir, 'conversations');
fs.mkdirSync(convDir, { recursive: true });

const turnStartSec = 1790000000;
const runningId = 'fixture-running';
const freshId = 'fixture-fresh';

const runningDb = new DatabaseSync(path.join(convDir, `${runningId}.db`));
runningDb.exec('CREATE TABLE gen_metadata (idx INTEGER, data BLOB); CREATE TABLE steps (idx INTEGER, step_type INTEGER, step_payload BLOB, metadata BLOB);');
const usages = [
  [100, 50, 1000, 10, 40],
  [10, 20, 1100, 5, 15],
  [5, 7, 1200, 2, 5],
  [6, 8, 1300, 3, 5],
];
usages.forEach((u, i) => runningDb.prepare('INSERT INTO gen_metadata (idx, data) VALUES (?, ?)').run(i, makeUsage(...u)));
const steps = [
  [0, 14, makeTimestamp(turnStartSec)],
  [1, 15, makeTimestamp(turnStartSec + 5)],
  [2, 15, makeTimestamp(turnStartSec + 10)],
  [3, 14, makeTimestamp(turnStartSec + 20)],
  [4, 15, makeTimestamp(turnStartSec + 25)],
  [5, 132, makeTimestamp(turnStartSec + 26)],
  [6, 15, makeTimestamp(turnStartSec + 30)],
];
for (const [idx, type, meta] of steps) {
  runningDb.prepare('INSERT INTO steps (idx, step_type, step_payload, metadata) VALUES (?, ?, ?, ?)').run(idx, type, type === 132 ? Buffer.from('{"tool":"run_command"}') : null, meta);
}
runningDb.close();

// A conversation whose first model call has not landed yet: no gen_metadata rows.
const freshDb = new DatabaseSync(path.join(convDir, `${freshId}.db`));
freshDb.exec('CREATE TABLE gen_metadata (idx INTEGER, data BLOB); CREATE TABLE steps (idx INTEGER, step_type INTEGER, step_payload BLOB, metadata BLOB);');
freshDb.prepare('INSERT INTO steps (idx, step_type, step_payload, metadata) VALUES (?, ?, ?, ?)').run(0, 14, null, makeTimestamp(turnStartSec));
freshDb.close();

const summaries = new DatabaseSync(path.join(fixtureDir, 'conversation_summaries.db'));
summaries.exec('CREATE TABLE conversation_summaries (conversation_id TEXT, status TEXT, not_fully_idle numeric);');
summaries.prepare('INSERT INTO conversation_summaries VALUES (?, ?, ?)').run(runningId, 'CASCADE_RUN_STATUS_RUNNING', 0);
summaries.prepare('INSERT INTO conversation_summaries VALUES (?, ?, ?)').run(freshId, 'CASCADE_RUN_STATUS_IDLE', 0);
summaries.close();

const previousDataDir = process.env.ANTIGRAVITY_DATA_DIR;
const previousCacheFlag = process.env.ANTIGRAVITY_DISABLE_PERSIST_CACHE;
process.env.ANTIGRAVITY_DATA_DIR = fixtureDir;
process.env.ANTIGRAVITY_DISABLE_PERSIST_CACHE = '1';

try {
  const turnExpected = (5 + 1200 + 7) + (6 + 1300 + 8);
  const single = readSingleSession(runningId);
  assert.ok(single, 'Fixture session should be readable');
  assert.strictEqual(single.turnCalls, 2, 'Only calls after the last user input count toward the turn');
  assert.strictEqual(single.turnTokens, turnExpected, 'Turn tokens must sum exactly the last two generations');
  assert.strictEqual(single.promptTokens, 6 + 1300, 'Context occupancy stays the last completed request');
  assert.strictEqual(single.isRunning, true, 'RUNNING in conversation_summaries must surface as isRunning');
  assert.strictEqual(single.turnStartedAt, (turnStartSec + 20) * 1000, 'Turn start comes from the last user step timestamp');

  const fresh = readSingleSession(freshId);
  assert.ok(fresh, 'A conversation without generations must still return a snapshot');
  assert.strictEqual(fresh.promptTokens, 0);
  assert.strictEqual(fresh.turnCalls, 0);
  assert.strictEqual(fresh.isRunning, false);

  const fixtureStats = computeStats(true);
  assert.strictEqual(fixtureStats.sessions[runningId].isRunning, true);
  assert.strictEqual(fixtureStats.sessions[runningId].turnCalls, 2);
  assert.strictEqual(fixtureStats.sessions[runningId].turnTokens, turnExpected);
  assert.strictEqual(fixtureStats.sessions[freshId].isRunning, false);
  assert.strictEqual(fixtureStats.sessions[freshId].turnCalls, 0);
  console.log('PASS: per-turn totals, zero-state snapshot and run state verified');
} finally {
  if (previousDataDir === undefined) delete process.env.ANTIGRAVITY_DATA_DIR;
  else process.env.ANTIGRAVITY_DATA_DIR = previousDataDir;
  if (previousCacheFlag === undefined) delete process.env.ANTIGRAVITY_DISABLE_PERSIST_CACHE;
  else process.env.ANTIGRAVITY_DISABLE_PERSIST_CACHE = previousCacheFlag;
}

console.log('ALL Context Usage tests passed successfully!\n');
