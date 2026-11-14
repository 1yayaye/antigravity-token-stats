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
const {
  computeQuotaCycleMetrics,
  parseQuotaSummaryResponse,
  resolveSubscriptionTierFromSignals,
  hashAccountKey,
} = require(path.join(__dirname, '..', 'src', 'services', 'pricing-service.ts'));
const {
  resolveEffectiveTier,
  buildTierScopeKey,
} = require(path.join(__dirname, '..', 'src', 'components', 'stats', 'useQuotaMetrics.ts'));

const { computeGenerationCostUsd, classifyQuotaPool, resolveOfficialModelId } = require('./aggregate-stats.cjs');

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

console.log('--- Testing calculateTokensCost & resolveOfficialModelId ---');
// Empty or legacy/unlisted models bill $0
assert.equal(calculateTokensCost(0, 0, 0), 0);
assert.equal(calculateTokensCost(1000000, 1000000, 1000000), 0);
assert.equal(calculateTokensCost(1000000, 0, 1000000, 'gemini-2.5-pro'), 0);
assert.equal(calculateTokensCost(1000000, 0, 1000000, 'gemini-3-pro'), 0);
assert.equal(calculateTokensCost(1000000, 0, 1000000, 'gemini-flash'), 0);
assert.equal(calculateTokensCost(1000000, 0, 1000000, 'claude-opus-4'), 0);
assert.equal(calculateTokensCost(1000000, 0, 1000000, 'claude-sonnet-4'), 0);
assert.equal(calculateTokensCost(1000000, 0, 1000000, 'claude-3-5-sonnet'), 0);
assert.equal(resolveOfficialModelId('gemini-2.5-pro'), null);
assert.equal(resolveOfficialModelId('prompt-3.1'), null);
assert.equal(resolveOfficialModelId('proxy-3.1-test'), null);
assert.equal(resolveOfficialModelId('gemini-3.10-pro'), null);
assert.equal(resolveOfficialModelId('gemini-2.5-flash'), null);
assert.equal(resolveOfficialModelId('gemini-3-flash'), null);
assert.equal(resolveOfficialModelId('gemini-4-pro'), null);
assert.equal(resolveOfficialModelId('claude-opus-4-5'), null);
assert.equal(resolveOfficialModelId('claude-sonnet-4-5'), null);
assert.equal(computeGenerationCostUsd('prompt-3.1', 1000000, 1000000, 1000000), 0);

// Gemini 3.8 / 3.7 / 3.6 Flash: $0.75 / $0.075 / $3.75
assert.equal(calculateTokensCost(1000000, 0, 0, 'gemini-3.8-flash'), 0.75);
assert.equal(calculateTokensCost(0, 1000000, 0, 'gemini-3.8-flash-n'), 0.08); // 0.075 rounded to 0.08
assert.equal(calculateTokensCost(0, 0, 1000000, 'gemini-3.7-flash-preview'), 3.75);
assert.equal(calculateTokensCost(1000000, 9000000, 500000, 'gemini-3_6_flash-exp-a'), 0.75 + 0.675 + 1.875);
assert.equal(resolveOfficialModelId('GEMINI-3-8-FLASH-TIERED'), 'gemini-3.8-flash');
assert.equal(resolveOfficialModelId('gemini-3.8-flash-r'), 'gemini-3.8-flash');

// Gemini 4 Carbon: $2.00 / $0.10 / $10.00 (pool: gemini)
assert.equal(computeGenerationCostUsd('gemini-4-carbon', 1000000, 1000000, 1000000), 2.00 + 0.10 + 10.00);
assert.equal(resolveOfficialModelId('gemini-4-carbon-customtools'), 'gemini-4-carbon');
assert.equal(resolveOfficialModelId('orchestrator-carbon'), 'gemini-4-carbon');
assert.equal(classifyQuotaPool('gemini-4-carbon'), 'gemini');

// Gemini 4 Argon & Orchestrator: $2.00 / $0.10 / $10.00 (base pool: argon)
assert.equal(computeGenerationCostUsd('gemini-4-argon-high', 1000000, 1000000, 1000000), 2.00 + 0.10 + 10.00);
assert.equal(computeGenerationCostUsd('gemini-pro-orchestrator-g1-pro', 1000000, 1000000, 1000000), 2.00 + 0.10 + 10.00);
assert.equal(resolveOfficialModelId('orchestrator-argon'), 'gemini-4-argon');
assert.equal(classifyQuotaPool('gemini-pro-orchestrator-g1-pro'), 'argon');
assert.equal(classifyQuotaPool('gemini-4-argon-high'), 'argon');

