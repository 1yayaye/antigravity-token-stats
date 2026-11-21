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

console.log('=== Status Bar UI Components Test Suite ===');

// 1. Format Utilities Tests
const { formatDuration, formatCompactTokens, resolveModelContextLimit } = require('../src/utils/telemetry-format.ts');

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

assert.strictEqual(resolveModelContextLimit('Gemini 4 Hydrogen Medium'), 512000);
assert.strictEqual(resolveModelContextLimit('Orchestrator (Argon)'), 512000);
assert.strictEqual(resolveModelContextLimit('Orchestrator (Carbon)'), 512000);
assert.strictEqual(resolveModelContextLimit('orchestrator-carbon'), 512000);
assert.strictEqual(resolveModelContextLimit('gemini-pro-orchestrator-g1-pro'), 512000);
assert.strictEqual(resolveModelContextLimit('gemini-4-high'), 512000);
assert.strictEqual(resolveModelContextLimit('orchestrator-worker'), 512000);
assert.strictEqual(resolveModelContextLimit('Gemini 4 Carbon'), 512000);
assert.strictEqual(resolveModelContextLimit('Gemini 4 Neon Medium'), 512000);
assert.strictEqual(resolveModelContextLimit('Orchestrator Gemini 4 Neon High'), 512000);
assert.strictEqual(resolveModelContextLimit('Orchestrator Claude Opus 5.5 Medium'), 512000);
assert.strictEqual(resolveModelContextLimit('Claude Opus 5.5 Medium'), 512000);
assert.strictEqual(resolveModelContextLimit('Orchestrator Claude Sonnet 5.5 Medium'), 256000);
assert.strictEqual(resolveModelContextLimit('Claude Sonnet 5.5 (High)'), 256000);
assert.strictEqual(resolveModelContextLimit('', 0), 256000);
assert.strictEqual(resolveModelContextLimit('Gemini 4 Hydrogen Medium', 600000), 1000000);
assert.strictEqual(resolveModelContextLimit('Gemini 4 Hydrogen Medium', 0, { 'gemini-4-hydrogen-medium': 768000 }), 768000);
assert.strictEqual(resolveModelContextLimit('Gemini 4 Hydrogen', 0, { 'gemini-4': 256000, 'gemini-4-hydrogen': 512000 }), 512000);
assert.strictEqual(resolveModelContextLimit('Orchestrator Gemini 4 Neon High', 0, { 'gemini-4-neon': 1000000 }), 1000000);
console.log('PASS: resolveModelContextLimit maps UI model labels, live limits, and overflow tiers');

