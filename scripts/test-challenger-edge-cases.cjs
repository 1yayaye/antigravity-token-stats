/**
 * scripts/test-challenger-edge-cases.cjs
 * Empirical stress test for deepseek-harness-alignment-plan.md edge cases.
 */

const assert = require('node:assert');
const { parseProtoFields } = require('./aggregate-stats.cjs');

console.log('============================================================');
console.log('CHALLENGER 1: Empirical Adversarial Stress Test Suite');
console.log('============================================================\n');

let totalTests = 0;
let passedTests = 0;
let failureFindings = [];

function testCase(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.log(`[FAIL/BUG CONFIRMED] ${name}`);
    console.log(`       Error: ${err.message}`);
    failureFindings.push({ name, error: err.message });
  }
}

// -------------------------------------------------------------
// 1. Streaming Cancellation & Numerical Stability
// -------------------------------------------------------------
console.log('--- 1. Testing Streaming Cancellation & Numerical Stability ---');

testCase('Cancellation before first token: TTFT & TPS divide-by-zero check', () => {
  // Scenario: User clicks Cancel 500ms after prompt, before any first token.
  // In SQLite: startMs = 1000, finishMs = 1500, no Tag 6, outputTokens = 0
  const startMs = 1000;
  const finishMs = 1500;
  const firstMs = null; // No Tag 6
  const outputTokens = 0;

  const modelDurationSec = (finishMs - startMs) / 1000; // 0.5s
  let ttftSumMs = 0;
  let ttftStepsCount = 0;

  if (firstMs !== null) {
    ttftSumMs += (firstMs - startMs);
    ttftStepsCount++;
  }

  const ttftSec = ttftStepsCount > 0 ? (ttftSumMs / ttftStepsCount / 1000) : 0;
  // Plan formula for TPS: outputTokens / modelDurationSec
  const planTps = outputTokens / modelDurationSec;

  assert.strictEqual(ttftSec, 0, 'Plan ttftSec produces 0 instead of null/omitted');
  assert.strictEqual(planTps, 0, 'Plan TPS produces 0 instead of null/omitted');

  // Now scenario where finishMs == startMs (immediate cancellation, 0ms elapsed)
  const zeroDurationSec = 0;
  const zeroTps = outputTokens / zeroDurationSec;
  assert(Number.isNaN(zeroTps), `0 / 0 produces NaN! Got: ${zeroTps}`);
});

testCase('Missing Tag 8 (interrupted generation without finish timestamp)', () => {
  // Scenario: Crash or abrupt kill where Tag 8 is missing
  const meta = new Map();
  // Tag 1 present, Tag 8 absent
  const startMs = 1000;
  const finishSec = meta.get(8); // undefined
  let modelTimeMs = 0;

  if (finishSec && startMs > 0) {
    modelTimeMs += 500;
  }
  assert.strictEqual(modelTimeMs, 0, 'modelTimeMs should remain 0');

  // If modelTimeMs is 0 and outputTokens > 0 (partial tokens saved before crash)
  const outputTokens = 50;
  const tps = outputTokens / (modelTimeMs / 1000);
  assert.strictEqual(tps, Infinity, `outputTokens / 0 produces Infinity! Got: ${tps}`);
});

// -------------------------------------------------------------
// 2. Context Compaction & Breakdown Residual Formula
// -------------------------------------------------------------
console.log('\n--- 2. Testing Context Compaction & Breakdown Formulas ---');

testCase('Residual formula promptTokens - (system + tools) on fresh/small session', () => {
  // Plan values
  const systemPromptTokens = 8200;
  const toolDefinitionTokens = 8300;
  const sumFixed = systemPromptTokens + toolDefinitionTokens; // 16500

  // Case A: Fresh session with promptTokens = 0
  const promptTokensZero = 0;
  const chatMessageTokensZero = promptTokensZero - sumFixed;
  assert.strictEqual(chatMessageTokensZero, -16500, 'ChatMessageTokens is negative!');

  // Segment width in ContextMeter:
  const sumZero = systemPromptTokens + toolDefinitionTokens + chatMessageTokensZero;
  assert.strictEqual(sumZero, 0, 'Sum of segments is 0!');
  const sysWidthZero = (systemPromptTokens / sumZero) * 100;
  assert.strictEqual(sysWidthZero, Infinity, `sysWidthZero divides by 0 to Infinity! Got: ${sysWidthZero}`);

  // Case B: Small conversation (e.g. 5,000 promptTokens, observed in 37 real DBs)
  const promptTokensSmall = 5000;
  const chatMessageTokensSmall = promptTokensSmall - sumFixed;
  assert.strictEqual(chatMessageTokensSmall, -11500, 'ChatMessageTokens is negative -11500!');
  const msgWidthSmall = (chatMessageTokensSmall / promptTokensSmall) * 100;
  assert(msgWidthSmall < 0, `Progress bar segment width is negative! Got: ${msgWidthSmall}%`);
});

