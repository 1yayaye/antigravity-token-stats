const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, filename);
}
require.extensions['.css'] = () => {};

const { IdeWidgets, IdeWidgetContent, widgetSummaries, popoverPosition, detectIdeTheme } = require('../src/webview/standalone.tsx');
const { EMPTY_STATS, toLocalDateKey } = require('../../../src/services/stats-service.ts');
const empty = { stats: null, quota: null, activeSessionId: null, sessionTitle: null, session: null, contextLimit: null, error: null };
const render = (widget, state, extra = {}) => renderToStaticMarkup(React.createElement(IdeWidgetContent, { widget, state, ...extra }));

// 1. Status bar entry order and SVG pill rendering (never plain text)
const barHtml = renderToStaticMarkup(React.createElement(IdeWidgets));
const widgetMatches = [...barHtml.matchAll(/data-widget="([^"]+)"/g)].map(m => m[1]);
assert.deepEqual(widgetMatches, ['session', 'tokens', 'context'], 'Three status widgets must render in order: session, tokens, context');
const buttonSegments = barHtml.split('<button ').slice(1);
assert.equal(buttonSegments.length, 3);
for (const seg of buttonSegments) {
  assert(seg.includes('<svg'), 'Every status bar pill trigger must contain an SVG icon');
}
console.log('PASS: status bar renders 3 icon pill triggers in order [session, tokens, context]');

// 2. Session card: performance metrics, samplesCount, lastRequestTps, response/thinking, and unrecognized state
const session = {
  turnsCount: 2, rounds: 3, steps: 15, samplesCount: 5,
  tps: 104.6, lastRequestTps: 112.4, modelDurationSec: 53, toolDurationSec: 8, ttftSec: 0.6,
  promptTokens: 1000, compactionLimit: 256000, modelName: 'Recorded model', isRunning: true,
  totalTokens: 4600, totalInputTokens: 1200, totalCacheReadTokens: 3000, totalOutputTokens: 400,
  totalThinkingTokens: 90, totalResponseTokens: 310,
};
const context = { ...empty, activeSessionId: 'visible-chat', sessionTitle: 'Visible chat', session };
assert.equal(widgetSummaries(context).session, '104.6 tok/s');
const sessionHtml = render('session', context);
assert(sessionHtml.includes('3 轮 · 15 步 · 5 次采样'));
assert(sessionHtml.includes('53.00s'));
assert(sessionHtml.includes('8.00s'));
assert(sessionHtml.includes('0.60s'));
assert(sessionHtml.includes('104.6 tok/s'));
assert(sessionHtml.includes('112.4 tok/s'));
assert(sessionHtml.includes('310 / 90 tok'));
assert.equal(widgetSummaries(empty).session, '-- tok/s');
const emptySessionHtml = render('session', empty);
assert(emptySessionHtml.includes('未识别当前聊天'));
assert(emptySessionHtml.includes('当前窗口未识别到活跃聊天'));
console.log('PASS: session card renders metrics, samples, last request TPS, and empty state');

// 3. Context card: verified limits, unconfirmed limit honesty, and recorded streaming sample
assert.equal(widgetSummaries(context).context, 'Ctx 1.0K');
const unconfirmedContextHtml = render('context', context);
assert(unconfirmedContextHtml.includes('上限未确认'));
assert(!unconfirmedContextHtml.includes('256'));
assert(unconfirmedContextHtml.includes('生成中 · 保留最近一次已记录采样'));
assert.equal(widgetSummaries({ ...context, contextLimit: 2000 }).context, 'Ctx 50%');
const confirmedContextHtml = render('context', { ...context, contextLimit: 2000 });
assert(confirmedContextHtml.includes('已用 50%（剩余 50%）'));
assert(confirmedContextHtml.includes('1.0K 已用 / 2.0K 上限'));
assert(confirmedContextHtml.includes('width:50%'));
assert.equal(widgetSummaries({ ...context, activeSessionId: null }).context, 'Ctx --');
assert(render('context', { ...context, activeSessionId: null }).includes('未识别当前聊天'));
const freshContext = { ...empty, activeSessionId: 'fresh-chat', contextLimit: 256000, session: { ...session, turnsCount: 0, promptTokens: 0 } };
assert.equal(widgetSummaries(freshContext).context, 'Ctx 待采样', 'Fresh chat with 0 turns must not report Ctx 0%');
const freshContextHtml = render('context', freshContext);
assert(freshContextHtml.includes('待采样'));
assert(freshContextHtml.includes('等待原生聊天路由信号或首个已记录请求'));
assert(!freshContextHtml.includes('已用 0%'));
console.log('PASS: current chat, verified limits, and unconfirmed limit honesty');

