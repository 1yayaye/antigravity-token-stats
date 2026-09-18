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
  'tokenBreakdownTitle',
  'incompleteBreakdown',
  'inputChannelTitle',
  'outputChannelTitle',
  'cacheReadLabel',
  'rawInputLabel',
  'thinkingTokensLabel',
  'responseTokensLabel',
  'cacheHitRateBadge',
  'shareOfInput',
  'shareOfOutput',
  'tokensWord',
];

for (const lang of ['en', 'zh']) {
  assert(translations[lang], `translations must have ${lang}`);
  for (const key of requiredKeys) {
    assert(translations[lang][key], `translations.${lang} missing required key: ${key}`);
  }
}
console.log('PASS: i18n keys for TokenBreakdownCard exist in all locales');

// 2. Import Components
const { TokenBreakdownCard } = require('../src/components/stats/TokenBreakdownCard');
const { LanguageProvider } = require('../src/i18n/LanguageContext');

function renderCard(breakdown) {
  return renderToStaticMarkup(
    React.createElement(
      LanguageProvider,
      null,
      React.createElement(TokenBreakdownCard, { breakdown })
    )
  );
}

// 3. Test: Incomplete breakdown rendering
const fallbackHtml = renderCard(undefined);
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

const normalHtml = renderCard(normalBreakdown);

// Must not contain NaN or undefined
assert(!normalHtml.includes('NaN'), 'Rendered HTML must never contain NaN');
assert(!normalHtml.includes('undefined'), 'Rendered HTML must never contain undefined');

// Must contain the four table row colors
assert(normalHtml.includes('#34b8ac'), 'Must render cache read segment color #34b8ac');
assert(normalHtml.includes('#699ef5'), 'Must render raw input segment color #699ef5');
assert(normalHtml.includes('#b791e8'), 'Must render thinking segment color #b791e8');
assert(normalHtml.includes('#e8b867'), 'Must render response segment color #e8b867');

// Must contain right-side Layout 1 panels (check either en or zh)
assert(
  normalHtml.includes(translations.en.inputChannelTitle) || normalHtml.includes(translations.zh.inputChannelTitle),
  'Must render Input Channel Title'
);
assert(
  normalHtml.includes(translations.en.outputChannelTitle) || normalHtml.includes(translations.zh.outputChannelTitle),
  'Must render Output Channel Title'
);
assert(
  normalHtml.includes(translations.en.shareOfInput) || normalHtml.includes(translations.zh.shareOfInput),
  'Must render share of input denominator'
);
assert(
  normalHtml.includes(translations.en.shareOfOutput) || normalHtml.includes(translations.zh.shareOfOutput),
  'Must render share of output denominator'
);

// Must contain formatted values and percentage shares
assert(normalHtml.includes('1.17B'), 'Must render formatted cache value');
assert(normalHtml.includes('73.7M'), 'Must render formatted raw input value');
assert(normalHtml.includes('3.1M'), 'Must render formatted thinking value');
assert(normalHtml.includes('4.0M'), 'Must render formatted response value');
assert(normalHtml.includes('94.1%'), 'Must render 94.1% cache hit rate');

console.log('PASS: normal breakdown renders four token rows and channel panels');

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

const zeroHtml = renderCard(zeroBreakdown);
assert(!zeroHtml.includes('NaN'), 'Zero breakdown must not produce NaN');
assert(!zeroHtml.includes('Infinity'), 'Zero breakdown must not produce Infinity');
assert(zeroHtml.includes('—'), 'Zero breakdown channel shares should render dash');
console.log('PASS: zero breakdown handles division by zero gracefully without NaN');

// 6. Test: Cold Cache (0 cache reads, 100k input)
const coldCacheBreakdown = {
  ...zeroBreakdown,
  inputTokens: 100000,
  totalPromptTokens: 100000,
  outputTokens: 5000,
  responseTokens: 5000,
};
const coldHtml = renderCard(coldCacheBreakdown);
assert(!coldHtml.includes('NaN'), 'Cold cache breakdown must not produce NaN');
assert(coldHtml.includes('100.0%'), '100% uncached input share should be displayed');
console.log('PASS: cold cache (0 cache, 100% raw input) operates correctly');

// 7. Test: Zero Thinking (standard call, 0 thinking tokens)
const noThinkingBreakdown = {
  ...normalBreakdown,
  thinkingTokens: 0,
  responseTokens: 5000000,
  outputTokens: 5000000,
};
const noThinkingHtml = renderCard(noThinkingBreakdown);
assert(!noThinkingHtml.includes('NaN'), 'No thinking breakdown must not produce NaN');
assert(noThinkingHtml.includes('100.0%'), '100% response share should be displayed');
console.log('PASS: zero thinking (standard call) operates correctly');

console.log('\nAll TokenBreakdownCard tests passed successfully!');