// Gemini 4 Hydrogen & Worker & gemini-4-(low|medium|high|xhigh): $1.50 / $0.075 / $7.50 (pool: gemini)
assert.equal(computeGenerationCostUsd('gemini-4-hydrogen-high', 1000000, 1000000, 1000000), 1.50 + 0.075 + 7.50);
assert.equal(computeGenerationCostUsd('gemini-flash-worker-agy', 1000000, 1000000, 1000000), 1.50 + 0.075 + 7.50);
assert.equal(computeGenerationCostUsd('gemini-4-high', 1000000, 1000000, 1000000), 1.50 + 0.075 + 7.50);
for (const variant of ['gemini-4-low', 'gemini-4-medium', 'gemini-4-high', 'gemini-4-xhigh', 'gemini-4-high-thinking', 'gemini-3.8-flash-worker', 'orchestrator-worker']) {
  assert.equal(resolveOfficialModelId(variant), 'gemini-4-hydrogen', `Expected ${variant} to resolve to gemini-4-hydrogen`);
  assert.equal(classifyQuotaPool(variant), 'gemini');
}

// Gemini 3.1 Pro: tiered at per-request inputTokens + cacheReadTokens > 200_000
assert.equal(resolveOfficialModelId('gemini-3-1-pro-preview'), 'gemini-3.1-pro');
assert.equal(resolveOfficialModelId('gemini_3_1_pro_customtools'), 'gemini-3.1-pro');
// Boundary: <= 200_000 ($2.00 / $0.20 / $12.00)
assert.equal(
  computeGenerationCostUsd('gemini-3.1-pro', 100_000, 100_000, 100_000),
  (100_000 / 1e6) * 2.00 + (100_000 / 1e6) * 0.20 + (100_000 / 1e6) * 12.00
);
assert.equal(
  computeGenerationCostUsd('gemini-3.1-pro', 200_000, 0, 100_000),
  (200_000 / 1e6) * 2.00 + (100_000 / 1e6) * 12.00
);
// Boundary: > 200_000 ($4.00 / $0.40 / $18.00)
assert.equal(
  computeGenerationCostUsd('gemini-3.1-pro', 100_001, 100_000, 100_000),
  (100_001 / 1e6) * 4.00 + (100_000 / 1e6) * 0.40 + (100_000 / 1e6) * 18.00
);
assert.equal(
  computeGenerationCostUsd('gemini-3.1-pro', 0, 200_001, 100_000),
  (200_001 / 1e6) * 0.40 + (100_000 / 1e6) * 18.00
);
assert.equal(classifyQuotaPool('gemini-3.1-pro'), 'gemini');

// Claude 5.5 & 4.6
assert.equal(computeGenerationCostUsd('claude-opus-5-5', 1000000, 1000000, 1000000), 4.00 + 0.20 + 20.00);
assert.equal(computeGenerationCostUsd('claude-sonnet-5.5-thinking', 1000000, 1000000, 1000000), 2.00 + 0.10 + 10.00);
assert.equal(computeGenerationCostUsd('claude-opus-4-6-thinking', 1000000, 1000000, 1000000), 5.00 + 0.50 + 25.00);
assert.equal(computeGenerationCostUsd('claude_sonnet_4_6_fast', 1000000, 1000000, 1000000), 3.00 + 0.30 + 15.00);
assert.equal(resolveOfficialModelId('claude-opus-4.6-customtools'), 'claude-opus-4-6');
assert.equal(classifyQuotaPool('claude-opus-5-5'), 'claude');
assert.equal(classifyQuotaPool('claude-sonnet-5-5'), 'claude');
assert.equal(classifyQuotaPool('claude-opus-4-6-thinking'), 'claude');
assert.equal(classifyQuotaPool('claude-sonnet-4-6'), 'claude');

// GPT-OSS 120B: $0 / $0 / $0 (pool: claude)
assert.equal(computeGenerationCostUsd('gpt-oss-120b-medium', 1000000, 1000000, 1000000), 0);
assert.equal(resolveOfficialModelId('gpt-oss-120b-medium'), 'gpt-oss-120b');
assert.equal(resolveOfficialModelId('gpt'), 'gpt-oss-120b');
assert.equal(classifyQuotaPool('gpt-oss-120b-medium'), 'claude');
console.log('PASS: calculateTokensCost, resolveOfficialModelId, and classifyQuotaPool handle all official & legacy models');

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
// Shape matches the real 200 response from retrieveUserQuotaSummary:
// remainingFraction is a flat number field, not a remaining{value} oneof wrapper.
const mockOfficialResponse = {
  description: 'Within each group, models share a weekly limit.',
  groups: [
    {
      displayName: 'Gemini Models',
      buckets: [
        {
          displayName: 'Weekly Limit Remaining',
          bucketId: 'gemini-weekly',
          remainingFraction: 0.6546,
          resetTime: '2026-10-31T12:12:20Z',
        },
        {
          displayName: 'Five Hour Limit Remaining',
          bucketId: 'gemini-5h',
          remainingFraction: 0.95,
        },
      ],
    },
    {
      displayName: 'Claude and GPT models',
      buckets: [
        {
          displayName: 'Weekly Limit Remaining',
          bucketId: '3p-weekly',
          remainingFraction: 1.0,
        },
      ],
    },
  ],
};

