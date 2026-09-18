const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const filename = path.join(__dirname, '../src/services/stats-service.ts');
const service = new Module(filename, module);
service._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { EMPTY_STATS, filterStatsByRange, toLocalDateKey } = service.exports;
const date = days => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return toLocalDateKey(d);
};
const stats = structuredClone(EMPTY_STATS);
stats.kpis.lifetimeTokensRaw = 300;
stats.kpis.lifetimeTokens = '300';
stats.activity.dailyStats = {};
stats.activity.heatmap = [10, 1, 0].map((days, index) => {
  stats.activity.dailyStats[date(days)] = {
    tokens: 100, tasks: 1, inputTokens: index === 2 ? 0 : 90,
    cacheReadTokens: index === 2 ? 90 : 0, outputTokens: 10,
    thinkingTokens: index === 2 ? 10 : 0, responseTokens: index === 2 ? 0 : 10,
  };
  return { date: date(days), month: 'Sep', dayOfWeek: 0, tokens: 100, tasks: 1, level: 1 };
});

// Main path: range totals and percentages change, historical references stay intact.
const week = filterStatsByRange(stats, '7d');
assert.equal(week.kpis.lifetimeTokensRaw, 200);
assert.equal(week.activity.activeDaysCount, 2);
assert.equal(week.tokenBreakdown.cacheHitRate, '50.0%');
assert.equal(week.tokenBreakdown.reasoningPct, 50);
assert.equal(filterStatsByRange(stats, 'today').tokenBreakdown.reasoningPct, 100);
assert.equal(week.activity.heatmap, stats.activity.heatmap);
assert.equal(week.insights, stats.insights);
console.log('PASS: period totals, exact proportions, independent history');

// Failure path: totals survive missing or partial details without lifetime scaling.
stats.tokenBreakdown = { ...week.tokenBreakdown, totalPromptTokens: 270, outputTokens: 30 };
delete stats.activity.dailyStats[date(0)].cacheReadTokens;
assert.equal(filterStatsByRange(stats, '7d').tokenBreakdown, undefined);
assert.equal(filterStatsByRange(stats, 'today').kpis.lifetimeTokensRaw, 100);
delete stats.activity.dailyStats;
assert.equal(filterStatsByRange(stats, '30d').tokenBreakdown, undefined);
delete stats.tokenBreakdown;
assert.equal(filterStatsByRange(stats, 'all').tokenBreakdown, undefined);
console.log('PASS: incomplete details remain unavailable');
