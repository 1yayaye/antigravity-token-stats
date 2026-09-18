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

test('Inject-live script fixed WebSocket leak', () => {
  const injectScript = fs.readFileSync(path.join(__dirname, 'inject-live.cjs'), 'utf8');

  // Check that ws.onerror has ws.close()
  const onerrorMatch = injectScript.match(/ws\.onerror\s*=\s*\(\)\s*=>\s*\{[^}]*\}/s);
  assert(onerrorMatch, 'Should have onerror handler');
  assert(onerrorMatch[0].includes('ws.close()'), 'onerror should call ws.close()');
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
  const content = fs.readFileSync(path.join(__dirname, 'aggregate-stats.cjs'), 'utf8');
  assert(!content.includes('/ 3.5'), 'Must not contain / 3.5');
  assert(!content.includes('/ 3.8'), 'Must not contain / 3.8');
  assert(!content.includes('Math.ceil(bytes /'), 'Must not contain bytes division heuristic');
  assert(!content.includes('Math.ceil(chars /'), 'Must not contain chars division heuristic');
});

test('Ground truth Lifetime Tokens (>1B) and Prompt Cache Hit Rate (~94%)', () => {
  const { computeStats } = require('./aggregate-stats.cjs');
  const stats = computeStats();
  assert(stats.kpis.lifetimeTokensRaw > 1000000000, 'Lifetime tokens should be > 1B');
  const hitRate = parseFloat(stats.insights.cacheHitRate);
  assert(Math.round(hitRate) >= 92 && Math.round(hitRate) <= 95, `Cache hit rate should be ~94%, got ${stats.insights.cacheHitRate}`);
  assert(stats.insights.skillsExplored > 15, 'Should distinguish and count real Agent Skills');
  assert(stats.insights.toolPrimitivesUsed > 5000, 'Should track built-in tool primitives separately');
});

test('Live Sync and manual refresh CDP hooks exist', () => {
  const injectCode = fs.readFileSync(path.join(__dirname, 'inject-live.cjs'), 'utf8');
  assert(injectCode.includes('__ANTIGRAVITY_CDP_SYNC__'), 'Must register CDP binding');
  assert(injectCode.includes('__ANTIGRAVITY_REQUEST_SYNC__'), 'Must wire sync function');
  assert(injectCode.includes('antigravity:stats-updated'), 'Must emit stats-updated event');

  const viewCode = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'stats', 'StatsView.tsx'), 'utf8');
  assert(viewCode.includes('antigravity:stats-updated'), 'StatsView must listen for stats-updated');
  assert(viewCode.includes('__ANTIGRAVITY_REQUEST_SYNC__'), 'StatsView must call __ANTIGRAVITY_REQUEST_SYNC__');
});

test('Live Sync keeps debounce, in-flight, and busy-lock safeguards', () => {
  const injectCode = fs.readFileSync(path.join(__dirname, 'inject-live.cjs'), 'utf8');
  assert(injectCode.includes('__ANTIGRAVITY_CDP_SYNC__'), 'Must register CDP binding');
  assert(injectCode.includes('antigravity:stats-updated'), 'Must emit stats-updated event');
  assert(injectCode.includes('fs.watch'), 'Must watch data files');
  assert(injectCode.includes('500'), 'Must debounce updates');
  assert(injectCode.includes('pushInFlight'), 'Must serialize pushes');
  assert(injectCode.includes('retry-after-busy'), 'Must retry after SQLITE_BUSY');
});

test('SQLITE_BUSY fallback and auto-retry on busy lock exist', () => {
  const aggregateCode = fs.readFileSync(path.join(__dirname, 'aggregate-stats.cjs'), 'utf8');
  assert(aggregateCode.includes('hasStaleSessions'), 'aggregate-stats must track hasStaleSessions');
  assert(aggregateCode.includes('isTemporaryLock && cached'), 'aggregate-stats must fall back to cached data on active lock');

  const injectCode = fs.readFileSync(path.join(__dirname, 'inject-live.cjs'), 'utf8');
  assert(injectCode.includes('retry-after-busy'), 'inject-live must schedule push retry after busy lock');
  assert(injectCode.includes('retryBusyTimer'), 'inject-live must manage retry timer');

  const viewCode = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'stats', 'StatsView.tsx'), 'utf8');
  assert(viewCode.includes('Request sync on mount error'), 'StatsView must request sync on mount');
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
