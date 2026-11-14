const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const Module = require('node:module');

// 1. Hook .ts and .tsx loaders for Node
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

const { QuotaHeroCard } = require('../src/components/stats/QuotaHeroCard');
const { LanguageProvider } = require('../src/i18n/LanguageContext');
const { EMPTY_STATS } = require('../src/services/stats-service');
const contract = require('../src/injection-contract.cjs');

console.log('=== Testing QuotaHeroCard Morph 1 (Dual Radial Rings) ===\n');

function renderCard(stats, mockWindowQuota, savedTier = null) {
  global.window = new EventTarget();
  global.localStorage = { getItem: () => savedTier, setItem: () => {}, removeItem: () => {} };
  if (mockWindowQuota !== undefined) {
    global.window[contract.WINDOW_LIVE_QUOTA] = mockWindowQuota;
  }
  try {
    return renderToStaticMarkup(
      React.createElement(
        LanguageProvider,
        null,
        React.createElement(QuotaHeroCard, { stats })
      )
    );
  } finally {
    delete global.window;
    delete global.localStorage;
  }
}

// 1. Test: Null live quota returns empty markup
const nullHtml = renderCard(EMPTY_STATS, null);
assert.equal(nullHtml, '', 'When live quota is null, QuotaHeroCard must render empty null');
console.log('PASS: Null live quota safely renders null');

// 2. Test: 0% quota usage (fresh billing cycle)
const zeroUsageLiveQuota = {
  capturedAt: '2026-11-13T10:00:00Z',
  weeklyGemini: {
    displayName: 'Weekly Limit',
    bucketId: 'gemini-weekly',
    remainingFraction: 1.0,
    usedFraction: 0.0,
    resetTime: '2026-11-20T00:00:00Z',
  },
};
const zeroHtml = renderCard(EMPTY_STATS, zeroUsageLiveQuota);
assert(zeroHtml.includes('0%'), '0% weekly usage must render "0%"');
assert(zeroHtml.includes('view-dual-rings'), 'Must render view-dual-rings container');
assert(zeroHtml.includes('ring-vertical-divider'), 'Must render 1px subtle vertical divider');
assert(zeroHtml.includes('id="ringWeekUsed">$0.00</strong>'), '0% usage must render $0.00 used');
assert(zeroHtml.includes('id="ringWeekCap">~</span>'), '0% usage must render ~ instead of a default weekly cap');
assert(zeroHtml.includes('id="ringMonthCap">~</span>'), '0% usage with no caps must render ~ instead of a default monthly cap');
assert(!zeroHtml.includes('$60.00'), '0% usage must NOT render hardcoded $60.00 baseline cap');
// Must use stroke-linecap="butt" when dash is 0 to avoid false dot artifact on empty ring
assert(zeroHtml.includes('stroke-linecap="butt"'), '0% ring must use butt linecap to eliminate false dot artifact');
console.log('PASS: 0% usage renders empty ring with no dot artifact and ~ cap placeholder');

// 3. Test: Normal usage (68% weekly, monthly extrapolated)
const baseNow = Date.parse('2026-11-13T10:00:00Z');
const cycleReset = new Date(baseNow + 4 * 86400000).toISOString();
const cycleStart = new Date(cycleReset).getTime() - 7 * 86400000;

const normalStats = {
  ...EMPTY_STATS,
  kpis: { lifetimeTokens: '10M', lifetimeTokensRaw: 10000000 },
  activity: {
    ...EMPTY_STATS.activity,
    costTimeline: [
      { ts: cycleStart + 3600000, costUsd: 40.80, pool: 'gemini' },
    ],
  },
};

const normalLiveQuota = {
  capturedAt: new Date(baseNow).toISOString(),
  weeklyGemini: {
    displayName: 'Weekly Limit',
    bucketId: 'gemini-weekly',
    remainingFraction: 0.32,
    usedFraction: 0.68,
    resetTime: cycleReset,
  },
};

const normalHtml = renderCard(normalStats, normalLiveQuota);
// Check SVG geometry: 60px, r=26.5, strokeWidth=4.5
assert(normalHtml.includes('width="60"'), 'Must have width 60');
assert(normalHtml.includes('height="60"'), 'Must have height 60');
assert(normalHtml.includes('r="26.5"'), 'Must have circle radius 26.5');
assert(normalHtml.includes('stroke-width="4.5"'), 'Must have strokeWidth 4.5');

// Check titles
assert(normalHtml.includes('本周配额已用'), 'Must render title: 本周配额已用');
assert(normalHtml.includes('4周折算总容量'), 'Must render title: 4周折算总容量');

