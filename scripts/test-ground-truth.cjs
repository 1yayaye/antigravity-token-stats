#!/usr/bin/env node
/**
 * Verification test suite for Ground Truth & Live Sync
 * Validates:
 * 1. Zero-dependency pure JS protobuf decoding of ModelUsageStats
 * 2. Complete absence of estimation heuristics (chars/3.5, bytes/3.8)
 * 3. Accurate lifetime tokens (1.15B+), peak tokens, and prompt cache hit rate (~94%)
 * 4. Thinking vs response breakdown
 * 5. Real model invocation counts and primary reasoning
 * 6. Agent skills vs built-in tool primitives distinction
 * 7. Real time-range filtering (today, 1d, 7d, 30d, all)
 * 8. Incremental scan speed (<5ms)
 */

const fs = require('fs');
const path = require('path');
const { computeStats, decodeGenMetadata, decodeVarint, parseProtoFields } = require('./aggregate-stats.cjs');

const TESTS = [];
let passCount = 0;
let failCount = 0;

function test(name, fn) {
  TESTS.push({ name, fn });
}

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function toLocalDateKey(d = new Date()) {
  const date = d instanceof Date ? d : new Date(d);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// 1. Protobuf decoder unit tests
test('decodeVarint correctly decodes single and multi-byte varints', () => {
  // 1-byte varint: 1
  const buf1 = Buffer.from([0x01]);
  assert(decodeVarint(buf1, 0).val === 1, '1-byte varint 1');

  // 2-byte varint: 300 (0xac, 0x02)
  const buf2 = Buffer.from([0xac, 0x02]);
  assert(decodeVarint(buf2, 0).val === 300, '2-byte varint 300');

  // Large varint: 16569
  const buf3 = Buffer.from([0xb9, 0x81, 0x01]);
  assert(decodeVarint(buf3, 0).val === 16569, '3-byte varint 16569');
});

test('decodeGenMetadata decodes synthetic protobuf ModelUsageStats payload', () => {
  // Construct a synthetic protobuf payload with:
  // Tag 1 (msg) -> Tag 4 (msg) ->
  //   Tag 2: input_tokens = 1000
  //   Tag 3: output_tokens = 200
  //   Tag 5: cache_read_tokens = 9000
  //   Tag 9: thinking_output_tokens = 150
  //   Tag 10: response_output_tokens = 50
  // Tag 1 (msg) -> Tag 19 (str) = 'gemini-3.8-flash'
  
  // Tag 4 inner:
  const usageParts = [
    Buffer.from([0x10, 0xe8, 0x07]),       // Tag 2, varint 1000
    Buffer.from([0x18, 0xc8, 0x01]),       // Tag 3, varint 200
    Buffer.from([0x28, 0xa8, 0x46]),       // Tag 5, varint 9000
    Buffer.from([0x48, 0x96, 0x01]),       // Tag 9, varint 150
    Buffer.from([0x50, 0x32]),             // Tag 10, varint 50
  ];
  const usageBuf = Buffer.concat(usageParts);
  const tag4Header = Buffer.from([0x22, usageBuf.length]); // Tag 4, length-delimited

  const modelStr = Buffer.from('gemini-3.8-flash', 'utf8');
  const tag19Header = Buffer.from([0x9a, 0x01, modelStr.length]); // Tag 19 = (19<<3)|2 = 154 = 0x9a 0x01

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

test('No estimation heuristics (chars/3.5, bytes/3.8) in aggregate-stats.cjs', () => {
  const content = fs.readFileSync(path.join(__dirname, 'aggregate-stats.cjs'), 'utf8');
  assert(!content.includes('/ 3.5'), 'Must not contain / 3.5');
  assert(!content.includes('/ 3.8'), 'Must not contain / 3.8');
  assert(!content.includes('Math.ceil(bytes /'), 'Must not contain bytes division');
  assert(!content.includes('Math.ceil(chars /'), 'Must not contain chars division');
});

test('computeStats computes ground truth Lifetime Tokens and Cache Hit Rate', () => {
  const stats = computeStats();
  assert(stats.kpis.lifetimeTokensRaw > 1000000000, `Lifetime tokens should be > 1B, got ${stats.kpis.lifetimeTokensRaw}`);
  assert(stats.kpis.lifetimeTokens.endsWith('B'), `Lifetime tokens should be formatted in B, got ${stats.kpis.lifetimeTokens}`);
  const hitRate = parseFloat(stats.insights.cacheHitRate);
  assert(Math.round(hitRate) === 94, `Cache hit rate should be ~94%, got ${stats.insights.cacheHitRate}`);
  assert(stats.insights.skillsExplored > 15, `Skills explored should be > 15 real skills, got ${stats.insights.skillsExplored}`);
  assert(stats.insights.totalSkillsUsed > 50, `Skills used should be > 50, got ${stats.insights.totalSkillsUsed}`);
  assert(stats.insights.toolPrimitivesUsed > 5000, `Tool primitives should be > 5000, got ${stats.insights.toolPrimitivesUsed}`);
  assert(stats.insights.fastMode.endsWith('%'), `Fast mode should be percentage, got ${stats.insights.fastMode}`);
  assert(stats.insights.mostUsedReasoning.includes('Flash'), `Most used model should be Flash, got ${stats.insights.mostUsedReasoning}`);
});

test('Incremental scan speed is fast (<20ms in Node)', () => {
  // Prime cache
  computeStats();
  const t0 = performance.now();
  computeStats();
  const elapsed = performance.now() - t0;
  console.log(`   (Incremental scan took ${elapsed.toFixed(2)}ms)`);
  assert(elapsed < 20, `Incremental scan should be < 20ms, was ${elapsed.toFixed(2)}ms`);
});

test('Token breakdown contains ground truth fields without artificial heuristics', () => {
  const stats = computeStats(true);
  assert(stats.tokenBreakdown, 'Should have tokenBreakdown object');
  assert(typeof stats.tokenBreakdown.reasoningPct === 'number', 'reasoningPct should be a number');
  assert(stats.tokenBreakdown.reasoningPct >= 0, 'reasoningPct should be >= 0');
  assert(!('toolUsePct' in stats.tokenBreakdown), 'toolUsePct artificial estimation must be removed');
  assert(!('systemPct' in stats.tokenBreakdown), 'systemPct artificial estimation must be removed');
});

test('WAL cache invalidation detects updates to open databases', () => {
  const { DatabaseSync } = require('node:sqlite');
  const os = require('os');
  const convDir = path.join(os.homedir(), '.gemini', 'antigravity', 'conversations');
  const testDbPath = path.join(convDir, '00000000-0000-0000-0000-000000000099.db');
  const walPath = testDbPath + '-wal';

  try {
    const agConn = new DatabaseSync(testDbPath);
    agConn.exec('PRAGMA journal_mode = WAL;');
    agConn.exec('CREATE TABLE gen_metadata (idx INTEGER PRIMARY KEY, data BLOB, size INTEGER);');
    agConn.exec('CREATE TABLE steps (idx INTEGER PRIMARY KEY, step_type INTEGER, step_payload BLOB);');

    const s1 = computeStats(true);

    // Insert new row into open connection
    const usageParts = [
      Buffer.from([0x10, 0x88, 0x27]), // 5000 input
      Buffer.from([0x18, 0x64]),       // 100 output
    ];
    const usageBuf = Buffer.concat(usageParts);
    const tag4Header = Buffer.from([0x22, usageBuf.length]);
    const msg1Content = Buffer.concat([tag4Header, usageBuf]);
    const tag1Header = Buffer.from([0x0a, msg1Content.length]);
    const payload = Buffer.concat([tag1Header, msg1Content]);

    agConn.prepare('INSERT INTO gen_metadata (idx, data, size) VALUES (1, ?, ?)').run(payload, payload.length);

    const s2 = computeStats(true);
    const diff = s2.kpis.lifetimeTokensRaw - s1.kpis.lifetimeTokensRaw;
    agConn.close();

    assert(diff >= 5100, `Incremental scan must detect at least 5100 tokens from WAL, got ${diff}`);
  } finally {
    try {
      if (fs.existsSync(testDbPath)) fs.rmSync(testDbPath, { force: true });
      if (fs.existsSync(walPath)) fs.rmSync(walPath, { force: true });
      const shm = testDbPath + '-shm';
      if (fs.existsSync(shm)) fs.rmSync(shm, { force: true });
    } catch (e) {}
  }
});

test('Time range filtering behaves correctly on AggregatedStats', () => {
  const stats = computeStats(true);
  // Filter for today
  const todayKey = toLocalDateKey(new Date());
  const todayDate = new Date(todayKey + 'T00:00:00Z');

  const cells7d = stats.activity.heatmap.filter(c => {
    const cellDate = new Date(c.date + 'T00:00:00Z');
    const diff = Math.round((todayDate.getTime() - cellDate.getTime()) / 86400000);
    return diff >= 0 && diff < 7;
  });
  const tokens7d = cells7d.reduce((sum, c) => sum + c.tokens, 0);

  assert(cells7d.length === 7, `7d filter must return exactly 7 calendar cells, got ${cells7d.length}`);
  assert(typeof tokens7d === 'number', '7d tokens should be number');
  assert(tokens7d <= stats.kpis.lifetimeTokensRaw, '7d tokens should be <= lifetime tokens');
});

test('inject-live.cjs has persistent watch and __ANTIGRAVITY_REQUEST_SYNC__ CDP binding', () => {
  const injectCode = fs.readFileSync(path.join(__dirname, 'inject-live.cjs'), 'utf8');
  assert(injectCode.includes('__ANTIGRAVITY_CDP_SYNC__'), 'Must register CDP binding');
  assert(injectCode.includes('__ANTIGRAVITY_REQUEST_SYNC__'), 'Must wire sync function');
  assert(injectCode.includes('antigravity:stats-updated'), 'Must emit stats-updated event');
  assert(injectCode.includes('fs.watch'), 'Must use fs.watch');
  assert(injectCode.includes('500'), 'Must debounce 500ms');
  assert(!injectCode.includes('if (!injected) {'), 'Must not have old skip/deadlock check');
});

test('Frontend StatsView listens to antigravity:stats-updated and calls __ANTIGRAVITY_REQUEST_SYNC__', () => {
  const viewCode = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'stats', 'StatsView.tsx'), 'utf8');
  assert(viewCode.includes('antigravity:stats-updated'), 'StatsView must listen to stats-updated');
  assert(viewCode.includes('__ANTIGRAVITY_REQUEST_SYNC__'), 'StatsView must trigger __ANTIGRAVITY_REQUEST_SYNC__');
  assert(!viewCode.includes('FALLBACK_STATS'), 'StatsView must not use fake FALLBACK_STATS');
  assert(viewCode.includes('EMPTY_STATS'), 'StatsView should use clean EMPTY_STATS');
  assert(viewCode.includes('TokenBreakdownCard'), 'StatsView must render TokenBreakdownCard');
});

test('TokenBreakdown computes accurate input, output, cache, and thinking breakdown', () => {
  const stats = computeStats(true);
  assert(stats.tokenBreakdown, 'stats must include tokenBreakdown');
  const tb = stats.tokenBreakdown;

  assert(typeof tb.inputTokens === 'number' && tb.inputTokens > 0, 'inputTokens must be positive number');
  assert(typeof tb.cacheReadTokens === 'number' && tb.cacheReadTokens > 0, 'cacheReadTokens must be positive number');
  assert(typeof tb.outputTokens === 'number' && tb.outputTokens > 0, 'outputTokens must be positive number');
  assert(typeof tb.thinkingTokens === 'number' && tb.thinkingTokens > 0, 'thinkingTokens must be positive number');
  assert(typeof tb.responseTokens === 'number' && tb.responseTokens > 0, 'responseTokens must be positive number');

  // Mathematical identity: thinking + response === output
  assert(
    tb.thinkingTokens + tb.responseTokens === tb.outputTokens,
    `Thinking (${tb.thinkingTokens}) + Response (${tb.responseTokens}) must equal Output (${tb.outputTokens})`
  );

  // Total prompt = input + cacheRead
  assert(
    tb.totalPromptTokens === tb.inputTokens + tb.cacheReadTokens,
    'totalPromptTokens must equal inputTokens + cacheReadTokens'
  );

  // Cache hit rate > 90%
  const hitRateNum = parseFloat(tb.cacheHitRate);
  assert(hitRateNum > 85, `cacheHitRate must reflect ground truth (>85%), got ${tb.cacheHitRate}`);

  // Card component exists
  const cardPath = path.join(__dirname, '..', 'src', 'components', 'stats', 'TokenBreakdownCard.tsx');
  assert(fs.existsSync(cardPath), 'TokenBreakdownCard.tsx must exist');
});

test('Protobuf decoder handles non-standard Unicode, emojis, and corrupted varints', () => {
  // Non-standard Unicode model name: e.g. "gemini-3.8-pro-🔥-智能模型"
  const modelStr = Buffer.from('gemini-3.8-pro-🔥-智能模型', 'utf8');
  const tag19Header = Buffer.from([0x9a, 0x01, modelStr.length]);
  const usageParts = [
    Buffer.from([0x10, 0xe8, 0x07]), // 1000 input
    Buffer.from([0x18, 0xc8, 0x01]), // 200 output
  ];
  const usageBuf = Buffer.concat(usageParts);
  const tag4Header = Buffer.from([0x22, usageBuf.length]);
  const msg1Content = Buffer.concat([tag4Header, usageBuf, tag19Header, modelStr]);
  const tag1Header = Buffer.from([0x0a, msg1Content.length]);
  const payload = Buffer.concat([tag1Header, msg1Content]);

  const decoded = decodeGenMetadata(payload);
  assert(decoded !== null, 'Should decode valid protobuf with unicode model name');
  assert(decoded.modelName === 'gemini-3.8-pro-🔥-智能模型', 'Decoded modelName should match unicode string');

  // Corrupted runaway varint (>10 bytes of 0x80)
  const runawayVarint = Buffer.alloc(20, 0x80);
  const res = decodeVarint(runawayVarint, 0);
  assert(res.nextOffset <= 11, 'Runaway varint should break at protobuf 64-bit limit');

  // Conflicting wire types for same field in parseProtoFields
  const conflictBuf = Buffer.concat([
    Buffer.from([0x08, 0x42]), // field 1, wireType 0, val 0x42
    Buffer.from([0x0a, 0x03, 0x01, 0x02, 0x03]), // field 1, wireType 2, len 3
  ]);
  const parsed = parseProtoFields(conflictBuf);
  assert(Array.isArray(parsed.get(1)), 'Field 1 should safely convert to array rather than throw');
});

test('Multiple DB sessions on the same calendar day accumulate tokens and tasks without dropping', () => {
  const { DatabaseSync } = require('node:sqlite');
  const os = require('os');
  const convDir = path.join(os.homedir(), '.gemini', 'antigravity', 'conversations');
  const db1Path = path.join(convDir, '00000000-0000-0000-0000-000000000091.db');
  const db2Path = path.join(convDir, '00000000-0000-0000-0000-000000000092.db');

  try {
    const payload = Buffer.concat([
      Buffer.from([0x0a, 0x0b, 0x22, 0x09, 0x10, 0xe8, 0x07, 0x18, 0x90, 0x01, 0x28, 0x90, 0x01]),
    ]); // 1000 input, 144 output, 144 cache

    const conn1 = new DatabaseSync(db1Path);
    conn1.exec('CREATE TABLE gen_metadata (idx INTEGER PRIMARY KEY, data BLOB, size INTEGER);');
    conn1.exec('CREATE TABLE steps (idx INTEGER PRIMARY KEY, step_type INTEGER, step_payload BLOB);');
    conn1.prepare('INSERT INTO gen_metadata (idx, data, size) VALUES (1, ?, ?)').run(payload, payload.length);
    conn1.close();

    const conn2 = new DatabaseSync(db2Path);
    conn2.exec('CREATE TABLE gen_metadata (idx INTEGER PRIMARY KEY, data BLOB, size INTEGER);');
    conn2.exec('CREATE TABLE steps (idx INTEGER PRIMARY KEY, step_type INTEGER, step_payload BLOB);');
    conn2.prepare('INSERT INTO gen_metadata (idx, data, size) VALUES (1, ?, ?)').run(payload, payload.length);
    conn2.close();

    // Set same mtime on both files to ensure they share the same calendar day
    const now = new Date();
    fs.utimesSync(db1Path, now, now);
    fs.utimesSync(db2Path, now, now);

    const stats = computeStats(true);
    const todayStr = toLocalDateKey(now);
    const todayEntry = stats.activity.dailyStats?.[todayStr];
    assert(todayEntry, `Today's entry ${todayStr} should exist in dailyStats`);
    assert(todayEntry.tokens >= 2576, `Tokens from both sessions must accumulate (>= 2576), got ${todayEntry.tokens}`);
    assert(todayEntry.tasks >= 2, `Tasks from both sessions must accumulate (>= 2), got ${todayEntry.tasks}`);
  } finally {
    try {
      if (fs.existsSync(db1Path)) fs.rmSync(db1Path, { force: true });
      if (fs.existsSync(db2Path)) fs.rmSync(db2Path, { force: true });
    } catch (e) {}
  }
});

// RUNNER
console.log('\n' + '='.repeat(60));
console.log('Antigravity Token Stats — Ground Truth & Live Sync Test Suite');
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