const parsed = parseQuotaSummaryResponse(mockOfficialResponse);
assert.ok(parsed, 'parsed should not be null');
assert.equal(parsed.weeklyGemini.bucketId, 'gemini-weekly');
assert.equal(parsed.weeklyGemini.remainingFraction, 0.6546, 'flat remainingFraction number must be read directly');
assert.equal(parsed.weeklyGemini.usedFraction, 0.3454);
assert.equal(parsed.weeklyGemini.resetTime, '2026-10-31T12:12:20Z', 'string resetTime must pass through unchanged');
assert.equal(parsed.weeklyClaude.bucketId, '3p-weekly');
assert.equal(parsed.weeklyClaude.remainingFraction, 1.0);

// Legacy captures wrapped the fraction in a remainingAmount string.
const amountFallback = parseQuotaSummaryResponse({
  groups: [{ buckets: [{ bucketId: 'gemini-weekly', displayName: 'Weekly Limit', remainingAmount: '0.42' }] }],
});
assert.equal(amountFallback.weeklyGemini.remainingFraction, 0.42, 'remainingAmount string is the fallback source');

// A bucket with neither field means "no usage recorded" -> fully remaining.
const missingFraction = parseQuotaSummaryResponse({
  groups: [{ buckets: [{ bucketId: 'gemini-weekly', displayName: 'Weekly Limit' }] }],
});
assert.equal(missingFraction.weeklyGemini.remainingFraction, 1, 'absent fraction defaults to fully remaining');

// Current schema (client update): the fraction moved into the protobuf oneof
// wrapper `remaining: { case, value }`; resetTime became a protobuf Timestamp.
// Shape captured verbatim from the live retrieveUserQuotaSummary response.
const oneofResponse = parseQuotaSummaryResponse({
  groups: [
    {
      displayName: 'Gemini Models',
      buckets: [
        {
          bucketId: 'gemini-weekly',
          displayName: 'Weekly Limit Remaining',
          window: 'weekly',
          remaining: { case: 'remainingFraction', value: 0.17833418 },
          resetTime: { seconds: '1793448740', nanos: 0 },
        },
        {
          bucketId: 'gemini-5h',
          displayName: 'Five Hour Limit Remaining',
          window: '5h',
          remaining: { case: 'remainingFraction', value: 0.91937995 },
        },
      ],
    },
    {
      displayName: 'Claude and GPT models',
      buckets: [
        {
          bucketId: '3p-weekly',
          displayName: 'Weekly Limit Remaining',
          window: 'weekly',
          remaining: { case: 'remainingFraction', value: 0.72 },
          resetTime: { seconds: '1793448740', nanos: 0 },
        },
        {
          bucketId: '3p-5h',
          displayName: 'Five Hour Limit Remaining',
          window: '5h',
          remaining: { case: 'remainingFraction', value: 0.9 },
        },
      ],
    },
    {
      displayName: 'Gemini 4 Argon',
      buckets: [
        {
          bucketId: 'gemini-argon-wtu-weekly',
          displayName: 'Gemini 4 Argon Weekly Limit',
          window: 'weekly',
          remaining: { case: 'remainingFraction', value: 0.9786671 },
          resetTime: { seconds: '1793448600', nanos: 0 },
        },
      ],
    },
  ],
});
assert.ok(oneofResponse, 'oneof-shaped response must produce a summary');
assert.equal(oneofResponse.weeklyGemini.bucketId, 'gemini-weekly', 'oneof shape must classify the gemini weekly bucket');
assert.equal(oneofResponse.weeklyGemini.remainingFraction, 0.17833418, 'oneof remaining.value must be read as the fraction');
assert.equal(oneofResponse.weeklyGemini.usedFraction, 0.8217, 'oneof shape must derive usedFraction from remaining.value');
assert.equal(oneofResponse.weeklyGemini.resetTime, new Date(1793448740 * 1000).toISOString(), 'protobuf Timestamp resetTime must convert to ISO');
assert.equal(oneofResponse.weeklyClaude.bucketId, '3p-weekly', 'must extract Claude & GPT weekly bucket');
assert.equal(oneofResponse.weeklyClaude.remainingFraction, 0.72);
assert.equal(oneofResponse.weeklyClaude.usedFraction, 0.28);
assert.equal(oneofResponse.weeklyArgon.bucketId, 'gemini-argon-wtu-weekly', 'must extract Gemini 4 Argon weekly bucket without overwriting Gemini');
assert.equal(oneofResponse.weeklyArgon.remainingFraction, 0.9786671);
assert.equal(oneofResponse.weeklyArgon.usedFraction, 0.0213);
assert.equal(oneofResponse.weeklyArgon.resetTime, new Date(1793448600 * 1000).toISOString());