// Check weekly values
assert(normalHtml.includes('68%'), 'Must render 68% weekly percentage');
assert(normalHtml.includes('$40.80'), 'Must render $40.80 used');
assert(normalHtml.includes('~$60.00'), 'Must render ~$60.00 weekly cap');

// Check monthly values & ROI badge
assert(normalHtml.includes('ROI'), 'Must render ROI badge');
assert(normalHtml.includes('id="ringRoiBadge"'), 'Must render ringRoiBadge element');

// Check tier select & live pulse
assert(normalHtml.includes('id="quota-tier-select"'), 'Must render quota-tier-select');
assert(normalHtml.includes('animate-pulse'), 'Must render live quota pulse dot');

// Check pruned redundant texts:
assert(!normalHtml.includes('价值成效'), 'Must NOT contain pruned "价值成效" savings line');
assert(!normalHtml.includes('💰'), 'Must NOT contain pruned money bag emoji');
assert(!normalHtml.includes('重置'), 'Must NOT contain pruned reset countdown');
assert(!normalHtml.includes('Resets in'), 'Must NOT contain English reset countdown');

console.log('PASS: Normal usage renders dual 62px rings, titles, badges, and prunes redundant texts');

// 4. Test: Missing / Null monthly cost
const missingMonthlyLiveQuota = {
  capturedAt: new Date(baseNow).toISOString(),
  weeklyGemini: {
    displayName: 'Weekly Limit',
    bucketId: 'gemini-weekly',
    remainingFraction: 0.5,
    usedFraction: 0.5,
    resetTime: null, // invalid reset time makes monthlyCostUsd null
  },
};
const nullMonthlyHtml = renderCard(normalStats, missingMonthlyLiveQuota);
// Monthly ring inner text should NOT claim 0% when unknown
assert(nullMonthlyHtml.includes('<span class="ring-inner-num tabular-nums">—</span>'), 'Monthly ring inner text must display dash when cost is null');
assert(!nullMonthlyHtml.includes('4周容量 0%'), 'Monthly ring aria-label must not claim 0% when cost is null');
assert(!nullMonthlyHtml.includes('— ROI'), 'ROI badge must NOT render ugly "— ROI" string when null');
assert(nullMonthlyHtml.includes('id="ringRoiBadge">—</span>'), 'ROI badge must render clean "—" when null');
assert(nullMonthlyHtml.includes('id="ringWeekCap">~</span>'), 'Weekly cap must render "~" when reset time is invalid');
assert(nullMonthlyHtml.includes('id="ringMonthCap">~</span>'), 'Monthly cap must render "~" when reset time is invalid');
console.log('PASS: Null monthly cost displays dash ("—") instead of false 0% or "— ROI"');

// 5. Test: Multi-pool rendering (Gemini + Claude & GPT + Gemini 4 Argon)
const multiPoolStats = {
  ...EMPTY_STATS,
  kpis: { lifetimeTokens: '15M', lifetimeTokensRaw: 15000000 },
  activity: {
    ...EMPTY_STATS.activity,
    costTimeline: [
      { ts: cycleStart + 3600000, costUsd: 15.00, pool: 'gemini' },
      { ts: cycleStart + 7200000, costUsd: 12.00, pool: 'claude' },
      { ts: cycleStart + 10800000, costUsd: 5.00, pool: 'argon' },
    ],
  },
};
const multiPoolLiveQuota = {
  capturedAt: new Date(baseNow).toISOString(),
  weeklyGemini: {
    displayName: 'Weekly Limit Remaining',
    bucketId: 'gemini-weekly',
    remainingFraction: 0.75,
    usedFraction: 0.25,
    resetTime: cycleReset,
  },
  weeklyClaude: {
    displayName: 'Weekly Limit Remaining',
    bucketId: '3p-weekly',
    remainingFraction: 0.70,
    usedFraction: 0.30,
    resetTime: cycleReset,
  },
  weeklyArgon: {
    displayName: 'Gemini 4 Argon Weekly Limit',
    bucketId: 'gemini-argon-wtu-weekly',
    remainingFraction: 0.80,
    usedFraction: 0.20,
    resetTime: cycleReset,
  },
};
const multiHtml = renderCard(multiPoolStats, multiPoolLiveQuota);
assert(multiHtml.includes('Gemini 系列'), 'Must render Gemini weekly ring title');
assert(multiHtml.includes('Claude &amp; GPT'), 'Must render Claude & GPT weekly ring title');
assert(multiHtml.includes('Gemini 4 Argon'), 'Must render Gemini 4 Argon weekly ring title');
assert(multiHtml.includes('25%'), 'Must render Gemini 25% used');
assert(multiHtml.includes('30%'), 'Must render Claude & GPT 30% used');
assert(multiHtml.includes('20%'), 'Must render Argon 20% used');
assert(multiHtml.includes('id="ringClaudeWeekUsed">$12.00</strong>'), 'Must render Claude weekly cost');
assert(multiHtml.includes('id="ringArgonWeekUsed">$5.00</strong>'), 'Must render Argon weekly cost');
assert(multiHtml.includes('id="ringMonthCap">~$500.00</span>'), 'Must render combined 4-week monthly cap');
console.log('PASS: Multi-pool usage renders Gemini, Claude & GPT, Argon weekly rings alongside 4-week capacity');