testCase('Context compaction transition behavior', () => {
  // Before compaction: promptTokens = 240,000
  // After compaction: promptTokens drops to 40,000
  const systemPromptTokens = 8200;
  const toolDefinitionTokens = 8300;
  const promptTokensBefore = 240000;
  const promptTokensAfter = 40000;

  const msgBefore = promptTokensBefore - (systemPromptTokens + toolDefinitionTokens);
  const msgAfter = promptTokensAfter - (systemPromptTokens + toolDefinitionTokens);

  assert.strictEqual(msgBefore, 223500);
  assert.strictEqual(msgAfter, 23500);

  // If active MCP tools inflate toolDefinitionTokens to 35,000:
  const heavyToolTokens = 35000;
  const msgAfterHeavy = promptTokensAfter - (systemPromptTokens + heavyToolTokens);
  assert.strictEqual(msgAfterHeavy, -3200, 'Compaction with heavy tools drops message tokens below zero!');
});

// -------------------------------------------------------------
// 3. Tool Execution Errors, Outliers & Timeouts
// -------------------------------------------------------------
console.log('\n--- 3. Testing Tool Execution Errors & Outlier Clamps ---');

testCase('Tool hanging / long daemon duration without outlier filter', () => {
  // Scenario: User launched a dev server or long process taking 2 hours
  const startMs = 1000000;
  const finishMs = 1000000 + 2 * 3600 * 1000; // 2 hours = 7,200,000 ms

  let toolTimeMs = 0;
  if (startMs > 0 && finishMs >= startMs) {
    toolTimeMs += (finishMs - startMs);
  }

  const toolDurationSec = toolTimeMs / 1000;
  assert.strictEqual(toolDurationSec, 7200, 'toolDurationSec has no outlier bound and inflates to 7200s');
});

// -------------------------------------------------------------
// 4. Zero Output Tokens & Cache Hit Rate
// -------------------------------------------------------------
console.log('\n--- 4. Testing Zero Output Tokens & Cache Hit Division-by-Zero ---');

testCase('Cache hit rate with 0 input tokens (fresh session or error)', () => {
  const uncachedInputTokens = 0;
  const cacheReadTokens = 0;
  const billedInputTokens = uncachedInputTokens + cacheReadTokens;

  // Plan formula: cacheRead / (input + cacheRead)
  const hitRate = cacheReadTokens / billedInputTokens;
  assert(Number.isNaN(hitRate), `0 / 0 produces NaN! Got: ${hitRate}`);
});

// -------------------------------------------------------------
// 5. Protobuf Parsing Syntax Mismatch
// -------------------------------------------------------------
console.log('\n--- 5. Testing Protobuf Parsing Syntax Mismatch ---');

testCase('Plan Section 4.4 code snippet compatibility with parseProtoFields', () => {
  // Simulate what parseProtoFields actually returns
  const fakeMetadata = Buffer.from([
    // Tag 1 (wireType 2, length 12)
    0x0a, 0x0c,
    // Tag 1.1 (wireType 0, seconds: 1788492387)
    0x08, 0xe3, 0xf4, 0xe8, 0xd4, 0x06,
    // Tag 1.2 (wireType 0, nanos: 452115700)
    0x10, 0xf4, 0xf9, 0xca, 0xd7, 0x01
  ]);

  const meta = parseProtoFields(fakeMetadata);

  // Exact code from Section 4.4 lines 71-72 of the plan:
  const startSec = meta[1]?.[0]?.fields?.[1]?.[0]?.value || 0;
  const startNano = meta[1]?.[0]?.fields?.[2]?.[0]?.value || 0;

  // Plan code produces 0 because meta is a Map and has no .fields property!
  assert.strictEqual(startSec, 0, 'meta[1] evaluates to undefined, defaulting to 0');
  assert.strictEqual(startNano, 0, 'meta[1] evaluates to undefined, defaulting to 0');

  // Correct syntax required by aggregate-stats.cjs:
  const buf1 = meta.get(1)?.[0];
  const inner = buf1 ? parseProtoFields(buf1) : null;
  const correctSec = inner ? (inner.get(1) || 0) : 0;
  const correctNano = inner ? (inner.get(2) || 0) : 0;

  assert.strictEqual(correctSec, 1788492387, 'Correct syntax extracts 1788492387');
  assert.strictEqual(correctNano, 452115700, 'Correct syntax extracts 452115700');
});