// Deployment variants put buckets directly on the response top level.
const topLevelBuckets = parseQuotaSummaryResponse({
  description: 'top-level bucket layout',
  groups: [{ displayName: 'Gemini Models' }],
  buckets: [{ bucketId: 'gemini-weekly', displayName: 'Weekly Limit Remaining', remainingFraction: 0.866898 }],
});
assert.ok(topLevelBuckets, 'top-level buckets fallback must produce a summary');
assert.equal(topLevelBuckets.weeklyGemini.bucketId, 'gemini-weekly');
assert.equal(topLevelBuckets.weeklyGemini.remainingFraction, 0.866898);

const claudeFirst = parseQuotaSummaryResponse({
  groups: [{ buckets: [
    { bucketId: '3p-weekly', displayName: 'Weekly Limit', remainingFraction: 0.8 },
    { bucketId: 'gemini-argon-wtu-weekly', displayName: 'Gemini 4 Argon Weekly Limit', remainingFraction: 0.95 },
    { bucketId: 'gemini-weekly', displayName: 'Weekly Limit', remainingFraction: 0.6 },
  ] }],
});
assert.equal(claudeFirst.weeklyGemini.bucketId, 'gemini-weekly', 'Gemini bucket must be classified separately from Claude and Argon regardless of order');
assert.equal(claudeFirst.weeklyClaude.bucketId, '3p-weekly');
assert.equal(claudeFirst.weeklyArgon.bucketId, 'gemini-argon-wtu-weekly');
const claudeOnly = parseQuotaSummaryResponse({
  groups: [{ buckets: [{ bucketId: '3p-weekly', displayName: 'Weekly Limit', remainingFraction: 0.7 }] }],
});
assert.ok(claudeOnly, 'Claude-only quota responses must be parsed');
assert.equal(claudeOnly.weeklyGemini, undefined);
assert.equal(claudeOnly.weeklyClaude.remainingFraction, 0.7);
assert.equal(parseQuotaSummaryResponse(null), null);
assert.equal(parseQuotaSummaryResponse({}), null);
assert.equal(parseQuotaSummaryResponse({ groups: [] }), null);
console.log('PASS: parseQuotaSummaryResponse parses Gemini, Claude/GPT, and Argon weekly buckets cleanly');

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
  kpis: { lifetimeTokens: '10M', lifetimeTokensRaw: 10000000 },
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
assert.equal(m1.totalWeeklyCapUsd, 60, 'Without 5% threshold, even 3.2% used back-calculates weekly cap ($1.92 / 0.032 = $60)');
assert.equal(m1.totalMonthlyCapUsd, 240, 'Monthly capacity must be 4x weekly capacity ($60 * 4 = $240)');
// The previous-cycle event does not prove that the full week was observed, so all three past weeks use the current-week estimate.
assert.equal(m1.monthlyCostUsd, 7.68, 'Incomplete historical weeks must not be treated as complete');
assert.equal(m1.isMonthlyExtrapolated, true);

// Scenario 1b: 0% usage or $0 weekly cost must NOT fabricate a default baseline cap
const quotaZeroUsage = {
  capturedAt: new Date(testNowMs).toISOString(),
  weeklyGemini: {
    displayName: 'Weekly Limit',
    bucketId: 'gemini-weekly',
    remainingFraction: 1,
    usedFraction: 0,
    resetTime: cycleResetIso,
  },
};
const mZero = computeQuotaCycleMetrics(statsJustReset, quotaZeroUsage, 'pro', testNowMs);
assert.equal(mZero.weeklyCostUsd, 0);
assert.equal(mZero.totalWeeklyCapUsd, null, '0% usage must not fabricate a default weekly cap');
assert.equal(mZero.totalMonthlyCapUsd, null, '0% usage must not fabricate a default monthly cap');

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
  assert.equal(unavailable.totalWeeklyCapUsd, null, `Weekly cap must be null for reset time ${resetTime}`);
  assert.equal(unavailable.totalMonthlyCapUsd, null, `Monthly cap must be null for reset time ${resetTime}`);
}
const expiredReset = computeQuotaCycleMetrics(statsFull4Weeks, {
  ...quotaWithoutReset,
  weeklyGemini: { ...quotaWithoutReset.weeklyGemini, resetTime: new Date(testNowMs - 1).toISOString() },
}, 'pro', testNowMs);
assert.equal(expiredReset.weeklyCostUsd, null, 'Expired reset times must not fabricate a new cycle');
assert.equal(expiredReset.monthlyCostUsd, null);
assert.equal(expiredReset.totalWeeklyCapUsd, null);
assert.equal(expiredReset.totalMonthlyCapUsd, null);