// 4. Quota section inside context card: pool switching, invalid fractions, 4-week estimates, and language toggle
assert(render('context', empty).includes('额度不可用'));
const bucket = { displayName: 'Gemini', remainingFraction: 0.75, usedFraction: 0.25, resetTime: new Date(Date.now() + 86400000).toISOString() };
const quota = { capturedAt: new Date().toISOString(), weeklyGemini: bucket, weeklyClaude: { ...bucket, displayName: 'Claude / GPT', remainingFraction: 0.2, usedFraction: 0.8 } };
const geminiHtml = render('context', { ...empty, quota }, { selectedPool: 'gemini' });
assert(geminiHtml.includes('75%'));
assert(geminiHtml.includes('暂无样本'));
const claudeHtml = render('context', { ...empty, quota }, { selectedPool: 'claude' });
assert(claudeHtml.includes('20%'));
for (const remainingFraction of [undefined, null, NaN, -0.1, 1.1]) {
  const invalid = { ...empty, quota: { ...quota, weeklyGemini: { ...bucket, remainingFraction } } };
  const invalidHtml = render('context', invalid, { selectedPool: 'gemini' });
  assert(invalidHtml.includes('不可用'));
  assert(!invalidHtml.includes('NaN'));
}
const stats = structuredClone(EMPTY_STATS);
stats.activity.costTimeline = [{ pool: 'gemini', ts: Date.now() - 60000, costUsd: 10 }];
const quotaWithCycleHtml = render('context', { ...empty, stats, quota: { ...quota, weeklyClaude: undefined } }, { selectedPool: 'gemini' });
assert(quotaWithCycleHtml.includes('四周周期估算'));
assert(quotaWithCycleHtml.includes('25%'));
assert(quotaWithCycleHtml.includes('API 等值消耗 $40.00 / 估算容量 $160.00'));
assert(quotaWithCycleHtml.includes('历史不足四周，已按现有周记录外推估算'));
assert(quotaWithCycleHtml.includes('Language / 语言'));
const enContextHtml = render('context', { ...context, contextLimit: 2000, quota }, { lang: 'en', selectedPool: 'gemini' });
assert(enContextHtml.includes('Context window'));
assert(enContextHtml.includes('50% used (50% left)'));
assert(enContextHtml.includes('Quota group'));
assert(enContextHtml.includes('Weekly quota'));
console.log('PASS: quota stays per pool, invalid/unavailable data and four-week estimates are explicit, i18n works');

// 5. Token card: summary, today/30d KPIs, expandable 3-range drawer, and missing breakdowns
stats.kpis.lifetimeTokensRaw = 1200;
stats.activity.dailyStats = {};
for (const age of [0, 6, 29, 31]) {
  const date = new Date();
  date.setDate(date.getDate() - age);
  stats.activity.dailyStats[toLocalDateKey(date)] = { tokens: 300, tasks: 1, inputTokens: 100, cacheReadTokens: 150, outputTokens: 50, thinkingTokens: 20, responseTokens: 30 };
}
assert.equal(widgetSummaries({ ...empty, stats }).tokens, '300 tok · 命中 60.0%');
assert.equal(widgetSummaries(context).tokens, '4.6K tok · 命中 71.4%');
assert.equal(widgetSummaries(empty).tokens, '— tok');

const collapsedTokenHtml = render('tokens', { ...empty, stats }, { tokenDrawerOpen: false });
assert(collapsedTokenHtml.includes('今日'));
assert(collapsedTokenHtml.includes('近 30 天'));
assert(collapsedTokenHtml.includes('900'));
assert.equal((collapsedTokenHtml.match(/data-range=/g) || []).length, 0, 'Drawer should be collapsed initially');