// 2. React Component Server-Side Rendering Tests
const { SessionStatsPopover } = require('../src/components/statusbar/SessionStatsPopover.tsx');
const { TokenUsagePopover } = require('../src/components/statusbar/TokenUsagePopover.tsx');
const { ContextUsagePopover } = require('../src/components/statusbar/ContextUsagePopover.tsx');
const {
  StatusBar,
  STATUSBAR_DISPLAY_MODE_STORAGE_KEY,
  getStatusBarDisplayMode,
  setStatusBarDisplayMode,
} = require('../src/components/statusbar/StatusBar.tsx');

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
        limitTokens: 256000,
        usedPct: 28,
        systemPromptTokens: 8200,
        toolDefinitionTokens: 8300,
        chatMessageTokens: 55900,
      },
      lang: 'zh',
    })
  );
  assert(htmlContext.includes('上下文已用'), 'Should render context used title');
  assert(htmlContext.includes('28%'), 'Should render 28%');
  assert(htmlContext.includes('~72.4K / 256K'), 'Should render ~72.4K / 256K');
  assert(!htmlContext.includes('24.41%'), 'Should not render obsolete 24.41% marker');
  assert(htmlContext.includes('系统提示词'), 'Should render system prompt legend');
  assert(htmlContext.includes('~8.2K'), 'Should render ~8.2K system prompt tokens');
  assert(htmlContext.includes('工具定义'), 'Should render tool definition legend');
  assert(htmlContext.includes('~8.3K'), 'Should render ~8.3K tool definition tokens');
  assert(htmlContext.includes('对话消息'), 'Should render chat message legend');
  assert(htmlContext.includes('压缩'), 'Should contain 压缩 keyword for acceptance check');
  assert(htmlContext.includes('缓存'), 'Should contain 缓存 keyword for acceptance check');
  assert(htmlContext.includes('id="statusbar-popover-mode-toggle"'), 'Should render status bar display mode toggle button');
  assert(htmlContext.includes('详细 · 全部胶囊'), 'Default popover toggle label should indicate detailed mode');

  const htmlContextStandard = ReactDOMServer.renderToString(
    React.createElement(ContextUsagePopover, {
      metrics: {
        usedTokens: 72400,
        limitTokens: 256000,
        usedPct: 28,
        systemPromptTokens: 8200,
        toolDefinitionTokens: 8300,
        chatMessageTokens: 55900,
      },
      lang: 'zh',
      displayMode: 'standard',
    })
  );
  assert(htmlContextStandard.includes('id="statusbar-popover-mode-toggle"'), 'Standard popover should render toggle button');
  assert(htmlContextStandard.includes('标准 · 精简胶囊'), 'Standard popover toggle label should indicate standard mode');

  const htmlContextCompact = ReactDOMServer.renderToString(
    React.createElement(ContextUsagePopover, {
      metrics: {
        usedTokens: 72400,
        limitTokens: 256000,
        usedPct: 28,
        systemPromptTokens: 8200,
        toolDefinitionTokens: 8300,
        chatMessageTokens: 55900,
      },
      lang: 'en',
      displayMode: 'compact',
    })
  );
  assert(htmlContextCompact.includes('id="statusbar-popover-mode-toggle"'), 'Compact popover should render toggle button');
  assert(htmlContextCompact.includes('Compact · Context'), 'Compact popover toggle label should indicate compact mode');
  console.log('PASS: ContextUsagePopover renders segmented bar, legend, and display mode toggle');
}