// Scenario 4: Multi-pool weekly & monthly quota calculation (Gemini + Claude & GPT + Argon)
const multiPoolStats = {
  ...statsJustReset,
  activity: {
    ...statsJustReset.activity,
    costTimeline: [
      { ts: cycleStartMs + 3600 * 1000, costUsd: 15.00, pool: 'gemini' },
      { ts: cycleStartMs + 2 * 3600 * 1000, costUsd: 12.00, pool: 'claude' },
      { ts: cycleStartMs + 3 * 3600 * 1000, costUsd: 5.00, pool: 'argon' },
    ],
  },
};
const multiPoolQuota = {
  capturedAt: new Date(testNowMs).toISOString(),
  weeklyGemini: { displayName: 'Weekly Limit Remaining', bucketId: 'gemini-weekly', remainingFraction: 0.75, usedFraction: 0.25, resetTime: cycleResetIso },
  weeklyClaude: { displayName: 'Weekly Limit Remaining', bucketId: '3p-weekly', remainingFraction: 0.70, usedFraction: 0.30, resetTime: cycleResetIso },
  weeklyArgon: { displayName: 'Gemini 4 Argon Weekly Limit', bucketId: 'gemini-argon-wtu-weekly', remainingFraction: 0.80, usedFraction: 0.20, resetTime: cycleResetIso },
};
const multi = computeQuotaCycleMetrics(multiPoolStats, multiPoolQuota, 'pro', testNowMs);
assert.equal(multi.pools.gemini.weeklyCostUsd, 15.00);
assert.equal(multi.pools.gemini.totalWeeklyCapUsd, 60.00);
assert.equal(multi.pools.claude.weeklyCostUsd, 12.00);
assert.equal(multi.pools.claude.totalWeeklyCapUsd, 40.00);
assert.equal(multi.pools.argon.weeklyCostUsd, 5.00);
assert.equal(multi.pools.argon.totalWeeklyCapUsd, 25.00);
assert.equal(multi.monthlyCostUsd, (15 + 12 + 5) * 4, 'Multi-pool 4-week cost sums all captured pools');
assert.equal(multi.totalMonthlyCapUsd, (60 + 40 + 25) * 4, 'Multi-pool 4-week cap sums all captured pools');

// Scenario 4b: Unused pool (e.g. Claude & GPT at 0% / $0) has null cap and does not inflate totalMonthlyCapUsd
const quotaClaudeUnused = {
  ...multiPoolQuota,
  weeklyClaude: { displayName: 'Weekly Limit Remaining', bucketId: '3p-weekly', remainingFraction: 1.0, usedFraction: 0, resetTime: cycleResetIso },
};
const multiClaudeUnused = computeQuotaCycleMetrics(multiPoolStats, quotaClaudeUnused, 'pro', testNowMs);
assert.equal(multiClaudeUnused.pools.claude.weeklyCostUsd, 0);
assert.equal(multiClaudeUnused.pools.claude.totalWeeklyCapUsd, null, 'Unused Claude pool must not get a default $40 cap');
assert.equal(multiClaudeUnused.pools.claude.totalMonthlyCapUsd, null);
assert.equal(multiClaudeUnused.totalMonthlyCapUsd, (60 + 25) * 4, '4-week cap must sum only pools with back-calculated caps');

// Scenario 5: Free keeps Argon separate when weeklyArgon is present; absent weeklyArgon merges Argon into Gemini
const freeMulti = computeQuotaCycleMetrics(multiPoolStats, multiPoolQuota, 'free', testNowMs);
assert.equal(freeMulti.pools.gemini.weeklyCostUsd, 15.00);
assert.equal(freeMulti.pools.argon.weeklyCostUsd, 5.00);
assert.ok(freeMulti.pools.argon.bucket, 'Free tier preserves separate Argon pool when weeklyArgon exists');

const quotaNoArgon = {
  capturedAt: multiPoolQuota.capturedAt,
  weeklyGemini: multiPoolQuota.weeklyGemini,
  weeklyClaude: multiPoolQuota.weeklyClaude,
};
const proMerged = computeQuotaCycleMetrics(multiPoolStats, quotaNoArgon, 'pro', testNowMs);
assert.equal(proMerged.pools.gemini.weeklyCostUsd, 20.00, 'Absent weeklyArgon must merge Argon cost into Gemini');
assert.equal(proMerged.pools.argon.bucket, null);
assert.equal(proMerged.pools.argon.weeklyCostUsd, null);