// 6. Test: Ultra 5x merges Argon into Gemini and does NOT render a separate Argon ring
const ultraHtml = renderCard(multiPoolStats, multiPoolLiveQuota, 'ultra_5x');
assert(ultraHtml.includes('Gemini 系列'), 'Ultra must render Gemini weekly ring');
assert(ultraHtml.includes('Claude &amp; GPT'), 'Ultra must render Claude & GPT weekly ring');
assert(!ultraHtml.includes('Gemini 4 Argon'), 'Ultra must NOT render separate Gemini 4 Argon weekly ring');
assert(!ultraHtml.includes('id="ringArgonWeekUsed"'), 'Ultra must NOT render ringArgonWeekUsed');
assert(ultraHtml.includes('id="ringWeekUsed">$20.00</strong>'), 'Ultra Gemini ring must include merged Argon cost ($15 + $5)');
assert(ultraHtml.includes('id="ringClaudeWeekUsed">$12.00</strong>'), 'Ultra must render Claude weekly cost');
console.log('PASS: Ultra tier merges Argon costs into Gemini and hides separate Argon ring');

// 7. Test: Auto-detected Ultra account tier switches automatically even when savedTier was 'pro'
const autoDetectedUltraQuota = {
  ...multiPoolLiveQuota,
  detectedAccountTier: {
    tier: 'ultra_5x',
    isUltraAmbiguous: true,
    rawTierId: 'g1-ultra-tier',
    rawTierName: 'Google AI Ultra',
    accountKey: 'abcd1234',
  },
};
const autoUltraHtml = renderCard(multiPoolStats, autoDetectedUltraQuota, 'pro');
assert(autoUltraHtml.includes('id="quota-tier-auto-badge"'), 'Auto-detected tier must render auto badge');
assert(!autoUltraHtml.includes('id="ringArgonWeekUsed"'), 'Auto-detected Ultra must switch to Ultra and merge Argon');
assert(!autoUltraHtml.includes('重置'), 'Auto-badge must not introduce forbidden "重置" text');
console.log('PASS: Auto-detected account tier switches immediately and renders auto badge');

// 8. Test: Unused Claude & GPT pool renders "$0.00 / ~" with no default $40.00 cap, while active pools sum normally
const claudeUnusedQuota = {
  ...multiPoolLiveQuota,
  weeklyClaude: {
    displayName: 'Weekly Limit Remaining',
    bucketId: '3p-weekly',
    remainingFraction: 1.0,
    usedFraction: 0,
    resetTime: cycleReset,
  },
};
const claudeUnusedHtml = renderCard(multiPoolStats, claudeUnusedQuota);
assert(claudeUnusedHtml.includes('Claude &amp; GPT'), 'Unused Claude & GPT ring must remain visible');
assert(claudeUnusedHtml.includes('id="ringClaudeWeekUsed">$0.00</strong>'), 'Unused Claude & GPT must render $0.00 used');
assert(claudeUnusedHtml.includes('id="ringClaudeWeekCap">~</span>'), 'Unused Claude & GPT must render "~" instead of default cap');
assert(!claudeUnusedHtml.includes('$40.00'), 'Unused Claude & GPT must NOT render hardcoded $40.00 cap');
assert(claudeUnusedHtml.includes('id="ringMonthCap">~$340.00</span>'), '4-week cap must sum only active Gemini ($240) + Argon ($100) caps');
console.log('PASS: Unused pool renders "$0.00 / ~" without hypothetical cap and is excluded from monthly cap sum');

console.log('\nALL QuotaHeroCard Morph 1 tests passed successfully!\n');
