/**
 * DeepSeek Harness Telemetry Metrics Test Suite (M1 Verification)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  readSingleSession,
  extractSessionPerformanceMetrics,
  buildDshTelemetry,
  computeStats,
} = require('./aggregate-stats.cjs');

console.log('=== DeepSeek Harness Telemetry Metrics Test Suite ===');

// Helper to construct synthetic protobuf timestamp: Tag num -> { 1: seconds, 2: nanos }
function makeTimestampBuf(tagNum, seconds, nanos = 0) {
  // inner: Tag 1 (varint seconds), Tag 2 (varint nanos)
  const innerParts = [];
  // Tag 1 (wireType 0, field 1 => 0x08)
  innerParts.push(Buffer.from([0x08]));
  let s = BigInt(seconds);
  const sBytes = [];
  while (s > 0x7fn) {
    sBytes.push(Number(s & 0x7fn) | 0x80);
    s >>= 7n;
  }
  sBytes.push(Number(s));
  innerParts.push(Buffer.from(sBytes));

  if (nanos > 0) {
    innerParts.push(Buffer.from([0x10]));
    let n = BigInt(nanos);
    const nBytes = [];
    while (n > 0x7fn) {
      nBytes.push(Number(n & 0x7fn) | 0x80);
      n >>= 7n;
    }
    nBytes.push(Number(n));
    innerParts.push(Buffer.from(nBytes));
  }
  const inner = Buffer.concat(innerParts);

  // Outer tag (wireType 2)
  const tagByte = (tagNum << 3) | 2;
  const header = [tagByte];
  let len = inner.length;
  while (len > 0x7f) {
    header.push((len & 0x7f) | 0x80);
    len >>= 7;
  }
  header.push(len);

  return Buffer.concat([Buffer.from(header), inner]);
}

// Helper to construct synthetic step row
function makeSyntheticStep(stepType, startSec, finishSec, firstTokenSec = null, outputTokens = 0, options = {}) {
  const parts = [];
  if (startSec !== null) parts.push(makeTimestampBuf(1, startSec, 100_000_000));
  if (finishSec !== null) parts.push(makeTimestampBuf(8, finishSec, 200_000_000));
  if (firstTokenSec !== null) parts.push(makeTimestampBuf(6, firstTokenSec, 150_000_000));

  if (outputTokens > 0) {
    // Tag 9 (usage) -> Tag 3 (outputTokens)
    let val = BigInt(outputTokens);
    const vBytes = [];
    while (val > 0x7fn) {
      vBytes.push(Number(val & 0x7fn) | 0x80);
      val >>= 7n;
    }
    vBytes.push(Number(val));
    const usageParts = [Buffer.from([0x18, ...vBytes])];
    for (const [tag, value] of [[9, options.thinkingTokens], [10, options.responseTokens]]) {
      if (value === undefined) continue;
      let n = BigInt(value);
      const bytes = [];
      while (n > 0x7fn) { bytes.push(Number(n & 0x7fn) | 0x80); n >>= 7n; }
      bytes.push(Number(n));
      usageParts.push(Buffer.from([tag << 3, ...bytes]));
    }
    const usageInner = Buffer.concat(usageParts);
    const tag9 = Buffer.concat([Buffer.from([0x4a, usageInner.length]), usageInner]);
    parts.push(tag9);
  }

  const plannerParts = options.noText ? [] : [Buffer.from([0x0a, 1, 0x78])];
  if (options.toolCall) plannerParts.push(Buffer.from([0x3a, 0]));
  if (options.thinkingDurationSec !== undefined) plannerParts.push(makeTimestampBuf(11, options.thinkingDurationSec, options.thinkingDurationNanos ?? 0));
  const planner = Buffer.concat(plannerParts);
  return {
    step_type: stepType,
    metadata: Buffer.concat(parts),
    step_payload: Buffer.concat([Buffer.from([0xa2, 0x01, planner.length]), planner]),
  };
}

// -------------------------------------------------------------
// Test 1: Protobuf timestamp extraction correctness on real DB
// -------------------------------------------------------------
console.log('\n--- Test 1: Real Session DB Performance Metrics ---');
const dir = path.join(os.homedir(), '.gemini', 'antigravity', 'conversations');
if (fs.existsSync(dir)) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.db'));
  if (files.length > 0) {
    const sId = files[0].replace('.db', '');
    const session = readSingleSession(sId);
    assert(session !== null, 'Session should read successfully');
    assert(typeof session.rounds === 'number' && session.rounds >= 1, `rounds should be >= 1, got ${session.rounds}`);
    assert(typeof session.steps === 'number' && session.steps >= 0, `steps should be >= 0, got ${session.steps}`);
    assert(typeof session.modelDurationSec === 'number' && session.modelDurationSec >= 0, `modelDurationSec should be >= 0, got ${session.modelDurationSec}`);
    assert(typeof session.toolDurationSec === 'number' && session.toolDurationSec >= 0, `toolDurationSec should be >= 0, got ${session.toolDurationSec}`);
    if (session.ttftSec !== null) {
      assert(typeof session.ttftSec === 'number' && session.ttftSec > 0 && session.ttftSec <= 300, `ttftSec should be between 0 and 300s, got ${session.ttftSec}`);
    }
    assert(session.dshTelemetry, 'dshTelemetry should be present');
    assert.strictEqual(session.dshTelemetry.sessionId, sId);
    assert.strictEqual(typeof session.dshTelemetry.session.rounds, 'number');
    assert.strictEqual(typeof session.dshTelemetry.token.totalTokens, 'number');
    assert.strictEqual(typeof session.dshTelemetry.context.usedTokens, 'number');
    console.log(`PASS: Real session metrics verified: { rounds: ${session.rounds}, steps: ${session.steps}, modelDuration: ${session.modelDurationSec.toFixed(2)}s, toolDuration: ${session.toolDurationSec.toFixed(2)}s, ttft: ${session.ttftSec ? session.ttftSec.toFixed(2) + 's' : 'null'}, tps: ${session.tps} }`);
  }
} else {
  console.log('SKIP: Local Antigravity data dir not present (CI environment)');
}

// -------------------------------------------------------------
// Test 2: TTFT boundary filtering and reasoning model support
// -------------------------------------------------------------
console.log('\n--- Test 2: TTFT Boundary & Reasoning Model Support ---');
{
  // Case A: normal TTFT (2.5s)
  const stepA = makeSyntheticStep(15, 1700000000, 1700000010, 1700000002, 100);
  const perfA = extractSessionPerformanceMetrics([stepA]);
  assert(perfA.ttftSec !== null && Math.abs(perfA.ttftSec - 2.05) < 0.1, `TTFT should be ~2.05s, got ${perfA.ttftSec}`);

  // Case B: Deep reasoning model long thinking (e.g. 180s TTFT < 300s threshold)
  const stepB = makeSyntheticStep(15, 1700000000, 1700000200, 1700000180, 500);
  const perfB = extractSessionPerformanceMetrics([stepB]);
  assert(perfB.ttftSec !== null && perfB.ttftSec >= 179 && perfB.ttftSec <= 181, `Deep reasoning TTFT should be included, got ${perfB.ttftSec}`);

  // Case C: Outlier TTFT (> 300s threshold, e.g. 400s) -> filtered out
  const stepC = makeSyntheticStep(15, 1700000000, 1700000500, 1700000400, 100);
  const perfC = extractSessionPerformanceMetrics([stepC]);
  assert.strictEqual(perfC.ttftSec, null, 'TTFT > 300s must be filtered out as anomaly');

  // Case D: Cancellation / no first token -> returns null, NOT 0.0s
  const stepD = makeSyntheticStep(15, 1700000000, 1700000005, null, 0);
  const perfD = extractSessionPerformanceMetrics([stepD]);
  assert.strictEqual(perfD.ttftSec, null, 'Unmeasured TTFT must return null');
  console.log('PASS: TTFT boundary filtering and reasoning model support verified');
}

// -------------------------------------------------------------
// Test 3: Performance benchmark (< 25ms average across 50 runs)
// -------------------------------------------------------------
console.log('\n--- Test 3: Performance Benchmark (< 25ms across 50 runs) ---');
if (fs.existsSync(dir)) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.db'));
  if (files.length > 0) {
    const sId = files[0].replace('.db', '');
    // Warm-up
    readSingleSession(sId);

    const RUNS = 50;
    const start = performance.now();
    for (let i = 0; i < RUNS; i++) {
      readSingleSession(sId);
    }
    const elapsed = performance.now() - start;
    const avgMs = elapsed / RUNS;
    console.log(`Benchmarked: ${RUNS} runs completed in ${elapsed.toFixed(1)}ms (avg: ${avgMs.toFixed(2)}ms per call)`);
    assert(avgMs < 25, `Average readSingleSession must be < 25ms, got ${avgMs.toFixed(2)}ms`);
    console.log(`PASS: readSingleSession fast-path performance meets < 25ms threshold (${avgMs.toFixed(2)}ms)`);
  }
}

// -------------------------------------------------------------
// Test 4: Tool duration 180s outlier cap & Text-only TPS
// -------------------------------------------------------------
console.log('\n--- Test 4: Tool Duration 180s Cap & Text-only TPS ---');
{
  // Case A: 600s background command execution capped at 180s
  const toolStep = makeSyntheticStep(132, 1700000000, 1700000600); // 600s duration
  const perfTool = extractSessionPerformanceMetrics([toolStep]);
  assert.strictEqual(perfTool.toolDurationSec, 180, `Tool duration should be capped at 180s, got ${perfTool.toolDurationSec}`);

  // Case B: Normal tool (1.5s)
  const toolNormal = makeSyntheticStep(132, 1700000000, 1700000001);
  const perfNormal = extractSessionPerformanceMetrics([toolNormal]);
  assert(perfNormal.toolDurationSec > 0.9 && perfNormal.toolDurationSec < 1.3, 'Tool normal duration should be ~1s');

  // Case C: Pure decode TPS (1000 tokens in 5s decode = 200 tok/s)
  // Total model time = 7s, TTFT = 2s, decode duration = 5s
  const stepModel = makeSyntheticStep(15, 1700000000, 1700000007, 1700000002, 1000);
  const perfTPS = extractSessionPerformanceMetrics([stepModel]);
  assert(perfTPS.tps !== null && Math.abs(perfTPS.tps - 200) < 5, `TPS should be ~200 tok/s, got ${perfTPS.tps}`);

  // Case D: Zero output tokens -> TPS must be null (not 0, not NaN)
  const stepZeroOutput = makeSyntheticStep(15, 1700000000, 1700000005, 1700000002, 0);
  const perfZero = extractSessionPerformanceMetrics([stepZeroOutput]);
  assert.strictEqual(perfZero.tps, null, 'Zero output tokens must yield null TPS');

  // Case E: A completed short response is valid; speed alone must not discard it.
  const stepShort = makeSyntheticStep(15, 1700000000, 1700000001, 1700000001, 100);
  assert.strictEqual(extractSessionPerformanceMetrics([stepShort]).tps, 2000);

  // Case F: Multi-step with one decode step and one cancelled/un-streamed step
  // Step 1: 5s decode duration (start 1700000000, finish 1700000007, first 1700000002) with 1000 tokens (TPS ~200)
  // Step 2: 10s duration without first token (e.g. timeout / error)
  const stepCancelNoToken = makeSyntheticStep(15, 1700000010, 1700000020, null, 0);
  const perfMulti = extractSessionPerformanceMetrics([stepModel, stepCancelNoToken]);
  assert(perfMulti.tps !== null && Math.abs(perfMulti.tps - 200) < 5, `TPS should remain ~200 tok/s despite second un-streamed step, got ${perfMulti.tps}`);
  assert.strictEqual(perfMulti.modelDurationSec, 17.2, 'Model duration should include both steps');
  assert.strictEqual(perfMulti.steps, 2, 'Steps should count both invocations');

  // Case G: Stream cancelled after first token (finishSec is null, but firstToken arrived)
  const stepCancelledMidStream = makeSyntheticStep(15, 1700000030, null, 1700000033, 50);
  const perfCancelled = extractSessionPerformanceMetrics([stepCancelledMidStream]);
  assert(perfCancelled.ttftSec !== null && Math.abs(perfCancelled.ttftSec - 3.05) < 0.1, `TTFT should be measured even if stream was cancelled before finish, got ${perfCancelled.ttftSec}`);

  assert.strictEqual(perfCancelled.tps, null, 'Incomplete response must not contribute TPS');

  const reasoning = makeSyntheticStep(15, 1700000000, 1700000042, 1700000008, 5281,
    { thinkingTokens: 4537, responseTokens: 744, thinkingDurationSec: 37, thinkingDurationNanos: 100_000_000 });
  assert.strictEqual(extractSessionPerformanceMetrics([reasoning]).tps, 149, '744 text tokens / 5s text phase, excluding wait and thought');
  const toolOnly = makeSyntheticStep(15, 1700000000, 1700000001, 1700000001, 518,
    { thinkingTokens: 493, responseTokens: 25, thinkingDurationSec: 1, toolCall: true, noText: true });
  const mixedTool = makeSyntheticStep(15, 1700000000, 1700000007, 1700000002, 1000, { toolCall: true });
  assert.strictEqual(extractSessionPerformanceMetrics([toolOnly, mixedTool]).tps, null, 'Tool payload tokens must not be counted as text');
  assert.strictEqual(extractSessionPerformanceMetrics([reasoning, toolOnly, mixedTool]).tps, 149);

  const missingThinkingTime = makeSyntheticStep(15, 1700000000, 1700000042, 1700000008, 5281, { thinkingTokens: 4537, responseTokens: 744 });
  const zeroText = makeSyntheticStep(15, 1700000000, 1700000007, 1700000002, 1000, { responseTokens: 0 });
  const invalidTime = makeSyntheticStep(15, 1700000000, 1700000001, 1700000002, 100);
  const overlongThinking = makeSyntheticStep(15, 1700000000, 1700000007, 1700000002, 1000, { thinkingDurationSec: 10 });
  const missingPayload = { ...stepModel, step_payload: null };
  assert.strictEqual(extractSessionPerformanceMetrics([missingThinkingTime, zeroText, invalidTime, overlongThinking, missingPayload, stepZeroOutput]).tps, null);
  assert.strictEqual(extractSessionPerformanceMetrics([stepModel, missingThinkingTime, zeroText, missingPayload]).tps, perfTPS.tps, 'Missing measurements must not mix unmatched tokens or time');

  const slow = makeSyntheticStep(15, 1700000000, 1700000007, 1700000002, 11);
  assert.strictEqual(extractSessionPerformanceMetrics([slow]).tps, 2.2, 'Low rates retain one decimal');
  const longWait = makeSyntheticStep(15, 1700000000, 1700000500, 1700000400, 1000);
  assert.strictEqual(extractSessionPerformanceMetrics([longWait]).tps, 10, 'TPS is independent of the TTFT anomaly filter');
  const weighted = extractSessionPerformanceMetrics([reasoning, stepModel]);
  assert.strictEqual(weighted.tps, Math.round((744 + 1000) / (5 + 5.05)), 'Weight by matched text duration, not mean step rates');
  console.log('PASS: Text-only TPS excludes thinking/tools and guards missing or invalid measurements');
}

// -------------------------------------------------------------
// Test 5: Context Breakdown & Telemetry Packaging (buildDshTelemetry)
// -------------------------------------------------------------
console.log('\n--- Test 5: Context Breakdown & Telemetry Packaging ---');
{
  const perf = { rounds: 2, steps: 78, tps: 190, modelDurationSec: 411, toolDurationSec: 71, ttftSec: 2.9 };

  // Case A: Large session (72.4K promptTokens >= 16.5K baseline)
  const tLarge = buildDshTelemetry({
    sessionId: 'session-large',
    isStreaming: false,
    perf,
    promptTokens: 72400,
    totalInput: 27687,
    totalCache: 3699456,
    totalOutput: 35547,
  });
  assert.strictEqual(tLarge.context.systemPromptTokens, 8200);
  assert.strictEqual(tLarge.context.toolDefinitionTokens, 8300);
  assert.strictEqual(tLarge.context.chatMessageTokens, 72400 - 16500);
  assert.strictEqual(tLarge.context.usedPct, 7); // 72400 / 1048576 = 6.9% -> 7%
  assert.strictEqual(tLarge.token.cacheHitRatePct, 99); // 3699456 / (27687 + 3699456) = 99.25% -> 99% (honest rule)

  // Case B: Small session (8250 promptTokens < 16.5K baseline)
  const tSmall = buildDshTelemetry({
    sessionId: 'session-small',
    isStreaming: true,
    perf,
    promptTokens: 8250,
    totalInput: 500,
    totalCache: 7750,
    totalOutput: 100,
  });
  assert(tSmall.context.systemPromptTokens > 0, 'Scaled system tokens should be > 0');
  assert(tSmall.context.toolDefinitionTokens > 0, 'Scaled tool tokens should be > 0');
  assert.strictEqual(tSmall.context.chatMessageTokens, 0, 'Chat messages should be 0 when below baseline');
  assert.strictEqual(tSmall.context.systemPromptTokens + tSmall.context.toolDefinitionTokens, 8250, 'Sum must equal promptTokens');

  // Case C: Empty session (0 prompt tokens)
  const tZero = buildDshTelemetry({
    sessionId: 'session-zero',
    isStreaming: false,
    perf,
    promptTokens: 0,
    totalInput: 0,
    totalCache: 0,
    totalOutput: 0,
  });
  assert.strictEqual(tZero.context.systemPromptTokens, 0);
  assert.strictEqual(tZero.context.toolDefinitionTokens, 0);
  assert.strictEqual(tZero.context.chatMessageTokens, 0);
  assert.strictEqual(tZero.context.usedPct, 0);
  assert.strictEqual(tZero.token.cacheHitRatePct, null);
  console.log('PASS: Context breakdown & telemetry packaging verified');
}

console.log('\n=============================================================');
console.log('✓ ALL DeepSeek Harness Telemetry Tests Passed Successfully!');
console.log('=============================================================');