// Scenario 6: Ultra 5x / 20x always merges Argon into Gemini and hides separate Argon pool
for (const ultraTier of ['ultra_5x', 'ultra_20x']) {
  const ultraWithArgonBucket = computeQuotaCycleMetrics(multiPoolStats, multiPoolQuota, ultraTier, testNowMs);
  assert.equal(ultraWithArgonBucket.pools.gemini.weeklyCostUsd, 20.00, `${ultraTier} must merge Argon into Gemini even if weeklyArgon exists`);
  assert.equal(ultraWithArgonBucket.pools.argon.bucket, null, `${ultraTier} must not expose a separate Argon bucket`);
  assert.equal(ultraWithArgonBucket.pools.argon.weeklyCostUsd, null);
  assert.equal(ultraWithArgonBucket.pools.argon.monthlyCostUsd, null);
  assert.equal(ultraWithArgonBucket.monthlyCostUsd, (20 + 12) * 4, `${ultraTier} monthly cost must sum merged Gemini and Claude without double-counting Argon`);
}

console.log('PASS: computeQuotaCycleMetrics accurately handles cycle reset boundaries, weekly cap back-calculation, and 4-week monthly rules');

// Scenario 7: End-to-end computeStats SQLite -> costTimeline pools + Ultra vs Pro merging
{
  const os = require('node:os');
  const { DatabaseSync } = require('node:sqlite');
  const { spawnSync } = require('node:child_process');

  function encodeVarint(num) {
    const bytes = [];
    let v = BigInt(num);
    while (v >= 0x80n) {
      bytes.push(Number((v & 0x7fn) | 0x80n));
      v >>= 7n;
    }
    bytes.push(Number(v));
    return Buffer.from(bytes);
  }

  function makeGenBlob(modelName, inputTokens, cacheReadTokens, outputTokens) {
    const usage = Buffer.concat([
      Buffer.from([0x10]), encodeVarint(inputTokens),
      Buffer.from([0x18]), encodeVarint(outputTokens),
      Buffer.from([0x28]), encodeVarint(cacheReadTokens),
    ]);
    const modelBuf = Buffer.from(modelName, 'utf8');
    const msg1 = Buffer.concat([
      Buffer.from([0x22, usage.length]), usage,
      Buffer.from([0x9a, 0x01, modelBuf.length]), modelBuf,
    ]);
    return Buffer.concat([Buffer.from([0x0a, msg1.length]), msg1]);
  }

  function makeStepTimestamp(sec) {
    const inner = Buffer.concat([Buffer.from([0x08]), encodeVarint(sec)]);
    return Buffer.concat([Buffer.from([0x0a, inner.length]), inner]);
  }

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-pricing-e2e-'));
  try {
    const convDir = path.join(tmpRoot, 'conversations');
    fs.mkdirSync(convDir, { recursive: true });
    const db = new DatabaseSync(path.join(convDir, 'e2e-pricing.db'));
    db.exec('CREATE TABLE gen_metadata (idx INTEGER, data BLOB); CREATE TABLE steps (idx INTEGER, step_type INTEGER, step_payload BLOB, metadata BLOB);');

    const baseSec = Math.floor((cycleStartMs + 3600 * 1000) / 1000);
    const entries = [
      // gemini-3.1-pro >200k (250k input -> $1.00) -> pool: gemini
      ['gemini-3.1-pro-preview', 250_000, 0, 0, baseSec],
      // gemini-4-carbon (1M input -> $2.00) -> pool: gemini
      ['gemini-4-carbon', 1_000_000, 0, 0, baseSec + 120],
      // gemini-4-argon (1M input -> $2.00) -> pool: argon
      ['gemini-4-argon-high', 1_000_000, 0, 0, baseSec + 240],
      // claude-opus-5-5 (1M input -> $4.00) -> pool: claude
      ['claude-opus-5.5', 1_000_000, 0, 0, baseSec + 360],
      // gpt-oss-120b ($0 -> omitted from costTimeline)
      ['gpt-oss-120b-medium', 1_000_000, 0, 0, baseSec + 480],
    ];

    entries.forEach(([model, inp, cache, out, tsSec], idx) => {
      db.prepare('INSERT INTO gen_metadata (idx, data) VALUES (?, ?)').run(idx + 1, makeGenBlob(model, inp, cache, out));
      db.prepare('INSERT INTO steps (idx, step_type, step_payload, metadata) VALUES (?, ?, ?, ?)').run(idx + 1, 15, null, makeStepTimestamp(tsSec));
    });
    db.close();

    const res = spawnSync(process.execPath, ['-e', "const { computeStats } = require('./scripts/aggregate-stats.cjs'); console.log(JSON.stringify(computeStats(true)));"], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      env: { ...process.env, ANTIGRAVITY_DATA_DIR: tmpRoot, ANTIGRAVITY_DISABLE_PERSIST_CACHE: '1' },
    });
    assert.equal(res.status, 0, `e2e computeStats failed: ${res.stderr}`);
    const e2eStats = JSON.parse(res.stdout.trim().split(/\r?\n/).at(-1));
    assert.equal(e2eStats.sessions['e2e-pricing'].costUsd, 9, 'Session total must sum $1 + $2 + $2 + $4 + $0 = $9');
    assert.equal(e2eStats.activity.costTimeline.length, 4, 'Zero-cost gpt-oss entry must not appear in costTimeline');

    const e2ePro = computeQuotaCycleMetrics(e2eStats, multiPoolQuota, 'pro', testNowMs);
    assert.equal(e2ePro.pools.gemini.weeklyCostUsd, 3.00, 'Pro Gemini pool sums 3.1 Pro ($1) + Carbon ($2)');
    assert.equal(e2ePro.pools.argon.weeklyCostUsd, 2.00, 'Pro Argon pool tracks Argon ($2) separately');
    assert.equal(e2ePro.pools.claude.weeklyCostUsd, 4.00, 'Pro Claude pool tracks Claude Opus 5.5 ($4)');

    const e2eUltra = computeQuotaCycleMetrics(e2eStats, multiPoolQuota, 'ultra_5x', testNowMs);
    assert.equal(e2eUltra.pools.gemini.weeklyCostUsd, 5.00, 'Ultra Gemini pool merges Argon ($2) into Gemini ($3)');
    assert.equal(e2eUltra.pools.argon.bucket, null, 'Ultra hides separate Argon pool');
    assert.equal(e2eUltra.pools.claude.weeklyCostUsd, 4.00, 'Ultra Claude pool keeps Claude ($4)');
    console.log('PASS: End-to-end computeStats SQLite aggregation -> pool classification & Pro/Ultra merging verified');
  } finally {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  }
}