const tokenHtml = render('tokens', { ...empty, stats }, { tokenDrawerOpen: true });
assert.equal((tokenHtml.match(/data-range=/g) || []).length, 3);
for (const [range, total] of [['today', '300'], ['7d', '600'], ['30d', '900']]) {
  const row = tokenHtml.match(new RegExp(`<tr data-range="${range}">(.*?)</tr>`))[1];
  assert(row.includes(`>${total}</td>`));
}
assert(tokenHtml.includes('思考已包含在输出内'));
delete stats.activity.dailyStats[toLocalDateKey()].cacheReadTokens;
assert.equal((render('tokens', { ...empty, stats }, { tokenDrawerOpen: true }).match(/title="分项不可用">—/g) || []).length, 12);
console.log('PASS: token card KPIs, three local calendar ranges, and missing breakdowns');

// 6. Popover placement bounds in normal and ultra-narrow viewports
assert.deepEqual(popoverPosition({ top: 775, right: 1000 }, 368, 1024, 800), { left: 632, bottom: 31, maxHeight: 761 });
const small = popoverPosition({ top: 45, right: 200 }, 368, 240, 80);
assert(small.left >= 8 && small.left + 224 <= 232);
assert(small.bottom + small.maxHeight <= 72);
console.log('PASS: popover placement is bounded in normal and small windows');

// 7. Real native status bar anchor mounts once and preserves its root on reattachment
const entryPath = require.resolve('../src/webview/standalone.tsx');
const entryRequire = createRequire(entryPath);
const compiledEntry = ts.transpileModule(fs.readFileSync(entryPath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const mounted = [];
let rootsCreated = 0;
let onMutation;
let nextFrame;
const rightItems = () => ({ append(node) { node.parentElement = this; mounted.push(node); } });
let nativeBar = { id: 'workbench.parts.statusbar', className: 'part statusbar status-border-top', rightItems: rightItems() };
vm.runInNewContext(compiledEntry, {
  exports: {},
  require: name => name === 'react-dom/client' ? {
    createRoot: () => { rootsCreated++; return { render() {} }; },
  } : entryRequire(name),
  document: {
    documentElement: {},
    querySelector: selector => selector === '.part.statusbar .right-items' ? nativeBar?.rightItems : null,
    getElementById: id => mounted.find(node => node.id === id) || null,
    createElement: () => ({ parentElement: null }),
  },
  MutationObserver: class { constructor(callback) { onMutation = callback; } observe() {} },
  requestAnimationFrame: callback => { nextFrame = callback; return 1; },
});
assert.equal(rootsCreated, 1, 'The observed native status bar must mount a React root');
assert.equal(mounted[0].parentElement, nativeBar.rightItems);
const originalContainer = mounted[0];
nativeBar = { ...nativeBar, rightItems: rightItems() };
onMutation();
nextFrame();
assert.equal(mounted[1], originalContainer, 'Replacing the native bar must move the existing container');
assert.equal(originalContainer.parentElement, nativeBar.rightItems);
assert.equal(rootsCreated, 1, 'Reattachment must preserve the existing React root');
onMutation();
nextFrame();
assert.equal(mounted.length, 2, 'Unrelated DOM changes must not append a duplicate container');
console.log('PASS: real native status bar anchor mounts once and preserves its root on reattachment');

// 8. Theme detection handles .monaco-workbench classes when body/documentElement lack them
const makeClassList = (...classes) => ({ contains: name => classes.includes(name) });
const prevDoc = global.document;
try {
  global.document = {
    documentElement: { classList: makeClassList(), getAttribute: () => null },
    body: { classList: makeClassList(), getAttribute: () => null },
    querySelector: sel => sel === '.monaco-workbench' ? { classList: makeClassList('monaco-workbench', 'vs'), getAttribute: () => null } : null,
  };
  assert.equal(detectIdeTheme(), 'light', '.monaco-workbench.vs must resolve to light theme');
  global.document.querySelector = sel => sel === '.monaco-workbench' ? { classList: makeClassList('monaco-workbench', 'vs-dark'), getAttribute: () => null } : null;
  assert.equal(detectIdeTheme(), 'dark', '.monaco-workbench.vs-dark must resolve to dark theme');
  global.document.querySelector = sel => sel === '.monaco-workbench' ? { classList: makeClassList('monaco-workbench'), getAttribute: attr => attr === 'data-vscode-theme-kind' ? 'vscode-light' : null } : null;
  assert.equal(detectIdeTheme(), 'light', 'data-vscode-theme-kind=vscode-light must resolve to light theme');
} finally {
  global.document = prevDoc;
}
console.log('PASS: detectIdeTheme resolves light/dark from .monaco-workbench and theme attributes');
