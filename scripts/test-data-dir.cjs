#!/usr/bin/env node

// Verifies the data-directory resolution contract of aggregate-stats.cjs:
// explicit argument > ANTIGRAVITY_DATA_DIR > %USERPROFILE%/.gemini/antigravity.
// Temp roots make every tier observable without touching real session data.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const { computeStats, readSingleSession } = require('./aggregate-stats.cjs');

const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-data-dir-env-'));
const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-data-dir-explicit-'));
const ENV_SESSION = 'priority-env-session';
const EXPLICIT_SESSION = 'priority-explicit-session';

function makeUsagePayload(inputTokens) {
  // gen_metadata protobuf: tag 2 input_tokens, tag 3 output_tokens, tag 5 cache_read_tokens
  const usage = Buffer.from([
    0x10, ...varint(inputTokens),
    0x18, 0xc8, 0x01,       // output_tokens = 200
    0x28, 0xa8, 0x46,       // cache_read_tokens = 9000
  ]);
  const model = Buffer.from('gemini-3.8-flash', 'utf8');
  const msg1 = Buffer.concat([
    Buffer.from([0x22, usage.length]), usage,
    Buffer.from([0x9a, 0x01, model.length]), model,
  ]);
  return Buffer.concat([Buffer.from([0x0a, msg1.length]), msg1]);
}

function varint(num) {
  const bytes = [];
  let v = num;
  while (v >= 0x80) {
    bytes.push((v & 0x7f) | 0x80);
    v >>= 7;
  }
  bytes.push(v);
  return bytes;
}

function seedSession(root, sessionId, inputTokens) {
  const convDir = path.join(root, 'conversations');
  fs.mkdirSync(convDir, { recursive: true });
  const db = new DatabaseSync(path.join(convDir, `${sessionId}.db`));
  db.exec('CREATE TABLE gen_metadata (idx INTEGER, data BLOB); CREATE TABLE steps (idx INTEGER, step_type INTEGER, step_payload BLOB, metadata BLOB);');
  db.prepare('INSERT INTO gen_metadata (idx, data) VALUES (?, ?)').run(1, makeUsagePayload(inputTokens));
  db.close();
}

try {
  seedSession(dirA, ENV_SESSION, 1000);
  seedSession(dirB, EXPLICIT_SESSION, 7000);

  const savedEnv = process.env.ANTIGRAVITY_DATA_DIR;
  const savedDisableCache = process.env.ANTIGRAVITY_DISABLE_PERSIST_CACHE;
  process.env.ANTIGRAVITY_DATA_DIR = dirA;
  process.env.ANTIGRAVITY_DISABLE_PERSIST_CACHE = '1';

  try {
    // Tier 2: env wins when no explicit argument is given.
    const fromEnv = computeStats(true);
    assert(fromEnv.sessions[ENV_SESSION], 'env ANTIGRAVITY_DATA_DIR session should be scanned');

    // Tier 1: explicit argument wins over env.
    const fromExplicit = computeStats(true, dirB);
    assert(fromExplicit.sessions[EXPLICIT_SESSION], 'explicit dataDir session should be scanned');
    assert(!fromExplicit.sessions[ENV_SESSION], 'explicit dataDir must not leak the env root session');

    // The fast-scan TTL cache is per data root: switching roots must rescan, not serve the other root.
    const switched = computeStats(false, dirA);
    assert(switched.sessions[ENV_SESSION] && !switched.sessions[EXPLICIT_SESSION], 'TTL cache must follow the requested data root');
    const stillExplicit = computeStats(false, dirB);
    assert(stillExplicit.sessions[EXPLICIT_SESSION] && !stillExplicit.sessions[ENV_SESSION], 'repeat call within TTL should reuse the same root snapshot');

    // readSingleSession follows the same resolution order.
    const explicitSingle = readSingleSession(EXPLICIT_SESSION, dirB);
    assert(explicitSingle && explicitSingle.totalInputTokens === 7000, 'readSingleSession should honor the explicit dataDir');
    assert.strictEqual(readSingleSession(EXPLICIT_SESSION), null, 'readSingleSession without explicit dataDir must not read another root session');

    // An explicit root with no data degrades to the empty baseline instead of crashing.
    const missing = computeStats(true, path.join(os.tmpdir(), 'antigravity-data-dir-missing-'));
    assert.strictEqual(missing.meta.scannedConversations, 0, 'missing explicit dataDir should yield an empty scan');
    assert(missing.kpis && missing.tokenBreakdown, 'missing explicit dataDir should keep the stats shape');
  } finally {
    if (savedEnv === undefined) delete process.env.ANTIGRAVITY_DATA_DIR;
    else process.env.ANTIGRAVITY_DATA_DIR = savedEnv;
    if (savedDisableCache === undefined) delete process.env.ANTIGRAVITY_DISABLE_PERSIST_CACHE;
    else process.env.ANTIGRAVITY_DISABLE_PERSIST_CACHE = savedDisableCache;
  }

  console.log('PASS: aggregate-stats resolves dataDir as explicit argument > ANTIGRAVITY_DATA_DIR > default, per root');
} finally {
  try { fs.rmSync(dirA, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(dirB, { recursive: true, force: true }); } catch {}
}