console.log('\n--- Testing Account Tier Resolution & Auto-Switch Policy ---');
{
  const pro = resolveSubscriptionTierFromSignals({
    tierId: 'g1-pro-tier',
    tierName: 'Google AI Pro',
    teamsTier: 2,
    accountIdentity: 'alice@example.com',
  });
  assert.equal(pro?.tier, 'pro');
  assert.equal(pro?.isUltraAmbiguous, undefined);
  assert.equal(pro?.rawTierId, 'g1-pro-tier');
  assert.equal(pro?.accountKey, hashAccountKey('ALICE@example.com'));
  assert.ok(pro?.accountKey && !pro.accountKey.includes('alice'), 'accountKey must not leak raw PII');

  const free = resolveSubscriptionTierFromSignals({ tierId: 'free-tier', tierName: 'Antigravity' });
  assert.equal(free?.tier, 'free');

  const genericUltra = resolveSubscriptionTierFromSignals({
    tierId: 'g1-ultra-tier',
    tierName: 'Google AI Ultra',
    teamsTier: 8,
    accountIdentity: 'bob@example.com',
  });
  assert.equal(genericUltra?.tier, 'ultra_5x', 'Generic Ultra defaults to ultra_5x');
  assert.equal(genericUltra?.isUltraAmbiguous, true, 'Generic Ultra flags ambiguity for manual 5x/20x choice');

  const explicit20x = resolveSubscriptionTierFromSignals({ tierId: 'g1-ultra-tier', tierName: 'Google AI Ultra 20x' });
  assert.equal(explicit20x?.tier, 'ultra_20x');
  assert.equal(explicit20x?.isUltraAmbiguous, undefined);

  const explicit5x = resolveSubscriptionTierFromSignals({ tierId: 'g1-ultra-5x-tier', tierName: 'Google AI Ultra' });
  assert.equal(explicit5x?.tier, 'ultra_5x');
  assert.equal(explicit5x?.isUltraAmbiguous, undefined);

  const teamsUltimateOnly = resolveSubscriptionTierFromSignals({ teamsTier: 'TEAMS_ULTIMATE' });
  assert.equal(teamsUltimateOnly?.tier, 'ultra_5x');
  assert.equal(teamsUltimateOnly?.isUltraAmbiguous, true);

  assert.equal(resolveSubscriptionTierFromSignals(null), null);
  assert.equal(resolveSubscriptionTierFromSignals({}), null);

  // Auto-switch & per-account manual override behavior
  assert.deepEqual(resolveEffectiveTier(pro, 'free', null), { selectedTier: 'pro', isAutoSelected: true });
  assert.deepEqual(resolveEffectiveTier(genericUltra, 'pro', null), { selectedTier: 'ultra_5x', isAutoSelected: true });

  // User manually switches Ultra 5x -> Ultra 20x on Bob's Ultra account
  const ultraOverride = { tier: 'ultra_20x', scopeKey: buildTierScopeKey(genericUltra) };
  assert.deepEqual(
    resolveEffectiveTier(genericUltra, 'ultra_5x', ultraOverride),
    { selectedTier: 'ultra_20x', isAutoSelected: false },
    'Manual override to ultra_20x must stick on the same Ultra account'
  );

  // Switching to a different account (even if also Ultra) resets manual override and auto-switches
  const charlieUltra = resolveSubscriptionTierFromSignals({
    tierId: 'g1-ultra-tier',
    tierName: 'Google AI Ultra',
    accountIdentity: 'charlie@example.com',
  });
  assert.deepEqual(
    resolveEffectiveTier(charlieUltra, 'ultra_20x', ultraOverride),
    { selectedTier: 'ultra_5x', isAutoSelected: true },
    'Switching accounts must ignore previous account override and auto-switch'
  );

  // Downgrading Bob's account from Ultra -> Pro also resets the Ultra override
  const bobPro = resolveSubscriptionTierFromSignals({
    tierId: 'g1-pro-tier',
    tierName: 'Google AI Pro',
    accountIdentity: 'bob@example.com',
  });
  assert.deepEqual(
    resolveEffectiveTier(bobPro, 'ultra_20x', ultraOverride),
    { selectedTier: 'pro', isAutoSelected: true },
    'Subscription tier change on same account must auto-switch to new tier'
  );

  // Absent detectedAccountTier falls back to savedTier
  assert.deepEqual(resolveEffectiveTier(null, 'ultra_20x', null), { selectedTier: 'ultra_20x', isAutoSelected: false });
}
console.log('PASS: Account tier resolution & per-account auto-switch policy verified');

