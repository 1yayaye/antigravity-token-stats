const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const ReactDOMServer = require('react-dom/server');

require.extensions['.ts'] = function (module, filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  module._compile(compiled, filename);
};

require.extensions['.tsx'] = function (module, filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  module._compile(compiled, filename);
};

console.log('=== DeepSeek Harness UI Components Test Suite ===');

// 1. Format Utilities Tests
const { formatDuration, formatCompactTokens } = require('../src/utils/dsh-format.ts');

console.log('\n--- Test 1: formatDuration & formatCompactTokens ---');
// Duration
assert.strictEqual(formatDuration(null), '0秒');
assert.strictEqual(formatDuration(undefined), '0秒');
assert.strictEqual(formatDuration(0), '0秒');
assert.strictEqual(formatDuration(-5), '0秒');
assert.strictEqual(formatDuration(2.9), '2.9秒');
assert.strictEqual(formatDuration(45.2), '45.2秒');
assert.strictEqual(formatDuration(71), '1分11秒');
assert.strictEqual(formatDuration(411), '6分51秒');
assert.strictEqual(formatDuration(411, 'en'), '6m 51s');
assert.strictEqual(formatDuration(2.9, 'en'), '2.9s');
console.log('PASS: formatDuration correctly handles sub-minute, multi-minute, zero/null and English');

// Compact Tokens
assert.strictEqual(formatCompactTokens(null), '0');
assert.strictEqual(formatCompactTokens(undefined), '0');
assert.strictEqual(formatCompactTokens(0), '0');
assert.strictEqual(formatCompactTokens(500), '500');
assert.strictEqual(formatCompactTokens(8200), '8.2K');
assert.strictEqual(formatCompactTokens(72400), '72.4K');
assert.strictEqual(formatCompactTokens(100000), '100K');
assert.strictEqual(formatCompactTokens(256000), '256K');
assert.strictEqual(formatCompactTokens(3762690), '3.8M');
console.log('PASS: formatCompactTokens correctly scales <1K, <100K, >=100K, >=1M');

// 2. React Component Server-Side Rendering Tests
const { SessionStatsPopover } = require('../src/components/dsh/SessionStatsPopover.tsx');
const { TokenUsagePopover } = require('../src/components/dsh/TokenUsagePopover.tsx');
const { ContextUsagePopover } = require('../src/components/dsh/ContextUsagePopover.tsx');
const { DshStatusBar } = require('../src/components/dsh/DshStatusBar.tsx');

console.log('\n--- Test 2: Popover Rendering & Degradation Rules ---');
{
  // SessionStatsPopover normal
  const htmlSession = ReactDOMServer.renderToString(
    React.createElement(SessionStatsPopover, {
      metrics: {
        rounds: 2,
        steps: 78,
        tps: 190,
        modelDurationSec: 411,
        toolDurationSec: 71,
        ttftSec: 2.9,
      },
      lang: 'zh',
    })
  );
  assert(htmlSession.includes('会话统计'), 'Should render title');
  assert(htmlSession.includes('6分51秒'), 'Should render model time 6分51秒');
  assert(htmlSession.includes('1分11秒'), 'Should render tool time 1分11秒');
  assert(htmlSession.includes('2.9秒'), 'Should render TTFT 2.9秒');
  assert(htmlSession.includes('190 tok/s'), 'Should render TPS 190 tok/s');
  assert(htmlSession.includes('正文输出速度 (TPS)'), 'TPS label must identify text-only output');

  // SessionStatsPopover null degradation (canceled/unmeasured)
  const htmlSessionNull = ReactDOMServer.renderToString(
    React.createElement(SessionStatsPopover, {
      metrics: {
        rounds: 1,
        steps: 1,
        tps: null,
        modelDurationSec: 0,
        toolDurationSec: 0,
        ttftSec: null,
      },
      lang: 'zh',
    })
  );
  assert(!htmlSessionNull.includes('NaN'), 'Must not contain NaN');
  assert(htmlSessionNull.includes('--'), 'Must render -- for null TTFT/TPS');
  console.log('PASS: SessionStatsPopover renders exact values and graceful null degradation');
}

