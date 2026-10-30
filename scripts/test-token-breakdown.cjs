const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Hook .ts and .tsx loader for lightweight Node test execution
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
    compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  module._compile(compiled, filename);
};

const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

// 1. Verify Translations
const { translations } = require('../src/i18n/translations');

const requiredKeys = [
  'periodSummary',
  'incompleteBreakdown',
  'kpiLifetimeTokens',
  'inputChannelTitle',
  'outputChannelTitle',
  'activeDays',
  'compositionByChannel',
  'cacheReadLabel',
  'rawInputLabel',
  'thinkingTokensLabel',
  'responseTokensLabel',
];

for (const lang of ['en', 'zh']) {
  assert(translations[lang], `translations must have ${lang}`);
  for (const key of requiredKeys) {
    assert(translations[lang][key], `translations.${lang} missing required key: ${key}`);
  }
}
console.log('PASS: i18n keys for TokenSummaryTile exist in all locales');

// 2. Import Components
const { TokenSummaryTile } = require('../src/components/stats/TokenSummaryTile');
const { LanguageProvider } = require('../src/i18n/LanguageContext');

function renderTile(stats) {
  return renderToStaticMarkup(
    React.createElement(
      LanguageProvider,
      null,
      React.createElement(TokenSummaryTile, { stats })
    )
  );
}

function buildStats(breakdown) {
  return {
    kpis: { lifetimeTokens: '1.91B', lifetimeTokensRaw: 1910000000 },
    activity: { heatmap: [], activeDaysCount: 28 },
    tokenBreakdown: breakdown,
  };
}

// 3. Test: Incomplete breakdown rendering
const fallbackHtml = renderTile(buildStats(undefined));
assert(
  fallbackHtml.includes(translations.en.incompleteBreakdown) || fallbackHtml.includes(translations.zh.incompleteBreakdown),
  'Should render incomplete breakdown text when undefined'
);
console.log('PASS: undefined breakdown renders fallback safely');

// 4. Test: Normal breakdown rendering (Real Ground Truth Data)
const normalBreakdown = {
  cacheReadTokens: 1170000000,
  cacheReadTokensFormatted: '1.17B',
  inputTokens: 73700000,
  inputTokensFormatted: '73.7M',
  totalPromptTokens: 1243700000,
  totalPromptTokensFormatted: '1.24B',
  cacheHitRate: '94.1%',
  outputTokens: 7100000,
  outputTokensFormatted: '7.1M',
  thinkingTokens: 3100000,
  thinkingTokensFormatted: '3.1M',
  responseTokens: 4000000,
  responseTokensFormatted: '4.0M',
  reasoningPct: 43.7,
};

const normalHtml = renderTile(buildStats(normalBreakdown));

// Must not contain NaN or undefined
assert(!normalHtml.includes('NaN'), 'Rendered HTML must never contain NaN');
assert(!normalHtml.includes('undefined'), 'Rendered HTML must never contain undefined');

// Must contain the four channel colors
assert(normalHtml.includes('#34b8ac'), 'Must render cache read segment color #34b8ac');
assert(normalHtml.includes('#699ef5'), 'Must render raw input segment color #699ef5');
assert(normalHtml.includes('#b791e8'), 'Must render thinking segment color #b791e8');
assert(normalHtml.includes('#e8b867'), 'Must render response segment color #e8b867');

// Must contain the summary segments and the composition header (either locale)
for (const key of ['kpiLifetimeTokens', 'inputChannelTitle', 'outputChannelTitle', 'activeDays', 'compositionByChannel']) {
  assert(
    normalHtml.includes(translations.en[key]) || normalHtml.includes(translations.zh[key]),
    `Must render summary segment/header: ${key}`
  );
}

// Must contain formatted values and percentage shares
assert(normalHtml.includes('1.91B'), 'Must render formatted lifetime token value');
assert(normalHtml.includes('1.24B'), 'Must render formatted input value');
assert(normalHtml.includes('7.1M'), 'Must render formatted output value');
assert(normalHtml.includes('28'), 'Must render active days count');
// Channel shares of the full total (1,247,810,000 overall)
const totalTokens = 1170000000 + 73700000 + 3100000 + 4000000;
const shareOf = v => `${((v / totalTokens) * 100).toFixed(1)}%`;
assert(normalHtml.includes(shareOf(1170000000)), 'Must render cache read share');
assert(normalHtml.includes(shareOf(4000000)), 'Must render response share');

console.log('PASS: normal breakdown renders summary segments and composition bar');

// 5. Test: Zero/Empty breakdown boundary case
const zeroBreakdown = {
  cacheReadTokens: 0,
  cacheReadTokensFormatted: '0',
  inputTokens: 0,
  inputTokensFormatted: '0',
  totalPromptTokens: 0,
  totalPromptTokensFormatted: '0',
  cacheHitRate: '0%',
  outputTokens: 0,
  outputTokensFormatted: '0',
  thinkingTokens: 0,
  thinkingTokensFormatted: '0',
  responseTokens: 0,
  responseTokensFormatted: '0',
  reasoningPct: 0,
};

const zeroHtml = renderTile(buildStats(zeroBreakdown));
assert(!zeroHtml.includes('NaN'), 'Zero breakdown must not produce NaN');
assert(!zeroHtml.includes('Infinity'), 'Zero breakdown must not produce Infinity');
assert(zeroHtml.includes('—'), 'Zero breakdown channel shares should render dash');
console.log('PASS: zero breakdown handles division by zero gracefully without NaN');

// 6. Test: Cold Cache (0 cache reads, 100k input) — shares are of the grand total
const coldCacheBreakdown = {
  ...zeroBreakdown,
  inputTokens: 100000,
  totalPromptTokens: 100000,
  outputTokens: 5000,
  responseTokens: 5000,
};
const coldHtml = renderTile(buildStats(coldCacheBreakdown));
assert(!coldHtml.includes('NaN'), 'Cold cache breakdown must not produce NaN');
assert(!coldHtml.includes('Infinity'), 'Cold cache breakdown must not produce Infinity');
const coldTotal = 100000 + 5000;
assert(coldHtml.includes(`${((100000 / coldTotal) * 100).toFixed(1)}%`), 'Uncached input dominates the composition share');
console.log('PASS: cold cache (0 cache, raw-input dominant) operates correctly');

// 7. Test: Zero Thinking (standard call, 0 thinking tokens)
const noThinkingBreakdown = {
  ...normalBreakdown,
  thinkingTokens: 0,
  responseTokens: 5000000,
  outputTokens: 5000000,
};
const noThinkingHtml = renderTile(buildStats(noThinkingBreakdown));
assert(!noThinkingHtml.includes('NaN'), 'No thinking breakdown must not produce NaN');
assert(!noThinkingHtml.includes('Infinity'), 'No thinking breakdown must not produce Infinity');
assert(noThinkingHtml.includes('0.0%'), 'Zero thinking channel should print a real zero share');
console.log('PASS: zero thinking (standard call) operates correctly');

console.log('\nAll TokenSummaryTile tests passed successfully!');