console.log('\n--- Testing Capped vs Total Monthly Cost Alignment ---');
{
  const nowMs = Date.parse('2026-11-14T12:00:00Z');
  const resetMs = nowMs + 3 * 86400000;
  const cycleStartMs = resetMs - 7 * 86400000;
  const resetIso = new Date(resetMs).toISOString();

  // Gemini active this week (50% of $60 = $30 -> $240 monthly cap, $120 extrapolated 4w cost)
  // Claude active last week ($40) but 0% this week -> totalMonthlyCapUsd is null
  const mixedHistoryStats = {
    kpis: { lifetimeTokens: '1M', lifetimeTokensRaw: 1_000_000 },
    activity: {
      heatmap: [],
      activeDaysCount: 10,
      totalTasks: 10,
      costTimelineCoverageStartMs: cycleStartMs - 14 * 86400000,
      costTimeline: [
        { ts: cycleStartMs + 3600000, costUsd: 30, pool: 'gemini' },
        { ts: cycleStartMs - 2 * 86400000, costUsd: 30, pool: 'gemini' },
        { ts: cycleStartMs - 9 * 86400000, costUsd: 30, pool: 'gemini' },
        { ts: cycleStartMs - 2 * 86400000, costUsd: 40, pool: 'claude' },
      ],
    },
    meta: { scannedConversations: 1, updatedAt: new Date(nowMs).toISOString(), hasStaleSessions: false },
  };
  const mixedQuota = {
    capturedAt: new Date(nowMs).toISOString(),
    weeklyGemini: { displayName: 'Gemini', bucketId: 'gemini-weekly', remainingFraction: 0.5, usedFraction: 0.5, resetTime: resetIso },
    weeklyClaude: { displayName: 'Claude', bucketId: '3p-weekly', remainingFraction: 1.0, usedFraction: 0.0, resetTime: resetIso },
  };
  const res = computeQuotaCycleMetrics(mixedHistoryStats, mixedQuota, 'pro', nowMs);
  assert.equal(res.pools.gemini.totalMonthlyCapUsd, 240);
  assert.equal(res.pools.claude.totalMonthlyCapUsd, null);
  assert.equal(res.totalMonthlyCapUsd, 240);
  assert.ok(res.monthlyCostUsd > 120, 'Total monthlyCostUsd retains past uncapped pool spending for ROI');
  assert.equal(res.cappedMonthlyCostUsd, res.pools.gemini.monthlyCostUsd, 'cappedMonthlyCostUsd must exclude uncapped pools so ring fraction shares the denominator');
}
console.log('PASS: Capped monthly cost aligns ring numerator with known monthly cap');

console.log('\nALL Subscription Pricing & Quota tests passed successfully!\n');