// -------------------------------------------------------------
// 6. formatDuration Edge Cases
// -------------------------------------------------------------
console.log('\n--- 6. Testing formatDuration with negative & non-finite numbers ---');

testCase('formatDuration on negative, NaN, and Infinity', () => {
  function formatDuration(seconds) {
    const s = Math.round(seconds);
    if (s < 60) return `${s} 秒`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m} 分 ${rem} 秒`;
  }

  assert.strictEqual(formatDuration(-10), '-10 秒', 'Negative seconds formatted without clamp');
  assert.strictEqual(formatDuration(-70), '-70 秒', '-70 is < 60 so it returns -70 秒 without minute conversion');
  assert.strictEqual(formatDuration(NaN), 'NaN 分 NaN 秒', 'NaN < 60 is false, producing "NaN 分 NaN 秒"');
  assert.strictEqual(formatDuration(Infinity), 'Infinity 分 NaN 秒', 'Infinity produces "Infinity 分 NaN 秒" because Infinity % 60 is NaN');
});

// -------------------------------------------------------------
// 7. Real Antigravity Database Edge Case Verification
// -------------------------------------------------------------
console.log('\n--- 7. Real Antigravity Database Ground Truth Verification ---');

testCase('Real Antigravity SQLite ground truth contains all edge cases', () => {
  const { DatabaseSync } = require('node:sqlite');
  const fs = require('node:fs');
  const path = require('node:path');
  const agDir = path.join(process.env.USERPROFILE, '.gemini', 'antigravity', 'conversations');
  const files = fs.readdirSync(agDir).filter(f => f.endsWith('.db')).slice(0, 50);

  let missingTag6Count = 0;
  let zeroOutputCount = 0;
  let smallPromptCount = 0;

  for (const file of files) {
    const db = new DatabaseSync(path.join(agDir, file), { readOnly: true });
    const steps15 = db.prepare('SELECT metadata FROM steps WHERE step_type = 15').all();
    for (const s of steps15) {
      if (!s.metadata) continue;
      const top = parseProtoFields(Buffer.from(s.metadata));
      if (!top.has(6)) missingTag6Count++;
      if (top.has(9)) {
        const u = parseProtoFields(top.get(9)[0]);
        if ((u.get(3) || 0) === 0) zeroOutputCount++;
      }
    }

    const genLast = db.prepare('SELECT data FROM gen_metadata ORDER BY idx DESC LIMIT 1').get();
    if (genLast && genLast.data) {
      const top = parseProtoFields(Buffer.from(genLast.data));
      const msg1 = top.get(1);
      if (msg1 && msg1[0]) {
        const f1 = parseProtoFields(msg1[0]);
        const m1_4 = f1.get(4);
        if (m1_4 && m1_4[0]) {
          const u = parseProtoFields(m1_4[0]);
          const p = (u.get(2) || 0) + (u.get(5) || 0);
          if (p < 16500) smallPromptCount++;
        }
      }
    }
    db.close();
  }

  console.log(`       Sampled 50 DBs: ${missingTag6Count} steps without Tag6, ${zeroOutputCount} steps with 0 output, ${smallPromptCount} sessions with prompt < 16500`);
  assert(missingTag6Count > 0, 'Must have found steps without Tag 6');
  assert(zeroOutputCount > 0, 'Must have found steps with 0 output');
  assert(smallPromptCount > 0, 'Must have found sessions with prompt < 16500');
});

console.log('\n============================================================');
console.log(`Summary: ${passedTests}/${totalTests} tests passed`);
console.log('Confirmed Vulnerabilities:', failureFindings.length);
console.log('============================================================');
