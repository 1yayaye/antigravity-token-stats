#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert');
const { DatabaseSync } = require('node:sqlite');
const { spawnSync } = require('node:child_process');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-persistent-cache-'));
const cachePath = path.join(root, 'stats-cache.json');
const dbPath = path.join(root, 'conversations', 'cache-session.db');
const transcriptPath = path.join(root, 'brain', 'cache-session', '.system_generated', 'logs', 'transcript.jsonl');

function makeUsagePayload() {
  const usage = Buffer.from([
    0x10, 0xe8, 0x07,
    0x18, 0xc8, 0x01,
    0x28, 0xa8, 0x46,
    0x48, 0x96, 0x01,
    0x50, 0x32,
  ]);
  const model = Buffer.from('gemini-3.8-flash', 'utf8');
  const msg1 = Buffer.concat([
    Buffer.from([0x22, usage.length]), usage,
    Buffer.from([0x9a, 0x01, model.length]), model,
  ]);
  return Buffer.concat([Buffer.from([0x0a, msg1.length]), msg1]);
}

function prepareData() {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.mkdirSync(path.dirname(transcriptPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE gen_metadata (idx INTEGER, data BLOB); CREATE TABLE steps (idx INTEGER, step_type INTEGER, step_payload BLOB);');
  db.prepare('INSERT INTO gen_metadata (idx, data) VALUES (?, ?)').run(1, makeUsagePayload());
  db.close();
  fs.writeFileSync(transcriptPath, [
    JSON.stringify({ created_at: '2026-09-18T00:00:00.000Z', type: 'USER_INPUT' }),
    JSON.stringify({ created_at: '2026-09-18T00:00:01.000Z', type: 'PLANNER_RESPONSE' }),
  ].join('\n') + '\n', 'utf8');
}

function runAggregator() {
  const env = {
    ...process.env,
    ANTIGRAVITY_DATA_DIR: root,
    ANTIGRAVITY_STATS_CACHE_PATH: cachePath,
  };
  delete env.ANTIGRAVITY_DISABLE_PERSIST_CACHE;
  const result = spawnSync(process.execPath, ['-e', "const { computeStats } = require('./scripts/aggregate-stats.cjs'); console.log(JSON.stringify(computeStats(true)));"], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    env,
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
}

function withoutUpdatedAt(stats) {
  const copy = JSON.parse(JSON.stringify(stats));
  delete copy.meta.updatedAt;
  return copy;
}

try {
  prepareData();
  const first = runAggregator();
  assert(fs.existsSync(cachePath), 'Process A should write the persistent cache');
  const firstCache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  assert.strictEqual(firstCache.version, 3, 'Cache version should be 3');
  assert(firstCache.dbs['cache-session'], 'Cache should contain database metrics');
  assert(firstCache.transcripts['cache-session'], 'Cache should contain transcript metrics');

  const second = runAggregator();
  assert.deepStrictEqual(withoutUpdatedAt(second), withoutUpdatedAt(first), 'A new process should reproduce cached statistics');

  const originalDbFingerprint = firstCache.dbs['cache-session'].fingerprint;
  const originalTranscriptFingerprint = firstCache.transcripts['cache-session'].fingerprint;
  fs.appendFileSync(transcriptPath, JSON.stringify({ created_at: '2026-09-18T00:00:02.000Z', type: 'USER_INPUT' }) + '\n');
  const third = runAggregator();
  const thirdCache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  assert.strictEqual(third.activity.totalTasks, first.activity.totalTasks + 1, 'Changed transcript should update only its session statistics');
  assert.deepStrictEqual(thirdCache.dbs['cache-session'].fingerprint, originalDbFingerprint, 'Unchanged database cache should be reused');
  assert.notDeepStrictEqual(thirdCache.transcripts['cache-session'].fingerprint, originalTranscriptFingerprint, 'Changed transcript fingerprint should be refreshed');

  fs.writeFileSync(cachePath, '{', 'utf8');
  const recovered = runAggregator();
  assert.deepStrictEqual(withoutUpdatedAt(recovered), withoutUpdatedAt(third), 'Corrupt cache should fall back to a complete scan');
  console.log('PASS: persistent cache survives restart, invalidates one transcript, and recovers from corrupt JSON');
} finally {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
}
