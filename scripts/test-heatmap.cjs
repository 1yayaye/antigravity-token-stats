const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Hook .ts and .tsx loader for lightweight Node test execution
if (!require.extensions['.ts']) {
  require.extensions['.ts'] = function (module, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    module._compile(compiled, filename);
  };
}

if (!require.extensions['.tsx']) {
  require.extensions['.tsx'] = function (module, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    const compiled = ts.transpileModule(source, {
      compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    module._compile(compiled, filename);
  };
}

const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const { buildActivityHistory } = require('../src/services/activity-history');
const { TokenActivityHeatmap } = require('../src/components/stats/TokenActivityHeatmap');
const { HeatmapDailyCalendarGrid } = require('../src/components/stats/HeatmapDailyCalendarGrid');
const { HeatmapDayDetailPopover } = require('../src/components/stats/HeatmapDayDetailPopover');
const { LanguageProvider } = require('../src/i18n/LanguageContext');
const { translations } = require('../src/i18n/translations');

function renderHeatmap(props, lang = 'zh') {
  return renderToStaticMarkup(
    React.createElement(
      LanguageProvider,
      { initialLang: lang },
      React.createElement(TokenActivityHeatmap, props)
    )
  );
}

// ============================================================================
// 1. Service Layer Tests: buildActivityHistory
// ============================================================================
console.log('--- Testing buildActivityHistory ---');

const mockCells = [
  { date: '2026-09-07', month: '2026-09', dayOfWeek: 1, tokens: 100000, tasks: 5, level: 2 },
  { date: '2026-09-08', month: '2026-09', dayOfWeek: 2, tokens: 250000, tasks: 12, level: 4 },
];

const mockDailyStats = {
  '2026-09-07': {
    tokens: 100000,
    tasks: 5,
    inputTokens: 20000,
    cacheReadTokens: 60000,
    outputTokens: 20000,
    thinkingTokens: 15000,
    responseTokens: 5000,
  },
  '2026-09-08': {
    tokens: 250000,
    tasks: 12,
    inputTokens: 50000,
    cacheReadTokens: 150000,
    outputTokens: 50000,
    thinkingTokens: 35000,
    responseTokens: 15000,
  },
};

const history = buildActivityHistory(mockCells, mockDailyStats, new Date(2026, 8, 9));
assert(history.days.length >= 2, 'History should contain days');
const day07 = history.days.find(d => d.date === '2026-09-07');
assert(day07, 'Should find 2026-09-07 in history days');
assert.equal(day07.tokens, 100000, 'Tokens should match');
assert(day07.detail, 'Detail should be populated on cell');
assert.equal(day07.detail.cacheReadTokens, 60000, 'Detail cacheReadTokens should match');
assert.equal(day07.detail.thinkingTokens, 15000, 'Detail thinkingTokens should match');
console.log('PASS: buildActivityHistory populates detail breakdown correctly');

// Edge case: detail on cells without dailyStats
const cellsWithDetail = [
  { date: '2026-09-08', month: '2026-09', dayOfWeek: 2, tokens: 250000, tasks: 12, level: 4, detail: mockDailyStats['2026-09-08'] },
];
const historyWithDirectDetail = buildActivityHistory(cellsWithDetail);
assert(historyWithDirectDetail.days.find(d => d.date === '2026-09-08')?.detail, 'Must retain detail when cells already carry detail');
console.log('PASS: buildActivityHistory retains detail from cells even without dailyStats');

// Edge case: Empty inputs to service
const emptyHistory = buildActivityHistory([], {});
assert.equal(emptyHistory.days.length, 0, 'Days should be empty for no records');
console.log('PASS: buildActivityHistory handles empty inputs gracefully');

// ============================================================================
// 2. Component Rendering: Empty state
// ============================================================================
console.log('--- Testing TokenActivityHeatmap empty state ---');
const emptyHtml = renderHeatmap({ cells: [] });
assert(emptyHtml.includes('py-5') || emptyHtml.includes('text-muted-foreground'), 'Empty state should render');
console.log('PASS: Empty state renders cleanly');

// ============================================================================
// 3. Component Rendering: Active Daily View & "All Tokens" Constraint
// ============================================================================
console.log('--- Testing TokenActivityHeatmap Daily view & metric constraint ---');
const dailyHtmlZh = renderHeatmap({ cells: mockCells, dailyStats: mockDailyStats }, 'zh');

// Must NOT display "统计范畴" row
assert(
  !dailyHtmlZh.includes('统计范畴:'),
  'Must not display "统计范畴" scope strip in Chinese'
);

// Must NOT contain metric mode toggles (user requirement: 不要指标模式)
assert(!dailyHtmlZh.includes('btnMetricThinking'), 'Must not have Thinking metric toggle');
assert(!dailyHtmlZh.includes('btnMetricCache'), 'Must not have Cache metric toggle');
assert(!dailyHtmlZh.includes('btnMetricTasks'), 'Must not have Tasks metric toggle');
assert(!dailyHtmlZh.includes('btnMetricTokens'), 'Must not have metric toggle buttons');
console.log('PASS: Metric mode toggles and scope strip are absent');

// Check Month Headers present and synchronized with cell grid via repeat columns
assert(
  dailyHtmlZh.includes('grid-template-columns:repeat('),
  'Should render aligned month headers and cells with explicit repeat gridTemplateColumns'
);

// Cell height & layout guarantees: Prevent 0px collapsed invisible cells
assert(
  dailyHtmlZh.includes('grid-template-rows:repeat(7, 20px)'),
  'Should have explicit 7-row repeat template rows of 20px'
);
assert(
  dailyHtmlZh.includes('h-[20px]') && dailyHtmlZh.includes('min-h-[20px]'),
  'Cells must have explicit 20px height and min-height to prevent 0-height collapse'
);

// Check that March is NOT omitted from the month headers
assert(
  dailyHtmlZh.includes('3月'),
  'Month headers must include March (3月) when spanning 6 months ending in September'
);

assert(dailyHtmlZh.includes('heat-cell-'), 'Should render daily calendar cells');
assert(!dailyHtmlZh.includes('Weekly usage'), 'Should not render weekly view');
assert(!dailyHtmlZh.includes('cumulAreaGrad'), 'Should not render cumulative view');

// Check English locale
const dailyHtmlEn = renderHeatmap({ cells: mockCells, dailyStats: mockDailyStats }, 'en');
assert(
  !dailyHtmlEn.includes('Scope:'),
  'Must not display Scope strip in English'
);
assert(
  dailyHtmlEn.includes('Mar'),
  'English month headers must include Mar'
);
console.log('PASS: i18n English and month headers render correctly');

// ============================================================================
// 4. Verify Translations Integrity
// ============================================================================
console.log('--- Testing translations for Heatmap keys ---');
const requiredHeatmapKeys = [
  'tokenActivityTitle',
  'activityLevelsTitle',
  'promptChannel',
  'generationChannel',
  'cacheHitSuffix',
  'thinkingShareSuffix',
  'keyboardNavHint',
  'tier0',
  'tier1',
  'tier2',
  'tier3',
  'tier4',
];

for (const lang of ['en', 'zh']) {
  assert(translations[lang], `translations must have ${lang}`);
  for (const key of requiredHeatmapKeys) {
    assert(translations[lang][key], `translations.${lang} missing required key: ${key}`);
  }
}
console.log('PASS: All Heatmap translations exist in both zh and en');

// ============================================================================
// 5. Extracted Subcomponents Isolation Tests
// ============================================================================
console.log('--- Testing Extracted Subcomponents ---');

// 5.1 HeatmapDayDetailPopover
const popoverHtml = renderToStaticMarkup(
  React.createElement(
    LanguageProvider,
    { initialLang: 'zh' },
    React.createElement(HeatmapDayDetailPopover, {
      cell: mockCells[0],
      x: 200,
      y: 300,
      isPinned: true,
      onClose: () => {},
      dailyStat: mockDailyStats['2026-09-07'],
    })
  )
);
assert(popoverHtml.includes('role="tooltip"'), 'Popover must have role tooltip');
assert(popoverHtml.includes('appica-popover'), 'Popover must have appica-popover class');
assert(popoverHtml.includes('Prompt Channel') || popoverHtml.includes('promptChannel'), 'Popover must show prompt channel');
assert(popoverHtml.includes('Generation Channel') || popoverHtml.includes('generationChannel'), 'Popover must show generation channel');
assert(popoverHtml.includes('✕'), 'Pinned popover must render close button');

// Edge case: defensive rate clamping with anomalous data (thinkingTokens > outputTokens)
const anomalousPopoverHtml = renderToStaticMarkup(
  React.createElement(
    LanguageProvider,
    { initialLang: 'zh' },
    React.createElement(HeatmapDayDetailPopover, {
      cell: mockCells[0],
      x: 200,
      y: 300,
      isPinned: false,
      onClose: () => {},
      dailyStat: {
        tokens: 100,
        tasks: 1,
        inputTokens: 10,
        cacheReadTokens: 90,
        outputTokens: 50,
        thinkingTokens: 100, // 100 > 50
        responseTokens: 0,
      },
    })
  )
);
assert(!anomalousPopoverHtml.includes('NaN'), 'Popover must never contain NaN');
assert(!anomalousPopoverHtml.includes('width:-'), 'Popover meters must never have negative width');
console.log('PASS: HeatmapDayDetailPopover renders isolated dual-channel meters & a11y');

// 5.2 HeatmapDailyCalendarGrid
const dailyGridHtml = renderToStaticMarkup(
  React.createElement(
    LanguageProvider,
    { initialLang: 'zh' },
    React.createElement(HeatmapDailyCalendarGrid, {
      calendar: mockCells,
      totalWeeks: 1,
      monthHeaders: [{ col: 0, label: '9月', key: '2026-09-0' }],
      todayKey: '2026-09-08',
      focusDate: '2026-09-08',
      activeCell: null,
      onTriggerPopover: () => {},
      onClearHoverPopover: () => {},
      onSetFocusedDate: () => {},
    })
  )
);
assert(dailyGridHtml.includes('grid-template-rows:repeat(7, 20px)'), 'Daily grid must have 7 rows of 20px');
assert(dailyGridHtml.includes('data-cell-date="2026-09-07"'), 'Daily grid must render cell with data-cell-date');
assert(dailyGridHtml.includes('heat-cell-2'), 'Daily grid must apply level class');
console.log('PASS: HeatmapDailyCalendarGrid renders isolated 7-row grid and cell buttons');

console.log('\nALL Heatmap tests passed successfully!\n');
