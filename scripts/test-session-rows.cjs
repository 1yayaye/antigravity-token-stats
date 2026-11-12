const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { computeStats } = require('./aggregate-stats.cjs');
const loader = require('../hosts/antigravity/scripts/loader.cjs');

console.log('--- Testing session live-window trim, cost, and broadcast pinning ---');

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

// Same nesting as the real BLOB: outer 1 -> message, message.4 -> usage, message.19 -> model.
function makeUsageBlob(inputTokens, modelName) {
  const usage = Buffer.concat([Buffer.from([0x10]), encodeVarint(inputTokens)]);
  const model = Buffer.from(modelName, 'utf8');
  const message = Buffer.concat([
    Buffer.from([0x22, usage.length]), usage,
    Buffer.from([0x9a, 0x01, model.length]), model,
  ]);
  return Buffer.concat([Buffer.from([0x0a, message.length]), message]);
}

function makeSessionDb(convDir, sessionId, inputs, modelName = 'gemini-2.5-pro') {
  const db = new DatabaseSync(path.join(convDir, `${sessionId}.db`));
  db.exec('CREATE TABLE gen_metadata (idx INTEGER, data BLOB); CREATE TABLE steps (idx INTEGER, step_type INTEGER, step_payload BLOB, metadata BLOB);');
  inputs.forEach((input, i) => {
    db.prepare('INSERT INTO gen_metadata (idx, data) VALUES (?, ?)').run(i, makeUsageBlob(input, modelName));
  });
  db.close();
}

const DAY_MS = 24 * 60 * 60 * 1000;

const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-session-rows-'));
process.on('exit', () => {
  try { fs.rmSync(fixtureDir, { recursive: true, force: true }); } catch {}
});

const convDir = path.join(fixtureDir, 'conversations');
fs.mkdirSync(convDir, { recursive: true });

// gemini-2.5-pro bills $2 per 1M input tokens, so each session's expected cost is exact.
makeSessionDb(convDir, 'row-recent', [1000000]);            // $2, mtime = now
makeSessionDb(convDir, 'row-running', [500000]);            // $1, mtime = 3 days ago, host says running
makeSessionDb(convDir, 'row-old', [1000000, 1000000]);      // $4, mtime = 3 days ago, idle

const threeDaysAgo = new Date(Date.now() - 3 * DAY_MS);
fs.utimesSync(path.join(convDir, 'row-running.db'), threeDaysAgo, threeDaysAgo);
fs.utimesSync(path.join(convDir, 'row-old.db'), threeDaysAgo, threeDaysAgo);

const summaries = new DatabaseSync(path.join(fixtureDir, 'conversation_summaries.db'));
summaries.exec('CREATE TABLE conversation_summaries (conversation_id TEXT, status TEXT, not_fully_idle numeric);');
summaries.prepare('INSERT INTO conversation_summaries VALUES (?, ?, ?)').run('row-running', 'CASCADE_RUN_STATUS_RUNNING', 0);
summaries.close();

const previousDataDir = process.env.ANTIGRAVITY_DATA_DIR;
const previousCacheFlag = process.env.ANTIGRAVITY_DISABLE_PERSIST_CACHE;
process.env.ANTIGRAVITY_DATA_DIR = fixtureDir;
process.env.ANTIGRAVITY_DISABLE_PERSIST_CACHE = '1';

try {
  const stats = computeStats(true);

  assert.ok(!('sessionRows' in stats), 'Unused sessionRows must not be present on stats');
  assert.ok(!('insights' in stats), 'Unused insights must not be present on stats');

  // Live trim: sessions keeps running + recent + the newest, drops stale idle history.
  assert.ok(stats.sessions['row-recent'], 'A session touched today must keep full live detail');
  assert.ok(stats.sessions['row-running'], 'A running session must keep full live detail despite its old mtime');
  assert.ok(!stats.sessions['row-old'], 'A stale idle session must not ship full live detail');
  assert.strictEqual(stats.sessions['row-recent'].costUsd, 2, 'Live summaries must carry the session cost');
  assert.strictEqual(stats.sessions['row-running'].isRunning, true, 'Host run state must surface in live session summaries');
  console.log('PASS: sessions trimmed to running/recent while costs stay attached');

  // Loader broadcast preservation: an on-demand >24h session stays intact across full broadcasts.
  loader.pushSessionUpdate('row-old');
  const afterPush = computeStats(true);
  assert.ok(!afterPush.sessions['row-old'], 'computeStats itself still trims row-old');
  loader.broadcastStats(afterPush);
  assert.ok(afterPush.sessions['row-old'], 'loader.broadcastStats must preserve pinned on-demand session row-old');
  assert.strictEqual(afterPush.sessions['row-old'].totalTokens, 2000000, 'Preserved session must retain its real token total');
  console.log('PASS: loader preserves on-demand stale session across full broadcasts');

  // Newest-kept rule: a lone stale idle session must still be reachable by the pill/IDE.
  const loneDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-session-lone-'));
  try {
    fs.mkdirSync(path.join(loneDir, 'conversations'), { recursive: true });
    makeSessionDb(path.join(loneDir, 'conversations'), 'lone-old', [1000000]);
    fs.utimesSync(path.join(loneDir, 'conversations', 'lone-old.db'), threeDaysAgo, threeDaysAgo);
    process.env.ANTIGRAVITY_DATA_DIR = loneDir;
    const loneStats = computeStats(true);
    assert.ok(loneStats.sessions['lone-old'], 'The single newest session must keep live detail even when stale');
    assert.strictEqual(loneStats.sessions['lone-old'].costUsd, 2, 'Lone session cost must be exact');
  } finally {
    process.env.ANTIGRAVITY_DATA_DIR = fixtureDir;
    try { fs.rmSync(loneDir, { recursive: true, force: true }); } catch {}
  }
  console.log('PASS: newest session survives the live window');

  // Empty baseline carries the same shape.
  const empty = computeStats(true, path.join(os.tmpdir(), 'antigravity-no-such-dir-xyz'));
  assert.deepStrictEqual(empty.sessions, {}, 'Empty stats must expose an empty sessions map');
  console.log('PASS: empty baseline shape');
} finally {
  if (previousDataDir === undefined) delete process.env.ANTIGRAVITY_DATA_DIR;
  else process.env.ANTIGRAVITY_DATA_DIR = previousDataDir;
  if (previousCacheFlag === undefined) delete process.env.ANTIGRAVITY_DISABLE_PERSIST_CACHE;
  else process.env.ANTIGRAVITY_DISABLE_PERSIST_CACHE = previousCacheFlag;
}

console.log('ALL session-rows tests passed successfully!\n');
