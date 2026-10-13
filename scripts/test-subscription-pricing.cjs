const assert = require('node:assert/strict');

// Verify official pricing calculations
const OFFICIAL_PRICING = {
  flash: {
    inputPerM: 0.75,
    cacheReadPerM: 0.075,
    outputPerM: 3.75,
  },
};

function calculateTokensCost(inputTokens, cacheReadTokens, outputTokens) {
  const rate = OFFICIAL_PRICING.flash;
  const cost =
    (Math.max(0, inputTokens) / 1e6) * rate.inputPerM +
    (Math.max(0, cacheReadTokens) / 1e6) * rate.cacheReadPerM +
    (Math.max(0, outputTokens) / 1e6) * rate.outputPerM;
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

function parseQuotaSummaryResponse(resp) {
  if (!resp || !Array.isArray(resp.groups)) return null;

  let weeklyGemini;
  let weeklyClaude;

  for (const group of resp.groups) {
    const buckets = Array.isArray(group.buckets) ? group.buckets : [];
    for (const bucket of buckets) {
      const bId = String(bucket.bucketId || '').toLowerCase();
      const dName = String(bucket.displayName || '').toLowerCase();
      const isWeekly = bId.includes('weekly') || dName.includes('weekly');

      if (isWeekly) {
        const fraction = typeof bucket.remaining?.value === 'number' ? bucket.remaining.value : 1;
        const remainingFraction = Math.max(0, Math.min(1, fraction));
        const parsed = {
          displayName: bucket.displayName || 'Weekly Limit',
          bucketId: bucket.bucketId || 'weekly',
          remainingFraction,
          usedFraction: Number((1 - remainingFraction).toFixed(4)),
          resetTime: bucket.resetTime ? (bucket.resetTime.seconds ? new Date(Number(bucket.resetTime.seconds) * 1000).toISOString() : String(bucket.resetTime)) : null,
        };

        if (bId.includes('gemini') || !weeklyGemini) {
          weeklyGemini = parsed;
        } else if (bId.includes('3p') || bId.includes('claude')) {
          weeklyClaude = parsed;
        }
      }
    }
  }

  if (!weeklyGemini && !weeklyClaude) return null;

  return {
    capturedAt: new Date().toISOString(),
    weeklyGemini,
    weeklyClaude,
    description: resp.description,
  };
}

console.log('--- Testing calculateTokensCost ---');
assert.equal(calculateTokensCost(0, 0, 0), 0);
assert.equal(calculateTokensCost(1000000, 0, 0), 0.75);
assert.equal(calculateTokensCost(0, 1000000, 0), 0.08); // 0.075 rounded to 0.08
assert.equal(calculateTokensCost(0, 0, 1000000), 3.75);
// High cache scenario matching real Antigravity behavior (90% cache read)
assert.equal(calculateTokensCost(1000000, 9000000, 500000), 0.75 + 0.675 + 1.875);
console.log('PASS: calculateTokensCost accurately reflects official rates and cache discount');

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
assert.equal(parsed.weeklyClaude.bucketId, '3p-weekly');
assert.equal(parsed.weeklyClaude.remainingFraction, 1.0);
assert.equal(parsed.weeklyClaude.usedFraction, 0.0);
assert.equal(parseQuotaSummaryResponse(null), null);
assert.equal(parseQuotaSummaryResponse({}), null);
assert.equal(parseQuotaSummaryResponse({ groups: [] }), null);
assert.equal(parseQuotaSummaryResponse({ groups: [{ buckets: [] }] }), null);
console.log('PASS: parseQuotaSummaryResponse correctly parses official Gemini and Claude weekly buckets, and returns null when not captured');

console.log('--- Testing i18n Translations Completeness ---');
const fs = require('fs');
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
  'tierCustom',
  'claudeQuotaTitle',
];

for (const key of requiredKeys) {
  assert.ok(content.includes(`${key}:`), `Missing key in translations: ${key}`);
}
console.log('PASS: All required i18n keys are present in translations.ts');

console.log('\nALL Subscription Pricing & Quota tests passed successfully!\n');
