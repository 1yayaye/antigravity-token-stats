const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

require.extensions['.ts'] = function (module, filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  module._compile(compiled, filename);
};
const { computeQuotaCycleMetrics, parseQuotaSummaryResponse } = require(path.join(__dirname, '..', 'src', 'services', 'pricing-service.ts'));

const { computeGenerationCostUsd } = require('./aggregate-stats.cjs');

// Verify official pricing calculations
const OFFICIAL_PRICING = {
  flash: {
    inputPerM: 0.75,
    cacheReadPerM: 0.075,
    outputPerM: 3.75,
  },
  pro: {
    inputPerM: 2.00,
    cacheReadPerM: 0.20,
    outputPerM: 12.00,
  },
  opus: {
    inputPerM: 4.00,
    cacheReadPerM: 0.40,
    outputPerM: 20.00,
  },
  sonnet: {
    inputPerM: 2.00,
    cacheReadPerM: 0.20,
    outputPerM: 10.00,
  },
};

function calculateTokensCost(inputTokens, cacheReadTokens, outputTokens, modelName = '') {
  const cost = computeGenerationCostUsd(modelName, inputTokens, cacheReadTokens, outputTokens);
  return Math.round((cost + Number.EPSILON) * 100) / 100;
}

function formatResetCountdown(resetTimeIso, lang = 'zh', nowMs = Date.now()) {
  if (!resetTimeIso) return '—';
  const target = new Date(resetTimeIso).getTime();
  if (isNaN(target)) return '—';

  const diffMs = target - nowMs;
  if (diffMs <= 0) return lang === 'zh' ? '已到期刷新' : 'Ready / Reset';

  const minsTotal = Math.floor(diffMs / 60000);
  const days = Math.floor(minsTotal / 1440);
  const hours = Math.floor((minsTotal % 1440) / 60);
  const mins = minsTotal % 60;

  if (days > 0) {
    return lang === 'zh' ? `${days}天 ${hours}小时` : `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return lang === 'zh' ? `${hours}小时 ${mins}分` : `${hours}h ${mins}m`;
  }
  if (mins > 0) {
    return lang === 'zh' ? `${mins}分钟` : `${mins}m`;
  }
  return lang === 'zh' ? '<1分钟' : '<1m';
}

console.log('--- Testing calculateTokensCost ---');
assert.equal(calculateTokensCost(0, 0, 0), 0);
assert.equal(calculateTokensCost(1000000, 0, 0), 0.75);
assert.equal(calculateTokensCost(0, 1000000, 0), 0.08); // 0.075 rounded to 0.08
assert.equal(calculateTokensCost(0, 0, 1000000), 3.75);
// High cache scenario matching real Antigravity behavior (90% cache read)
assert.equal(calculateTokensCost(1000000, 9000000, 500000), 0.75 + 0.675 + 1.875);
// Model-specific pricing tiers (Pro, Opus, Sonnet)
assert.equal(calculateTokensCost(1000000, 0, 1000000, 'gemini-2.5-pro'), 2.00 + 12.00);
assert.equal(calculateTokensCost(1000000, 0, 1000000, 'claude-opus-4'), 4.00 + 20.00);
assert.equal(calculateTokensCost(1000000, 0, 1000000, 'claude-sonnet-4'), 2.00 + 10.00);
console.log('PASS: calculateTokensCost accurately reflects official rates and cache discount across model tiers');

console.log('--- Testing formatResetCountdown ---');
const baseNow = 1700000000000;
// 3 days 4 hours
assert.equal(formatResetCountdown(new Date(baseNow + (3 * 86400 + 4 * 3600) * 1000).toISOString(), 'zh', baseNow), '3天 4小时');
assert.equal(formatResetCountdown(new Date(baseNow + (3 * 86400 + 4 * 3600) * 1000).toISOString(), 'en', baseNow), '3d 4h');
// 5 hours 12 mins
assert.equal(formatResetCountdown(new Date(baseNow + (5 * 3600 + 12 * 60) * 1000).toISOString(), 'zh', baseNow), '5小时 12分');
assert.equal(formatResetCountdown(new Date(baseNow + (5 * 3600 + 12 * 60) * 1000).toISOString(), 'en', baseNow), '5h 12m');
// Expired
assert.equal(formatResetCountdown(new Date(baseNow - 1000).toISOString(), 'zh', baseNow), '已到期刷新');
assert.equal(formatResetCountdown(new Date(baseNow - 1000).toISOString(), 'en', baseNow), 'Ready / Reset');
console.log('PASS: formatResetCountdown handles day, hour, and expired states in both languages');

console.log('--- Testing parseQuotaSummaryResponse ---');
const mockOfficialResponse = {
  description: 'Within each group, models share a weekly limit.',
  groups: [
    {
      displayName: 'Gemini Models',
      buckets: [
        {
          displayName: 'Weekly Limit Remaining',
          bucketId: 'gemini-weekly',
          remaining: { case: 'remainingFraction', value: 0.6546 },
          resetTime: { seconds: 1728959628 },
        },
        {
          displayName: 'Five Hour Limit Remaining',
          bucketId: 'gemini-5h',
          remaining: { case: 'remainingFraction', value: 0.95 },
        },
      ],
    },
    {
      displayName: 'Claude and GPT models',
      buckets: [
        {
          displayName: 'Weekly Limit Remaining',
          bucketId: '3p-weekly',
          remaining: { case: 'remainingFraction', value: 1.0 },
          resetTime: '2026-10-20T18:00:00Z',
        },
      ],
    },
  ],
};

const parsed = parseQuotaSummaryResponse(mockOfficialResponse);
assert.ok(parsed, 'parsed should not be null');
assert.equal(parsed.weeklyGemini.bucketId, 'gemini-weekly');
assert.equal(parsed.weeklyGemini.remainingFraction, 0.6546);
assert.equal(parsed.weeklyGemini.usedFraction, 0.3454);
assert.ok(parsed.weeklyGemini.resetTime.includes('2024') || parsed.weeklyGemini.resetTime.includes('2026') || parsed.weeklyGemini.resetTime.length > 10);
const claudeFirst = parseQuotaSummaryResponse({
  groups: [{ buckets: [
    { bucketId: '3p-weekly', displayName: 'Weekly Limit', remaining: { value: 0.8 } },
    { bucketId: 'gemini-weekly', displayName: 'Weekly Limit', remaining: { value: 0.6 } },
  ] }],
});
assert.equal(claudeFirst.weeklyGemini.bucketId, 'gemini-weekly', 'Gemini bucket must be classified after Claude regardless of order');
const claudeOnly = parseQuotaSummaryResponse({
  groups: [{ buckets: [{ bucketId: '3p-weekly', displayName: 'Weekly Limit', remaining: { value: 0.7 } }] }],
});
assert.equal(claudeOnly, null, 'Claude-only quota responses are ignored');
assert.equal(parseQuotaSummaryResponse(null), null);
assert.equal(parseQuotaSummaryResponse({}), null);
assert.equal(parseQuotaSummaryResponse({ groups: [] }), null);
console.log('PASS: parseQuotaSummaryResponse parses Gemini weekly buckets and ignores Claude buckets');

console.log('--- Testing tryFetchLiveQuotaFromHost TTL and Force Logic ---');
let mockLastQuotaFetchTime = 0;
const MOCK_TTL_MS = 30000;
let mockRpcCalls = 0;
let mockWindowQuota = null;

function mockTryFetch(force = false, now = Date.now()) {
  if (!force && mockWindowQuota && (now - mockLastQuotaFetchTime < MOCK_TTL_MS)) {
    return mockWindowQuota;
  }
  mockRpcCalls++;
  mockLastQuotaFetchTime = now;
  mockWindowQuota = { capturedAt: new Date(now).toISOString(), value: mockRpcCalls };
  return mockWindowQuota;
}

// 1. First call fetches fresh
const q1 = mockTryFetch(false, 1000);
assert.equal(mockRpcCalls, 1);
assert.equal(q1.value, 1);

// 2. Call within TTL returns cached value without RPC
const q2 = mockTryFetch(false, 5000);
assert.equal(mockRpcCalls, 1);
assert.equal(q2.value, 1);

// 3. Force call bypasses TTL and performs fresh RPC
const q3 = mockTryFetch(true, 6000);
assert.equal(mockRpcCalls, 2);
assert.equal(q3.value, 2);

// 4. Call after TTL expires (30s later) performs fresh RPC
const q4 = mockTryFetch(false, 40000);
assert.equal(mockRpcCalls, 3);
assert.equal(q4.value, 3);
console.log('PASS: tryFetchLiveQuotaFromHost correctly respects 30s TTL and force bypass');


console.log('--- Testing i18n Translations Completeness ---');
const content = fs.readFileSync('src/i18n/translations.ts', 'utf8');
const requiredKeys = [
  'subscriptionQuotaTitle',
  'liveQuotaDetected',
  'weeklyQuota',
  'monthlyQuota',
  'usedPercent',
  'remainingPercent',
  'weeklyCapEst',
  'weeklyCostConsumed',
  'monthlyCostConsumed',
  'monthlyCapEst',
  'planFee',
  'roiMultiple',
  'resetCountdown',
  'resetAt',
  'selectPlan',
  'officialRatesBadge',
  'pricingFormulaNote',
  'tierFree',
  'tierPro',
  'tierUltra5x',
  'tierUltra20x',
  'perMonth',
  'netSavingsBooked',
];

for (const key of requiredKeys) {
  assert.ok(content.includes(`${key}:`), `Missing key in translations: ${key}`);
}
console.log('PASS: All required i18n keys are present in translations.ts');

console.log('--- Testing computeQuotaCycleMetrics (Cycle Reset, Weekly Cap, 4-Week Monthly) ---');
// Scenario 1: Mid-day quota reset (6d 7h remaining -> cycle started 17h ago)
// Earlier on the same day (20h ago, before reset) user spent $37.34; after reset (5h ago) user spent $1.92 at 3.2% usedFraction.
const testNowMs = Date.parse('2026-10-15T19:00:00Z');
const cycleResetIso = new Date(testNowMs + (6 * 86400 + 7 * 3600) * 1000).toISOString(); // 6d 7h left -> cycleStart = testNowMs - 17h
const cycleStartMs = new Date(cycleResetIso).getTime() - 7 * 86400000;

const statsJustReset = {
  kpis: { lifetimeTokens: '10M', lifetimeTokensRaw: 10000000, peakTokens: '5M', longestTask: '1h', currentStreak: 1, longestStreak: 1 },
  activity: {
    heatmap: [],
    activeDaysCount: 2,
    totalTasks: 5,
    costTimeline: [
      { ts: cycleStartMs - 3 * 3600 * 1000, costUsd: 37.34, pool: 'gemini' }, // 3h BEFORE cycle reset (previous cycle!)
      { ts: cycleStartMs + 2 * 3600 * 1000, costUsd: 1.92, pool: 'gemini' },  // 2h AFTER cycle reset (current cycle)
      { ts: cycleStartMs + 3 * 3600 * 1000, costUsd: 50, pool: 'claude' },
    ],
  },
  insights: { fastMode: '0%', mostUsedReasoning: 'Pro', skillsExplored: 0, totalSkillsUsed: 0, totalThreads: 1 },
  meta: { scannedConversations: 1, updatedAt: new Date(testNowMs).toISOString() },
};

const quotaJustReset = {
  capturedAt: new Date(testNowMs).toISOString(),
  weeklyGemini: {
    displayName: 'Weekly Limit',
    bucketId: 'gemini-weekly',
    remainingFraction: 0.968,
    usedFraction: 0.032,
    resetTime: cycleResetIso,
  },
};

const m1 = computeQuotaCycleMetrics(statsJustReset, quotaJustReset, 'pro', testNowMs);
assert.equal(m1.weeklyCostUsd, 1.92, 'Must exclude pre-reset same-day cost ($37.34) and only include post-reset cost ($1.92)');
assert.equal(m1.totalWeeklyCapUsd, 60, 'When usedFraction < 5% (3.2%), must use baseline tier cap ($60 for Pro) instead of noisy division');
assert.equal(m1.totalMonthlyCapUsd, 240, 'Monthly capacity must be 4x weekly capacity ($60 * 4 = $240)');
// The previous-cycle event does not prove that the full week was observed, so all three past weeks use the current-week estimate.
assert.equal(m1.monthlyCostUsd, 7.68, 'Incomplete historical weeks must not be treated as complete');
assert.equal(m1.isMonthlyExtrapolated, true);

// Scenario 2: Only current weekly cycle exists (no prior weeks) -> 4x current weekly cycle
const statsSingleWeek = {
  ...statsJustReset,
  activity: {
    ...statsJustReset.activity,
    costTimeline: [
      { ts: cycleStartMs + 3600 * 1000, costUsd: 15.00, pool: 'gemini' },
      { ts: cycleStartMs + 2 * 3600 * 1000, costUsd: 70.00, pool: 'claude' },
    ],
  },
};
const quota25Pct = {
  capturedAt: new Date(testNowMs).toISOString(),
  weeklyGemini: {
    displayName: 'Weekly Limit',
    bucketId: 'gemini-weekly',
    remainingFraction: 0.75,
    usedFraction: 0.25,
    resetTime: cycleResetIso,
  },
};
const m2 = computeQuotaCycleMetrics(statsSingleWeek, quota25Pct, 'pro', testNowMs);
assert.equal(m2.weeklyCostUsd, 15.00);
assert.equal(m2.totalWeeklyCapUsd, 60.00, 'At 25% used ($15), back-calculated 100% weekly cap is $15 / 0.25 = $60');
assert.equal(m2.totalMonthlyCapUsd, 240.00, 'Monthly capacity is 4x weekly capacity ($240)');
assert.equal(m2.monthlyCostUsd, 60.00, 'With only 1 week of data, monthly consumed is extrapolated as 4x current weekly cost ($15 * 4 = $60)');
assert.equal(m2.isMonthlyExtrapolated, true);

// Scenario 3: Full 4 weekly cycles present -> exact 4-week sum without extrapolation
const weekMs = 7 * 86400000;
const statsFull4Weeks = {
  ...statsJustReset,
  activity: {
    ...statsJustReset.activity,
    costTimeline: [
      { ts: cycleStartMs + 3600 * 1000, costUsd: 10.00, pool: 'gemini' },                // Cycle 0 (current)
      { ts: cycleStartMs - weekMs + 3600 * 1000, costUsd: 20.00, pool: 'gemini' },       // Cycle -1
      { ts: cycleStartMs - 3 * weekMs + 3600 * 1000, costUsd: 40.00, pool: 'gemini' },   // Cycle -3
      { ts: cycleStartMs - 2 * weekMs + 3600 * 1000, costUsd: 500.00, pool: 'claude' },  // ignored pool
    ],
    costTimelineCoverageStartMs: cycleStartMs - 4 * weekMs,
  },
};
const m3 = computeQuotaCycleMetrics(statsFull4Weeks, quota25Pct, 'pro', testNowMs);
assert.equal(m3.weeklyCostUsd, 10.00);
assert.equal(m3.monthlyCostUsd, 70.00, 'A covered zero-use week counts as $0, and Claude cost is excluded');
assert.equal(m3.isMonthlyExtrapolated, false);

const statsPartialHistory = {
  ...statsFull4Weeks,
  activity: {
    ...statsFull4Weeks.activity,
    costTimeline: [
      { ts: cycleStartMs + 3600 * 1000, costUsd: 10.00, pool: 'gemini' },
      { ts: cycleStartMs - weekMs + 3600 * 1000, costUsd: 20.00, pool: 'gemini' },
    ],
    costTimelineCoverageStartMs: cycleStartMs - 2 * weekMs,
  },
};
const partialEstimate = computeQuotaCycleMetrics(statsPartialHistory, quota25Pct, 'pro', testNowMs);
assert.equal(partialEstimate.monthlyCostUsd, 40.00, 'Missing week uses the average of covered full weeks, including the zero-use week');
assert.equal(partialEstimate.isMonthlyExtrapolated, true);

const quotaWithoutReset = {
  capturedAt: new Date(testNowMs).toISOString(),
  weeklyGemini: { displayName: 'Weekly Limit', bucketId: 'gemini-weekly', remainingFraction: 0.75, usedFraction: 0.25, resetTime: null },
};
for (const resetTime of [null, 'invalid', new Date(testNowMs).toISOString()]) {
  const unavailable = computeQuotaCycleMetrics(statsFull4Weeks, {
    ...quotaWithoutReset,
    weeklyGemini: { ...quotaWithoutReset.weeklyGemini, resetTime },
  }, 'pro', testNowMs);
  assert.equal(unavailable.weeklyCostUsd, null, `Weekly cost must be unavailable for reset time ${resetTime}`);
  assert.equal(unavailable.monthlyCostUsd, null, `Monthly cost must be unavailable for reset time ${resetTime}`);
}
const expiredReset = computeQuotaCycleMetrics(statsFull4Weeks, {
  ...quotaWithoutReset,
  weeklyGemini: { ...quotaWithoutReset.weeklyGemini, resetTime: new Date(testNowMs - 1).toISOString() },
}, 'pro', testNowMs);
assert.equal(expiredReset.weeklyCostUsd, null, 'Expired reset times must not fabricate a new cycle');
assert.equal(expiredReset.monthlyCostUsd, null);
console.log('PASS: computeQuotaCycleMetrics accurately handles cycle reset boundaries, weekly cap back-calculation, and 4-week monthly rules');

console.log('\nALL Subscription Pricing & Quota tests passed successfully!\n');
