/**
 * scripts/test-challenger-reverification.cjs
 * Empirical Adversarial Re-verification of Remediated DeepSeek Harness Alignment Plan
 * Executed by Challenger 3.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');
const { parseProtoFields } = require('./aggregate-stats.cjs');

console.log('============================================================');
console.log('CHALLENGER 3: Empirical Adversarial Re-verification Suite');
console.log('============================================================\n');

let totalTests = 0;
let passedTests = 0;
const failureFindings = [];

function testCase(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.log(`[FAIL] ${name}`);
    console.log(`       Error: ${err.message}`);
    failureFindings.push({ name, error: err.message });
  }
}

// -------------------------------------------------------------------
// 1. EMPIRICAL FORMULAS: formatCompactTokens & formatDuration
// -------------------------------------------------------------------
console.log('--- 1. Testing formatCompactTokens & formatDuration Implementations ---');

// Exact code from plan Section 4.3 F lines 731-751
function planFormatDuration(seconds) {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return '0秒';
  if (seconds < 60) {
    const s = Math.round(seconds * 10) / 10;
    return `${s}秒`;
  }
  const whole = Math.round(seconds);
  const m = Math.floor(whole / 60);
  const rem = whole % 60;
  return `${m}分${rem}秒`;
}

function planFormatCompactTokens(tokens) {
  if (tokens == null || !Number.isFinite(tokens) || tokens <= 0) return '0';
  const scaled = (candidate) =>
    candidate >= 100 ? String(Math.round(candidate)) : String(Math.round(candidate * 10) / 10);
  if (tokens < 1_000) return String(tokens);
  if (tokens < 1_000_000) return `${scaled(tokens / 1_000)}K`;
  return `${scaled(tokens / 1_000_000)}M`;
}

testCase('formatCompactTokens candidate >= 100 threshold', () => {
  // Screenshot 2 targets: ~72.4K and ~29.4K
  assert.strictEqual(planFormatCompactTokens(72400), '72.4K', '72,400 must format as 72.4K');
  assert.strictEqual(planFormatCompactTokens(29400), '29.4K', '29,400 must format as 29.4K');
  assert.strictEqual(planFormatCompactTokens(8200), '8.2K', '8,200 must format as 8.2K');
  assert.strictEqual(planFormatCompactTokens(8300), '8.3K', '8,300 must format as 8.3K');

  // Below 100K preserving 1 decimal
  assert.strictEqual(planFormatCompactTokens(99949), '99.9K', '99,949 must format as 99.9K');
  assert.strictEqual(planFormatCompactTokens(12345), '12.3K', '12,345 must format as 12.3K');

  // At or above 100K rounding to integer K
  assert.strictEqual(planFormatCompactTokens(100000), '100K', '100,000 must format as 100K');
  assert.strictEqual(planFormatCompactTokens(150400), '150K', '150,400 must format as 150K');
  assert.strictEqual(planFormatCompactTokens(256000), '256K', '256,000 must format as 256K');

  // M range
  assert.strictEqual(planFormatCompactTokens(1000000), '1M', '1,000,000 must format as 1M');
  assert.strictEqual(planFormatCompactTokens(3762690), '3.8M', '3,762,690 must format as 3.8M');
  assert.strictEqual(planFormatCompactTokens(105000000), '105M', '105,000,000 must format as 105M');

  // Small values < 1000
  assert.strictEqual(planFormatCompactTokens(0), '0', '0 must format as 0');
  assert.strictEqual(planFormatCompactTokens(42), '42', '42 must format as 42');
  assert.strictEqual(planFormatCompactTokens(999), '999', '999 must format as 999');

  // Falsy & Non-finite guards
  assert.strictEqual(planFormatCompactTokens(null), '0', 'null must format as 0');
  assert.strictEqual(planFormatCompactTokens(undefined), '0', 'undefined must format as 0');
  assert.strictEqual(planFormatCompactTokens(-500), '0', 'negative numbers must format as 0');
  assert.strictEqual(planFormatCompactTokens(NaN), '0', 'NaN must format as 0');
  assert.strictEqual(planFormatCompactTokens(Infinity), '0', 'Infinity must format as 0');
});

testCase('formatDuration edge cases, sub-minute decimals, and unspaced format', () => {
  // Screenshot 4 targets: 6分51秒, 1分11秒, 2.9秒
  assert.strictEqual(planFormatDuration(411), '6分51秒', '411s must format as 6分51秒');
  assert.strictEqual(planFormatDuration(71), '1分11秒', '71s must format as 1分11秒');
  assert.strictEqual(planFormatDuration(2.9), '2.9秒', '2.9s must format as 2.9秒');

  // Sub-minute precision
  assert.strictEqual(planFormatDuration(0.54), '0.5秒', '0.54s must format as 0.5秒');
  assert.strictEqual(planFormatDuration(15.0), '15秒', '15.0s must format as 15秒');
  assert.strictEqual(planFormatDuration(59.94), '59.9秒', '59.94s must format as 59.9秒');

  // Exact minute boundary
  assert.strictEqual(planFormatDuration(60), '1分0秒', '60s must format as 1分0秒');
  assert.strictEqual(planFormatDuration(120), '2分0秒', '120s must format as 2分0秒');
  assert.strictEqual(planFormatDuration(3665), '61分5秒', '3665s must format as 61分5秒');

  // Falsy & Non-finite guards
  assert.strictEqual(planFormatDuration(null), '0秒', 'null must format as 0秒');
  assert.strictEqual(planFormatDuration(undefined), '0秒', 'undefined must format as 0秒');
  assert.strictEqual(planFormatDuration(0), '0秒', '0 must format as 0秒');
  assert.strictEqual(planFormatDuration(-10), '0秒', 'negative numbers must format as 0秒');
  assert.strictEqual(planFormatDuration(NaN), '0秒', 'NaN must format as 0秒');
  assert.strictEqual(planFormatDuration(Infinity), '0秒', 'Infinity must format as 0秒');
});

// -------------------------------------------------------------------
// 2. CONTEXT BREAKDOWN & PROPORTIONAL COMPRESSION
// -------------------------------------------------------------------
console.log('\n--- 2. Testing Context Breakdown Dynamic Scaling ---');

function calculateContextBreakdown(promptTokens) {
  const SYSTEM_BASELINE = 8200;
  const TOOLS_BASELINE = 8300;
  const BASELINE_SUM = SYSTEM_BASELINE + TOOLS_BASELINE; // 16500

  let systemPromptTokens = 0;
  let toolDefinitionTokens = 0;
  let chatMessageTokens = 0;

  if (promptTokens <= 0) {
    systemPromptTokens = 0;
    toolDefinitionTokens = 0;
    chatMessageTokens = 0;
  } else if (promptTokens < BASELINE_SUM) {
    const scale = promptTokens / BASELINE_SUM;
    systemPromptTokens = Math.round(SYSTEM_BASELINE * scale);
    toolDefinitionTokens = Math.max(0, promptTokens - systemPromptTokens);
    chatMessageTokens = 0;
  } else {
    systemPromptTokens = SYSTEM_BASELINE;
    toolDefinitionTokens = TOOLS_BASELINE;
    chatMessageTokens = Math.max(0, promptTokens - BASELINE_SUM);
  }

  const sum = systemPromptTokens + toolDefinitionTokens + chatMessageTokens;
  return { systemPromptTokens, toolDefinitionTokens, chatMessageTokens, sum };
}

testCase('Context breakdown conservation & non-negative invariant across ranges', () => {
  // Test fresh session (prompt = 0)
  const zero = calculateContextBreakdown(0);
  assert.strictEqual(zero.systemPromptTokens, 0);
  assert.strictEqual(zero.toolDefinitionTokens, 0);
  assert.strictEqual(zero.chatMessageTokens, 0);
  assert.strictEqual(zero.sum, 0);

  // Test small sessions (< 16,500)
  for (const p of [1, 10, 500, 1000, 5000, 10000, 16499]) {
    const res = calculateContextBreakdown(p);
    assert.ok(res.systemPromptTokens >= 0, `System prompt tokens must be non-negative for prompt=${p}`);
    assert.ok(res.toolDefinitionTokens >= 0, `Tool definition tokens must be non-negative for prompt=${p}`);
    assert.strictEqual(res.chatMessageTokens, 0, `Chat message tokens must be 0 when prompt < 16500`);
    assert.strictEqual(res.sum, p, `Sum of components must exactly conserve promptTokens=${p}`);
  }

  // Test exact boundary (16,500)
  const boundary = calculateContextBreakdown(16500);
  assert.strictEqual(boundary.systemPromptTokens, 8200);
  assert.strictEqual(boundary.toolDefinitionTokens, 8300);
  assert.strictEqual(boundary.chatMessageTokens, 0);
  assert.strictEqual(boundary.sum, 16500);

  // Test large sessions (Screenshot 2: 72,400)
  const large = calculateContextBreakdown(72400);
  assert.strictEqual(large.systemPromptTokens, 8200);
  assert.strictEqual(large.toolDefinitionTokens, 8300);
  assert.strictEqual(large.chatMessageTokens, 55900);
  assert.strictEqual(large.sum, 72400);
});

testCase('256K compaction threshold mark calculation', () => {
  const compactionLimit = 256000;
  const contextWindow1M = 1048576;
  const markPct = (compactionLimit / contextWindow1M) * 100;
  assert.strictEqual(markPct.toFixed(1), '24.4', 'Compaction threshold mark must be 24.4%');
});

// -------------------------------------------------------------------
// 3. PROTOBUF MAP PARSING AGAINST LIVE ANTIGRAVITY DATABASE
// -------------------------------------------------------------------
console.log('\n--- 3. Testing Protobuf Parsing & Metric Extraction on Live SQLite ---');

// The exact extractSessionPerformanceMetrics implementation proposed in Section 4.4 A
function extractSessionPerformanceMetricsFromPlan(db, totalOutputTokens = 0) {
  let modelTimeMs = 0;
  let toolTimeMs = 0;
  let ttftSumMs = 0;
  let ttftStepsCount = 0;
  let roundsCount = 0;
  let stepsCount = 0;
  let extractedOutputTokens = 0;

  const rows = db.prepare('SELECT step_type, metadata FROM steps ORDER BY idx ASC').all();

  for (const row of rows) {
    const stepType = row.step_type;
    if (stepType === 14) {
      roundsCount++;
      continue;
    }

    if (stepType === 15) {
      stepsCount++;
      if (!row.metadata) continue;
      const top = parseProtoFields(Buffer.from(row.metadata));

      const sTs = top.get(1)?.[0] ? parseProtoFields(top.get(1)[0]) : null;
      const fTs = top.get(8)?.[0] ? parseProtoFields(top.get(8)[0]) : (top.get(7)?.[0] ? parseProtoFields(top.get(7)[0]) : null);
      const firstTs = top.get(6)?.[0] ? parseProtoFields(top.get(6)[0]) : null;

      if (top.has(9) && top.get(9)[0]) {
        const usage = parseProtoFields(top.get(9)[0]);
        extractedOutputTokens += (Number(usage.get(3)) || 0);
      }

      if (sTs && fTs) {
        const startMs = (Number(sTs.get(1)) || 0) * 1000 + (Number(sTs.get(2)) || 0) / 1e6;
        const finishMs = (Number(fTs.get(1)) || 0) * 1000 + (Number(fTs.get(2)) || 0) / 1e6;
        if (startMs > 0 && finishMs >= startMs) {
          modelTimeMs += (finishMs - startMs);
        }

        if (firstTs && startMs > 0) {
          const firstMs = (Number(firstTs.get(1)) || 0) * 1000 + (Number(firstTs.get(2)) || 0) / 1e6;
          const ttft = Math.max(0, firstMs - startMs);
          if (ttft > 0 && ttft < 300_000) {
            ttftSumMs += ttft;
            ttftStepsCount++;
          }
        }
      }
      continue;
    }

    if (stepType === 132) {
      stepsCount++;
      if (!row.metadata) continue;
      const top = parseProtoFields(Buffer.from(row.metadata));
      const sTs = top.get(1)?.[0] ? parseProtoFields(top.get(1)[0]) : null;
      const fTs = top.get(8)?.[0] ? parseProtoFields(top.get(8)[0]) : null;

      if (sTs && fTs) {
        const startMs = (Number(sTs.get(1)) || 0) * 1000 + (Number(sTs.get(2)) || 0) / 1e6;
        const finishMs = (Number(fTs.get(1)) || 0) * 1000 + (Number(fTs.get(2)) || 0) / 1e6;
        if (startMs > 0 && finishMs >= startMs) {
          const rawDuration = finishMs - startMs;
          toolTimeMs += Math.min(180_000, rawDuration);
        }
      }
    }
  }

  const finalOutputTokens = totalOutputTokens > 0 ? totalOutputTokens : extractedOutputTokens;
  const decodeDurationSec = Math.max(0, (modelTimeMs - ttftSumMs) / 1000);

  const tps = (decodeDurationSec > 0.05 && finalOutputTokens > 0)
    ? Math.round(finalOutputTokens / decodeDurationSec)
    : null;

  return {
    rounds: Math.max(1, roundsCount),
    steps: stepsCount,
    tps,
    modelDurationSec: modelTimeMs / 1000,
    toolDurationSec: toolTimeMs / 1000,
    ttftSec: ttftStepsCount > 0 ? (ttftSumMs / ttftStepsCount / 1000) : null,
  };
}

testCase('Plan Protobuf Map extraction executes reliably across live SQLite DBs', () => {
  const agDir = path.join(process.env.USERPROFILE, '.gemini', 'antigravity', 'conversations');
  const files = fs.readdirSync(agDir).filter(f => f.endsWith('.db')).slice(0, 20);
  assert.ok(files.length > 0, 'Must have at least 1 Antigravity conversation DB');

  let totalExecutionTimeMs = 0;
  let testedSessions = 0;

  for (const file of files) {
    const dbPath = path.join(agDir, file);
    const db = new DatabaseSync(dbPath, { readOnly: true });

    const tStart = performance.now();
    const metrics = extractSessionPerformanceMetricsFromPlan(db);
    const elapsed = performance.now() - tStart;
    totalExecutionTimeMs += elapsed;
    testedSessions++;

    db.close();

    // Verify TypeScript interface constraints
    assert.ok(metrics.rounds >= 1, `rounds must be >= 1, got ${metrics.rounds}`);
    assert.ok(metrics.steps >= 0, `steps must be >= 0, got ${metrics.steps}`);
    assert.ok(metrics.modelDurationSec >= 0, `modelDurationSec must be >= 0, got ${metrics.modelDurationSec}`);
    assert.ok(metrics.toolDurationSec >= 0, `toolDurationSec must be >= 0, got ${metrics.toolDurationSec}`);

    if (metrics.ttftSec !== null) {
      assert.ok(metrics.ttftSec > 0 && metrics.ttftSec < 300, `ttftSec within bounds, got ${metrics.ttftSec}`);
    }
    if (metrics.tps !== null) {
      assert.ok(metrics.tps > 0, `tps must be > 0 if not null, got ${metrics.tps}`);
    }
  }

  const avgElapsed = totalExecutionTimeMs / testedSessions;
  console.log(`       Verified across ${testedSessions} live DBs: average extraction time = ${avgElapsed.toFixed(2)}ms (target < 30ms)`);
  assert.ok(avgElapsed < 30, `Average extraction time must be < 30ms, got ${avgElapsed}`);
});

testCase('Tool duration 180s clamp prevents hanging tool daemon skew', () => {
  // Synthesize steps row with 2-hour tool execution (e.g. background server)
  const rawDuration = 2 * 3600 * 1000; // 7,200,000 ms
  const clamped = Math.min(180_000, rawDuration);
  assert.strictEqual(clamped, 180000, 'Tool duration must be clamped to 180,000ms (3 minutes)');
});

// -------------------------------------------------------------------
// 4. LIVE STREAM TICKER CJK DYNAMIC WEIGHTING
// -------------------------------------------------------------------
console.log('\n--- 4. Testing Live Stream Ticker CJK Weighting ---');

testCase('CJK dynamic weighting matches language characteristics without banned heuristic', () => {
  function estimateStreamTokens(textDelta) {
    const cjkCount = (textDelta.match(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
    const asciiCount = Math.max(0, textDelta.length - cjkCount);
    return cjkCount * 1.35 + asciiCount * 0.25;
  }

  // Pure English text: 100 chars -> 25 tokens (~4 chars/token)
  const englishText = 'a'.repeat(100);
  const engTokens = estimateStreamTokens(englishText);
  assert.strictEqual(engTokens, 25, '100 ASCII chars should produce 25 tokens');

  // Pure Chinese text: 100 chars -> 135 tokens (~1.35 tokens/char)
  const chineseText = '这是一个用于测试中文字符动态加权分词估算的测试文本缓冲区内容确保速度准确无误没有严重低估'.slice(0, 40);
  const zhTokens = estimateStreamTokens(chineseText);
  assert.strictEqual(zhTokens, 40 * 1.35, '40 CJK chars should produce 54 tokens');

  // Mixed text: 20 Chinese chars + 40 English chars -> 27 + 10 = 37 tokens
  const mixedText = '深度思考模型生成: DeepSeek-R1 performance test';
  const mixedTokens = estimateStreamTokens(mixedText);
  // cjkCount: '深度思考模型生成' = 8 chars -> 8 * 1.35 = 10.8
  // ascii: 38 - 8 = 30 chars -> 30 * 0.25 = 7.5
  // total = 18.3
  assert.strictEqual(mixedTokens, 8 * 1.35 + 30 * 0.25);
});

// -------------------------------------------------------------------
// 5. STATIC AUDIT OF PLAN DOCUMENT
// -------------------------------------------------------------------
console.log('\n--- 5. Static Inspection of docs/deepseek-harness-alignment-plan.md ---');

testCase('Plan document contains all critical remediation keys', () => {
  const planPath = path.join(__dirname, '..', 'docs', 'deepseek-harness-alignment-plan.md');
  const planContent = fs.readFileSync(planPath, 'utf8');

  // Must have window.__ANTIGRAVITY_STATUSBAR_ROOT__
  assert.ok(planContent.includes('window.__ANTIGRAVITY_STATUSBAR_ROOT__'), 'Must isolate status bar root');

  // Must have candidate >= 100 in formatCompactTokens
  assert.ok(planContent.includes('candidate >= 100'), 'Must use candidate >= 100 for token formatting');

  // Must have decodeDurationSec
  assert.ok(planContent.includes('decodeDurationSec'), 'Must calculate pure decode TPS');

  // Must have CJK dynamic weighting without banned literal '/ 3.8' in code
  assert.ok(planContent.includes('cjkCount * 1.35'), 'Must use CJK dynamic weighting');
  assert.ok(!planContent.includes('ΔChars / 3.8'), 'Must NOT contain banned ΔChars / 3.8 formula');

  // Must have 256K compaction threshold mark
  assert.ok(planContent.includes('256K 自动压缩阈值') || planContent.includes('256K 自动压缩'), 'Must document 256K compaction mark');

  // Must have nullable types in TypeScript contracts
  assert.ok(planContent.includes('tps: number | null'), 'tps must be nullable in contract');
  assert.ok(planContent.includes('ttftSec: number | null'), 'ttftSec must be nullable in contract');
  assert.ok(planContent.includes('cacheHitRatePct: number | null'), 'cacheHitRatePct must be nullable in contract');

  // Must have 180s tool duration cap
  assert.ok(planContent.includes('Math.min(180_000, rawDuration)'), 'Must clamp tool duration to 180s');

  // Must have 300s TTFT upper bound for reasoning models
  assert.ok(planContent.includes('300_000'), 'Must expand TTFT upper bound to 300,000ms for reasoning models');

  // Must have light theme fallback tokens
  assert.ok(planContent.includes('.theme-light') || planContent.includes('[data-theme="light"]'), 'Must include light theme tokens');
});

console.log('\n============================================================');
console.log(`Re-verification Summary: ${passedTests}/${totalTests} tests passed`);
console.log(`Confirmed Vulnerabilities / Regressions: ${failureFindings.length}`);
console.log('============================================================\n');

if (failureFindings.length > 0) {
  process.exit(1);
}