console.log('\n--- Test 3: StatusBar Component Rendering ---');
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
      limitTokens: 256000,
      usedPct: 28,
      systemPromptTokens: 8200,
      toolDefinitionTokens: 8300,
      chatMessageTokens: 55900,
    },
  };

  const htmlBar = ReactDOMServer.renderToString(
    React.createElement(StatusBar, { telemetry, lang: 'zh' })
  );
  const textBar = htmlBar.replace(/<[^>]+>/g, '');
  assert(htmlBar.includes('statusbar-pill-performance'), 'Must contain performance pill');
  assert(textBar.includes('2 轮 78 步 · 190 tok/s'), 'Must contain full performance text across spans');
  assert(htmlBar.includes('sb-pill-full-only">2 轮 78 步 · </span><span class="sb-pill-compact-keep">190 tok/s</span>'), 'Must split performance pill for compact split-pane display');
  assert(htmlBar.includes('statusbar-pill-usage'), 'Must contain usage pill');
  assert(textBar.includes('3.8M tok · 缓存命中 99%'), 'Must contain full usage text across spans');
  assert(htmlBar.includes('sb-pill-full-only">3.8M tok · 缓存命中 </span><span class="sb-pill-compact-keep">99%</span>'), 'Must split usage pill to keep cache percentage in compact mode');
  assert(htmlBar.includes('statusbar-pill-context'), 'Must contain context pill');
  assert(/id="statusbar-pill-performance"[^>]*class="sb-pill sb-pill-secondary\b/.test(htmlBar), 'Performance pill must carry sb-pill-secondary for narrow hiding');
  assert(/id="statusbar-pill-usage"[^>]*class="sb-pill sb-pill-secondary\b/.test(htmlBar), 'Usage pill must carry sb-pill-secondary for narrow hiding');
  assert(!/id="statusbar-pill-context"[^>]*class="[^"]*\bsb-pill-secondary\b/.test(htmlBar), 'Context pill must stay visible in narrow split panes');
  assert(htmlBar.includes('antigravity-context-usage-pill'), 'Must contain context usage pill wrapper ID');
  assert(htmlBar.includes('28%'), 'Must contain 28% context donut text');
  console.log('PASS: StatusBar renders all 3 pills with responsive split-pane spans');

  // Null degradation test for status bar
  const telemetryNull = {
    ...telemetry,
    session: { ...telemetry.session, tps: null },
    token: { ...telemetry.token, cacheHitRatePct: null },
  };
  const htmlBarNull = ReactDOMServer.renderToString(
    React.createElement(StatusBar, { telemetry: telemetryNull, lang: 'zh' })
  );
  assert(!htmlBarNull.includes('NaN'), 'Must not render NaN');
  assert(!htmlBarNull.includes('0 tok/s'), 'Must not fake 0 tok/s');
  assert(!htmlBarNull.includes('sb-pill-compact-keep'), 'Must omit compact-keep spans when tps and cacheHitRatePct are null');
  assert(htmlBarNull.includes('sb-pill-full-only'), 'Must keep full-only text when tps and cacheHitRatePct are null');
  assert(htmlBarNull.includes('2 轮 78 步'), 'Should render rounds and steps without TPS');
  assert(htmlBarNull.includes('3.8M tok'), 'Should render compact total tokens without cache hit rate');
  console.log('PASS: StatusBar null degradation operates cleanly');

  // Detailed vs Standard vs Compact display mode & localStorage persistence
  const indexCss = fs.readFileSync(path.join(__dirname, '../src/index.css'), 'utf8');
  assert(indexCss.includes('statusbar-standard'), 'index.css must style statusbar-standard mode');
  assert(!indexCss.includes('span > .sb-pill-full-only'), 'index.css must not rely on span > .sb-pill-full-only CSS hiding for standard mode');
  assert(!/statusbar-standard[^{]*\.sb-pill\b/.test(indexCss), 'standard mode must not override .sb-pill padding/gap (keeps context pill aligned across all modes)');

  const prevStorage = global.localStorage;
  const store = new Map();
  global.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  try {
    assert.strictEqual(getStatusBarDisplayMode(), 'detailed', 'Default display mode must be detailed');
    assert(htmlBar.includes('data-display-mode="detailed"'), 'Detailed mode must set data-display-mode="detailed"');
    assert(!htmlBar.includes('statusbar-compact'), 'Detailed mode must not add statusbar-compact');
    assert(!htmlBar.includes('statusbar-standard'), 'Detailed mode must not add statusbar-standard');

    setStatusBarDisplayMode('standard');
    assert.strictEqual(store.get(STATUSBAR_DISPLAY_MODE_STORAGE_KEY), 'standard', 'setStatusBarDisplayMode must persist standard mode to localStorage');
    assert.strictEqual(getStatusBarDisplayMode(), 'standard', 'getStatusBarDisplayMode must read persisted standard mode');

    const htmlBarStandardPersisted = ReactDOMServer.renderToString(
      React.createElement(StatusBar, { telemetry, lang: 'zh' })
    );
    const textBarStandardPersisted = htmlBarStandardPersisted.replace(/<[^>]+>/g, '');
    assert(htmlBarStandardPersisted.includes('statusbar-standard'), 'Persisted standard mode must add statusbar-standard class');
    assert(!htmlBarStandardPersisted.includes('statusbar-compact'), 'Standard mode must not add statusbar-compact class');
    assert(htmlBarStandardPersisted.includes('data-display-mode="standard"'), 'Persisted standard mode must set data-display-mode="standard"');
    assert(htmlBarStandardPersisted.includes('sb-pill-compact-keep'), 'Standard mode must render concise metrics inside sb-pill-compact-keep');
    assert(textBarStandardPersisted.includes('190 tok/s'), 'Standard mode must render TPS value');
    assert(textBarStandardPersisted.includes('99%'), 'Standard mode must render cache hit percentage');
    assert(!htmlBarStandardPersisted.includes('sb-pill-full-only'), 'Standard mode must omit sb-pill-full-only spans');
    assert(!textBarStandardPersisted.includes('2 轮 78 步'), 'Standard mode must not render rounds/steps');
    assert(!textBarStandardPersisted.includes('3.8M tok'), 'Standard mode must not render total tokens');
    assert(!textBarStandardPersisted.includes('缓存命中'), 'Standard mode must not render cache label prefix');
    assert(/id="statusbar-pill-performance"[^>]*aria-label="性能统计: 190 tok\/s"/.test(htmlBarStandardPersisted), 'Standard mode performance pill aria-label must match concise readout');
    assert(/id="statusbar-pill-usage"[^>]*aria-label="用量统计: 99%"/.test(htmlBarStandardPersisted), 'Standard mode usage pill aria-label must match concise readout');
    assert(!/id="statusbar-pill-performance"[^>]*aria-hidden="true"/.test(htmlBarStandardPersisted), 'Standard mode must keep performance pill accessible');
    assert(!/id="statusbar-pill-usage"[^>]*aria-hidden="true"/.test(htmlBarStandardPersisted), 'Standard mode must keep usage pill accessible');
    assert(!/id="statusbar-pill-performance"[^>]*tabindex="-1"/.test(htmlBarStandardPersisted), 'Standard mode must keep performance pill focusable');
    assert(!/id="statusbar-pill-usage"[^>]*tabindex="-1"/.test(htmlBarStandardPersisted), 'Standard mode must keep usage pill focusable');

    const telemetryInitialEmpty = {
      sessionId: '',
      isStreaming: false,
      session: {
        rounds: 1,
        steps: 0,
        tps: null,
        modelDurationSec: 0,
        toolDurationSec: 0,
        ttftSec: null,
      },
      token: {
        totalTokens: 0,
        cacheHitRatePct: null,
        uncachedInputTokens: 0,
        cacheReadTokens: 0,
        outputTokens: 0,
      },
      context: {
        usedTokens: 0,
        limitTokens: 256000,
        usedPct: 0,
        systemPromptTokens: 0,
        toolDefinitionTokens: 0,
        chatMessageTokens: 0,
      },
    };
    for (const checkLang of ['zh', 'en']) {
      const htmlBarStandardEmpty = ReactDOMServer.renderToString(
        React.createElement(StatusBar, { telemetry: telemetryInitialEmpty, lang: checkLang })
      );
      const textBarStandardEmpty = htmlBarStandardEmpty.replace(/<[^>]+>/g, '');
      assert(textBarStandardEmpty.includes('-- tok/s'), `Initial standard mode (${checkLang}) must render -- tok/s placeholder`);
      assert(textBarStandardEmpty.includes('--%'), `Initial standard mode (${checkLang}) must render --% placeholder`);
      assert(textBarStandardEmpty.includes('0%'), `Initial standard mode (${checkLang}) must render 0% context readout`);
      assert(/id="statusbar-pill-performance"[^>]*aria-label="[^"]*-- tok\/s"/.test(htmlBarStandardEmpty), `Initial standard mode (${checkLang}) performance aria-label must report -- tok/s`);
      assert(/id="statusbar-pill-usage"[^>]*aria-label="[^"]*--%"/.test(htmlBarStandardEmpty), `Initial standard mode (${checkLang}) usage aria-label must report --%`);
      assert(!textBarStandardEmpty.includes('1 轮 0 步'), `Initial standard mode (${checkLang}) must not leak 1 轮 0 步`);
      assert(!textBarStandardEmpty.includes('轮') && !textBarStandardEmpty.includes('步'), `Initial standard mode (${checkLang}) must not leak Chinese round/step labels`);
      assert(!textBarStandardEmpty.includes('rounds') && !textBarStandardEmpty.includes('steps'), `Initial standard mode (${checkLang}) must not leak English round/step labels`);
      assert(!textBarStandardEmpty.includes('0 tok'), `Initial standard mode (${checkLang}) must not render 0 tok or 0 tok/s`);
      assert(!textBarStandardEmpty.includes('NaN'), `Initial standard mode (${checkLang}) must not contain NaN`);
      assert(!htmlBarStandardEmpty.includes('sb-pill-full-only'), `Initial standard mode (${checkLang}) must not emit sb-pill-full-only`);
    }

    const telemetryPartialStandard = {
      ...telemetryInitialEmpty,
      token: {
        ...telemetryInitialEmpty.token,
        totalTokens: 500,
        cacheHitRatePct: 0,
      },
    };
    const htmlBarStandardPartial = ReactDOMServer.renderToString(
      React.createElement(StatusBar, { telemetry: telemetryPartialStandard, lang: 'zh' })
    );
    const textBarStandardPartial = htmlBarStandardPartial.replace(/<[^>]+>/g, '');
    assert(textBarStandardPartial.includes('-- tok/s'), 'Partial standard mode must keep -- tok/s when tps is null');
    assert(textBarStandardPartial.includes('0%') && !textBarStandardPartial.includes('--%'), 'Partial standard mode must render honest 0% when cacheHitRatePct is 0');

    setStatusBarDisplayMode('compact');
    assert.strictEqual(store.get(STATUSBAR_DISPLAY_MODE_STORAGE_KEY), 'compact', 'setStatusBarDisplayMode must persist compact mode to localStorage');
    assert.strictEqual(getStatusBarDisplayMode(), 'compact', 'getStatusBarDisplayMode must read persisted compact mode');

    const htmlBarCompactPersisted = ReactDOMServer.renderToString(
      React.createElement(StatusBar, { telemetry, lang: 'zh' })
    );
    assert(htmlBarCompactPersisted.includes('statusbar-compact'), 'Persisted compact mode must add statusbar-compact class');
    assert(htmlBarCompactPersisted.includes('data-display-mode="compact"'), 'Persisted compact mode must set data-display-mode="compact"');

    const htmlBarCompactProp = ReactDOMServer.renderToString(
      React.createElement(StatusBar, { telemetry, lang: 'en', displayMode: 'compact' })
    );
    assert(/id="statusbar-pill-performance"[^>]*aria-hidden="true"/.test(htmlBarCompactProp), 'Compact mode must mark performance pill aria-hidden="true"');
    assert(/id="statusbar-pill-performance"[^>]*tabindex="-1"/.test(htmlBarCompactProp), 'Compact mode must mark performance pill tabindex="-1"');
    assert(/id="statusbar-pill-usage"[^>]*aria-hidden="true"/.test(htmlBarCompactProp), 'Compact mode must mark usage pill aria-hidden="true"');
    assert(/id="statusbar-pill-usage"[^>]*tabindex="-1"/.test(htmlBarCompactProp), 'Compact mode must mark usage pill tabindex="-1"');
    assert(!/id="statusbar-pill-context"[^>]*aria-hidden="true"/.test(htmlBarCompactProp), 'Context pill must stay accessible in compact mode');
    assert(!/id="statusbar-pill-context"[^>]*tabindex="-1"/.test(htmlBarCompactProp), 'Context pill must stay focusable in compact mode');

    setStatusBarDisplayMode('detailed');
    assert.strictEqual(store.get(STATUSBAR_DISPLAY_MODE_STORAGE_KEY), 'detailed', 'setStatusBarDisplayMode must persist detailed mode back to localStorage');
    assert.strictEqual(getStatusBarDisplayMode(), 'detailed');
    console.log('PASS: StatusBar detailed/standard/compact mode rendering and localStorage persistence verified');
  } finally {
    if (prevStorage === undefined) delete global.localStorage;
    else global.localStorage = prevStorage;
  }
}

console.log('\n=============================================================');
console.log('✓ ALL Status Bar Component Tests Passed Successfully!');
console.log('=============================================================');