{
  // TokenUsagePopover normal
  const htmlToken = ReactDOMServer.renderToString(
    React.createElement(TokenUsagePopover, {
      metrics: {
        totalTokens: 3762690,
        cacheHitRatePct: 99,
        uncachedInputTokens: 27687,
        cacheReadTokens: 3699456,
        outputTokens: 35547,
      },
      lang: 'zh',
    })
  );
  assert(htmlToken.includes('Token 用量'), 'Should render title');
  assert(htmlToken.includes('3,762,690 tok'), 'Should render total tokens formatted');
  assert(htmlToken.includes('99%'), 'Should render cache hit 99%');
  assert(htmlToken.includes('27,687 tok'), 'Should render input tokens formatted');

  // TokenUsagePopover null degradation (zero input)
  const htmlTokenNull = ReactDOMServer.renderToString(
    React.createElement(TokenUsagePopover, {
      metrics: {
        totalTokens: 0,
        cacheHitRatePct: null,
        uncachedInputTokens: 0,
        cacheReadTokens: 0,
        outputTokens: 0,
      },
      lang: 'zh',
    })
  );
  assert(!htmlTokenNull.includes('NaN'), 'Must not contain NaN');
  assert(htmlTokenNull.includes('--'), 'Must render -- for null hit rate');
  console.log('PASS: TokenUsagePopover renders exact values and null degradation');
}

{
  // ContextUsagePopover
  const htmlContext = ReactDOMServer.renderToString(
    React.createElement(ContextUsagePopover, {
      metrics: {
        usedTokens: 72400,
        limitTokens: 1048576,
        usedPct: 7,
        systemPromptTokens: 8200,
        toolDefinitionTokens: 8300,
        chatMessageTokens: 55900,
      },
      lang: 'zh',
    })
  );
  assert(htmlContext.includes('上下文已用'), 'Should render context used title');
  assert(htmlContext.includes('7%'), 'Should render 7%');
  assert(htmlContext.includes('~72.4K / 1M'), 'Should render ~72.4K / 1M');
  assert(htmlContext.includes('24.41%'), 'Should render 256K threshold marker at 24.41%');
  assert(htmlContext.includes('系统提示词'), 'Should render system prompt legend');
  assert(htmlContext.includes('~8.2K'), 'Should render ~8.2K system prompt tokens');
  assert(htmlContext.includes('工具定义'), 'Should render tool definition legend');
  assert(htmlContext.includes('~8.3K'), 'Should render ~8.3K tool definition tokens');
  assert(htmlContext.includes('对话消息'), 'Should render chat message legend');
  assert(htmlContext.includes('压缩'), 'Should contain 压缩 keyword for acceptance check');
  assert(htmlContext.includes('缓存'), 'Should contain 缓存 keyword for acceptance check');
  console.log('PASS: ContextUsagePopover renders segmented bar, 256K mark and legend');
}

console.log('\n--- Test 3: DshStatusBar Component Rendering ---');
{
  const telemetry = {
    sessionId: 'test-session',
    isStreaming: false,
    session: {
      rounds: 2,
      steps: 78,
      tps: 190,
      modelDurationSec: 411,
      toolDurationSec: 71,
      ttftSec: 2.9,
    },
    token: {
      totalTokens: 3762690,
      cacheHitRatePct: 99,
      uncachedInputTokens: 27687,
      cacheReadTokens: 3699456,
      outputTokens: 35547,
    },
    context: {
      usedTokens: 72400,
      limitTokens: 1048576,
      usedPct: 7,
      systemPromptTokens: 8200,
      toolDefinitionTokens: 8300,
      chatMessageTokens: 55900,
    },
  };

  const htmlBar = ReactDOMServer.renderToString(
    React.createElement(DshStatusBar, { telemetry, lang: 'zh' })
  );
  assert(htmlBar.includes('dsh-pill-performance'), 'Must contain performance pill');
  assert(htmlBar.includes('2 轮 78 步 · 190 tok/s'), 'Must contain performance text');
  assert(htmlBar.includes('dsh-pill-usage'), 'Must contain usage pill');
  assert(htmlBar.includes('3.8M tok · 缓存命中 99%'), 'Must contain usage text');
  assert(htmlBar.includes('dsh-pill-context'), 'Must contain context pill');
  assert(htmlBar.includes('antigravity-context-usage-pill'), 'Must contain backward-compatible container ID');
  assert(htmlBar.includes('7%'), 'Must contain 7% context donut text');
  console.log('PASS: DshStatusBar renders all 3 pills with correct text');

  // Null degradation test for status bar
  const telemetryNull = {
    ...telemetry,
    session: { ...telemetry.session, tps: null },
    token: { ...telemetry.token, cacheHitRatePct: null },
  };
  const htmlBarNull = ReactDOMServer.renderToString(
    React.createElement(DshStatusBar, { telemetry: telemetryNull, lang: 'zh' })
  );
  assert(!htmlBarNull.includes('NaN'), 'Must not render NaN');
  assert(!htmlBarNull.includes('0 tok/s'), 'Must not fake 0 tok/s');
  assert(htmlBarNull.includes('2 轮 78 步'), 'Should render rounds and steps without TPS');
  console.log('PASS: DshStatusBar null degradation operates cleanly');
}

console.log('\n=============================================================');
console.log('✓ ALL DeepSeek Harness Component Tests Passed Successfully!');
console.log('=============================================================');
