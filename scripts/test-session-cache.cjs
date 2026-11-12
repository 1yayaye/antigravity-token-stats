const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite = require('node:sqlite');
const DatabaseSync = sqlite.DatabaseSync;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-session-cache-'));
const dbPath = path.join(root, 'conversations', 'fixture.db');
let sessionOpens = 0;
let locked = false;
sqlite.DatabaseSync = class extends DatabaseSync {
  constructor(filename, options) {
    if (filename === dbPath) {
      sessionOpens++;
      if (locked) throw Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' });
    }
    super(filename, options);
  }
};
const { computeStats, readSingleSession } = require('./aggregate-stats.cjs');
const previousDisabled = process.env.ANTIGRAVITY_DISABLE_PERSIST_CACHE;
process.env.ANTIGRAVITY_DISABLE_PERSIST_CACHE = '1';
fs.mkdirSync(path.dirname(dbPath));
const db = new DatabaseSync(dbPath);
const summaries = new DatabaseSync(path.join(root, 'conversation_summaries.db'));

function usage(input) {
  const values = Buffer.from([0x10, input, 0x18, 20, 0x28, 30]);
  const model = Buffer.from('gemini-flash');
  const message = Buffer.concat([Buffer.from([0x22, values.length]), values, Buffer.from([0x9a, 1, model.length]), model]);
  return Buffer.concat([Buffer.from([0x0a, message.length]), message]);
}

try {
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE gen_metadata (idx INTEGER, data BLOB); CREATE TABLE steps (idx INTEGER, step_type INTEGER, step_payload BLOB, metadata BLOB); INSERT INTO steps (idx, step_type) VALUES (0,14),(1,15),(2,132);');
  const insert = db.prepare('INSERT INTO gen_metadata VALUES (?, ?)');
  insert.run(1, usage(10));
  summaries.exec("CREATE TABLE conversation_summaries (conversation_id TEXT, status TEXT, not_fully_idle INTEGER); INSERT INTO conversation_summaries VALUES ('fixture','CASCADE_RUN_STATUS_IDLE',0);");

  const first = readSingleSession('fixture', root);
  assert.equal(first.totalTokens, 60);
  const opened = sessionOpens;
  assert.equal(readSingleSession('fixture', root).totalTokens, 60);
  assert.equal(sessionOpens, opened, 'Unchanged heartbeat must not reopen the session DB');
  const full = computeStats(true, root).sessions.fixture;
  assert.equal(sessionOpens, opened, 'Full scan must reuse the single-session snapshot');
  for (const key of Object.keys(full)) {
    if (key in first) assert.deepEqual(first[key], full[key], `Both readers must agree on ${key}`);
  }
  console.log('PASS: single and full reads share cached metrics and telemetry');

  summaries.exec('UPDATE conversation_summaries SET not_fully_idle=1;');
  assert.equal(readSingleSession('fixture', root).isRunning, true);
  assert.equal(sessionOpens, opened, 'Run state must update independently of cached usage');
  console.log('PASS: run state stays live while usage remains cached');

  const beforeDb = fs.statSync(dbPath);
  insert.run(2, usage(40));
  assert.equal(fs.statSync(dbPath).mtimeMs, beforeDb.mtimeMs, 'The fixture must change WAL only');
  assert.equal(readSingleSession('fixture', root).totalTokens, 150);
  assert.equal(sessionOpens, opened + 1, 'WAL changes must invalidate the snapshot');
  console.log('PASS: WAL-only writes invalidate session usage');

  insert.run(3, usage(70));
  locked = true;
  assert.equal(readSingleSession('fixture', root).totalTokens, 150, 'A busy DB must retain the last good snapshot');
  const stale = computeStats(true, root);
  assert.equal(stale.meta.hasStaleSessions, true);
  assert.equal(stale.kpis.lifetimeTokensRaw, 150);
  locked = false;
  const recovered = computeStats(true, root);
  assert.equal(recovered.meta.hasStaleSessions, false);
  assert.equal(recovered.kpis.lifetimeTokensRaw, 270);
  assert.equal(readSingleSession('fixture', root).totalTokens, 270);
  console.log('PASS: busy fallback stays stale until a successful retry');

  assert.equal(readSingleSession('../fixture', root), null);
  assert.equal(readSingleSession('missing', root), null);
} finally {
  locked = false;
  db.close();
  summaries.close();
  sqlite.DatabaseSync = DatabaseSync;
  if (previousDisabled === undefined) delete process.env.ANTIGRAVITY_DISABLE_PERSIST_CACHE;
  else process.env.ANTIGRAVITY_DISABLE_PERSIST_CACHE = previousDisabled;
  fs.rmSync(root, { recursive: true, force: true });
}
