import {
  CapturedQuotaBucket,
  DetectedAccountTier,
  LiveQuotaSummary,
  QuotaPoolId,
  SubscriptionTierConfig,
  SubscriptionTierId,
} from '../domain/pricing.types';
import { AggregatedStats } from '../domain/stats.types';

export const SUBSCRIPTION_PRESETS: Record<SubscriptionTierId, SubscriptionTierConfig> = {
  free: { id: 'free', name: 'Free', monthlyFeeUsd: 0, labelKey: 'tierFree' },
  pro: { id: 'pro', name: 'Google AI Pro', monthlyFeeUsd: 19.99, labelKey: 'tierPro' },
  ultra_5x: { id: 'ultra_5x', name: 'Google AI Ultra (5x)', monthlyFeeUsd: 99.99, labelKey: 'tierUltra5x' },
  ultra_20x: { id: 'ultra_20x', name: 'Google AI Ultra (20x)', monthlyFeeUsd: 199.99, labelKey: 'tierUltra20x' },
};

export interface PoolQuotaCycleMetrics {
  pool: QuotaPoolId;
  bucket: CapturedQuotaBucket | null;
  usedFraction: number;
  remainingFraction: number;
  weeklyCostUsd: number | null;
  monthlyCostUsd: number | null;
  totalWeeklyCapUsd: number | null;
  totalMonthlyCapUsd: number | null;
  isMonthlyExtrapolated: boolean;
  activeCyclesCount: number;
}

export interface QuotaCycleMetrics {
  weeklyCostUsd: number | null;
  monthlyCostUsd: number | null;
  /** Sum of 4-week costs only across pools that have a valid monthly cap estimate. */
  cappedMonthlyCostUsd: number | null;
  totalWeeklyCapUsd: number | null;
  totalMonthlyCapUsd: number | null;
  isMonthlyExtrapolated: boolean;
  activeCyclesCount: number;
  pools: Record<QuotaPoolId, PoolQuotaCycleMetrics>;
}
const WEEK_MS = 7 * 86400000;

function roundUsd(val: number): number {
  return Math.round((Math.max(0, val) + Number.EPSILON) * 100) / 100;
}

function computePoolCycleMetrics(
  stats: AggregatedStats,
  bucket: CapturedQuotaBucket | null | undefined,
  pool: QuotaPoolId,
  nowMs: number = Date.now(),
  mergeArgonIntoGemini: boolean = false
): PoolQuotaCycleMetrics {
  const usedFraction = bucket ? Math.min(1, Math.max(0, bucket.usedFraction)) : 0;
  const remainingFraction = bucket ? Math.min(1, Math.max(0, bucket.remainingFraction)) : 1;

  const resetIso = bucket?.resetTime;
  const parsedResetMs = resetIso ? new Date(resetIso).getTime() : NaN;
  if (!bucket || !Number.isFinite(parsedResetMs) || parsedResetMs <= nowMs) {
    return {
      pool,
      bucket: bucket ?? null,
      usedFraction,
      remainingFraction,
      weeklyCostUsd: null,
      monthlyCostUsd: null,
      totalWeeklyCapUsd: null,
      totalMonthlyCapUsd: null,
      isMonthlyExtrapolated: false,
      activeCyclesCount: 0,
    };
  }
  const cycleStartMs = parsedResetMs - WEEK_MS;
  const timeline = stats.activity?.costTimeline || [];

  // Cycle 0 is current; cycles 1..3 are the preceding reset-aligned weeks.
  const cycleCosts = [0, 0, 0, 0];
  let earliestPoolMs = Infinity;

  for (const item of timeline) {
    const matchesPool = item.pool === pool || (mergeArgonIntoGemini && item.pool === 'argon');
    if (!matchesPool || !Number.isFinite(item.ts) || !(item.costUsd > 0)) continue;
    if (item.ts < earliestPoolMs) earliestPoolMs = item.ts;
    if (item.ts >= cycleStartMs && item.ts <= nowMs) {
      cycleCosts[0] += item.costUsd;
    } else if (item.ts >= cycleStartMs - WEEK_MS && item.ts < cycleStartMs) {
      cycleCosts[1] += item.costUsd;
    } else if (item.ts >= cycleStartMs - 2 * WEEK_MS && item.ts < cycleStartMs - WEEK_MS) {
      cycleCosts[2] += item.costUsd;
    } else if (item.ts >= cycleStartMs - 3 * WEEK_MS && item.ts < cycleStartMs - 2 * WEEK_MS) {
      cycleCosts[3] += item.costUsd;
    }
  }

  // Trust the official zero-use reading when it conflicts with the local timeline.
  if (bucket.usedFraction === 0) cycleCosts[0] = 0;

  const weeklyCostUsd = roundUsd(cycleCosts[0]);

  // Estimate 100% weekly quota capacity directly from current cycle cost / usedFraction;
  // omit the cap (null) when there is no weekly usage or cost data yet.
  const totalWeeklyCapUsd = usedFraction > 0 && weeklyCostUsd > 0
    ? roundUsd(weeklyCostUsd / usedFraction)
    : null;

  // Monthly capacity is strictly 4 weekly quota capacities
  const totalMonthlyCapUsd = totalWeeklyCapUsd !== null
    ? roundUsd(totalWeeklyCapUsd * 4)
    : null;

  // The first fully covered day bounds which past reset cycles can be treated as complete.
  const historyStartMs = stats.activity?.costTimelineCoverageStartMs ?? earliestPoolMs;
  const coveredPastCosts = cycleCosts.slice(1).filter((_, index) =>
    !stats.meta.hasStaleSessions && cycleStartMs - (index + 1) * WEEK_MS >= historyStartMs
  );
  const missingWeeks = 3 - coveredPastCosts.length;
  const observedPastTotal = coveredPastCosts.reduce((sum, cost) => sum + cost, 0);
  const referenceWeeklyCost = coveredPastCosts.length > 0
    ? observedPastTotal / coveredPastCosts.length
    : weeklyCostUsd;
  const monthlyCostUsd = roundUsd(weeklyCostUsd + observedPastTotal + missingWeeks * referenceWeeklyCost);
  const isMonthlyExtrapolated = missingWeeks > 0;
  const activeCyclesCount = [weeklyCostUsd, ...coveredPastCosts].filter(cost => cost > 0).length;

  return {
    pool,
    bucket,
    usedFraction,
    remainingFraction,
    weeklyCostUsd,
    monthlyCostUsd,
    totalWeeklyCapUsd,
    totalMonthlyCapUsd,
    isMonthlyExtrapolated,
    activeCyclesCount,
  };
}

/**
 * Computes current weekly cycle cost, estimated 100% weekly quota capacity,
 * and 4-week monthly consumed cost & capacity across Gemini, Claude & GPT, and Argon pools.
 */
export function computeQuotaCycleMetrics(
  stats: AggregatedStats,
  liveQuota: LiveQuotaSummary | null | undefined,
  selectedTier: SubscriptionTierId = 'pro',
  nowMs: number = Date.now()
): QuotaCycleMetrics {
  // Ultra plans pool Argon and Carbon under Gemini; only Pro/Free track Argon separately when present.
  const isUltraTier = selectedTier === 'ultra_5x' || selectedTier === 'ultra_20x';
  const hasSeparateArgon = !isUltraTier && Boolean(liveQuota?.weeklyArgon);

  const pools: Record<QuotaPoolId, PoolQuotaCycleMetrics> = {
    gemini: computePoolCycleMetrics(stats, liveQuota?.weeklyGemini, 'gemini', nowMs, !hasSeparateArgon),
    claude: computePoolCycleMetrics(stats, liveQuota?.weeklyClaude, 'claude', nowMs, false),
    argon: computePoolCycleMetrics(stats, hasSeparateArgon ? liveQuota?.weeklyArgon : undefined, 'argon', nowMs, false),
  };

  const validPools = (['gemini', 'claude', 'argon'] as QuotaPoolId[])
    .map(pool => pools[pool])
    .filter(p => p.bucket && p.monthlyCostUsd !== null);

  if (validPools.length === 0) {
    return {
      weeklyCostUsd: pools.gemini.weeklyCostUsd,
      monthlyCostUsd: null,
      cappedMonthlyCostUsd: null,
      totalWeeklyCapUsd: pools.gemini.totalWeeklyCapUsd,
      totalMonthlyCapUsd: pools.gemini.totalMonthlyCapUsd,
      isMonthlyExtrapolated: false,
      activeCyclesCount: 0,
      pools,
    };
  }

  const monthlyCostUsd = roundUsd(validPools.reduce((sum, p) => sum + (p.monthlyCostUsd ?? 0), 0));
  const cappedPools = validPools.filter(
    (p): p is PoolQuotaCycleMetrics & { totalMonthlyCapUsd: number } => p.totalMonthlyCapUsd !== null
  );
  const totalMonthlyCapUsd = cappedPools.length > 0
    ? roundUsd(cappedPools.reduce((sum, p) => sum + p.totalMonthlyCapUsd, 0))
    : null;
  const cappedMonthlyCostUsd = cappedPools.length > 0
    ? roundUsd(cappedPools.reduce((sum, p) => sum + (p.monthlyCostUsd ?? 0), 0))
    : null;
  const isMonthlyExtrapolated = validPools.some(p => p.isMonthlyExtrapolated);
  const activeCyclesCount = Math.max(...validPools.map(p => p.activeCyclesCount));

  return {
    weeklyCostUsd: pools.gemini.weeklyCostUsd,
    monthlyCostUsd,
    cappedMonthlyCostUsd,
    totalWeeklyCapUsd: pools.gemini.totalWeeklyCapUsd,
    totalMonthlyCapUsd,
    isMonthlyExtrapolated,
    activeCyclesCount,
    pools,
  };
}

/**
 * Formats countdown to reset time (e.g., '3d 18h', '4h 12m', '<1m', or '已刷新')
 */
export function formatResetCountdown(resetTimeIso: string | null | undefined, lang: 'zh' | 'en' = 'zh'): string {
  if (!resetTimeIso) return '—';
  const target = new Date(resetTimeIso).getTime();
  if (isNaN(target)) return '—';

  const diffMs = target - Date.now();
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

function parseRawBucket(b: any): CapturedQuotaBucket | undefined {
  if (!b) return undefined;
  // Remaining fraction sources, in order: the current proto oneof wrapper
  // `remaining: { case: 'remainingFraction', value }` (Antigravity client update),
  // the legacy flat `remainingFraction` number, and the older `remainingAmount`
  // string. Missing all three means "no usage recorded", i.e. fully remaining.
  let fraction = 1;
  if (b.remaining && typeof b.remaining.value === 'number' && Number.isFinite(b.remaining.value)) {
    fraction = b.remaining.value;
  } else if (typeof b.remainingFraction === 'number' && Number.isFinite(b.remainingFraction)) {
    fraction = b.remainingFraction;
  } else if (typeof b.remainingAmount === 'string' && b.remainingAmount.trim() !== '' && Number.isFinite(Number(b.remainingAmount))) {
    fraction = Number(b.remainingAmount);
  }
  const remainingFraction = Math.max(0, Math.min(1, fraction));
  let resetTimeIso: string | null = null;
  if (b.resetTime) {
    if (typeof b.resetTime === 'string') {
      resetTimeIso = b.resetTime;
    } else if (b.resetTime.seconds) {
      resetTimeIso = new Date(Number(b.resetTime.seconds) * 1000).toISOString();
    }
  }
  return {
    displayName: b.displayName || b.bucketId || 'Weekly Limit',
    bucketId: b.bucketId || 'weekly',
    remainingFraction,
    usedFraction: Number((1 - remainingFraction).toFixed(4)),
    resetTime: resetTimeIso,
  };
}

/**
 * Parses raw QuotaSummary response from Antigravity cloudCodeService into LiveQuotaSummary
 */
export function parseQuotaSummaryResponse(resp: any): LiveQuotaSummary | null {
  if (!resp || !Array.isArray(resp.groups)) return null;

  let weeklyGemini: CapturedQuotaBucket | undefined;
  let weeklyClaude: CapturedQuotaBucket | undefined;
  let weeklyArgon: CapturedQuotaBucket | undefined;

  // Some deployments put buckets both under groups[].buckets[] and directly on the
  // top level; scan both so either shape yields all weekly quota pools.
  const bucketGroups: Array<{ groupName: string; buckets: any[] }> = [];
  for (const group of resp.groups) {
    bucketGroups.push({
      groupName: String(group?.displayName || '').toLowerCase(),
      buckets: Array.isArray(group?.buckets) ? group.buckets : [],
    });
  }
  if (Array.isArray(resp.buckets)) {
    bucketGroups.push({ groupName: '', buckets: resp.buckets });
  }

  for (const { groupName, buckets } of bucketGroups) {
    for (const bucket of buckets) {
      if (!bucket) continue;
      const win = String(bucket.window || '').toLowerCase();
      if (win && win !== 'weekly') continue;

      const bId = String(bucket.bucketId || '').toLowerCase();
      const dName = String(bucket.displayName || '').toLowerCase();
      const isWeekly = win === 'weekly' || bId.includes('weekly') || dName.includes('weekly');
      if (!isWeekly) continue;

      if (bId.includes('argon') || dName.includes('argon') || groupName.includes('argon')) {
        weeklyArgon = parseRawBucket(bucket);
      } else if (
        bId.includes('3p') ||
        bId.includes('claude') ||
        bId.includes('gpt') ||
        dName.includes('claude') ||
        dName.includes('gpt') ||
        groupName.includes('claude') ||
        groupName.includes('gpt')
      ) {
        weeklyClaude = parseRawBucket(bucket);
      } else if (bId.includes('gemini') || groupName.includes('gemini') || !weeklyGemini) {
        weeklyGemini = parseRawBucket(bucket);
      }
    }
  }

  if (!weeklyGemini && !weeklyClaude && !weeklyArgon) return null;

  return {
    capturedAt: new Date().toISOString(),
    ...(weeklyGemini ? { weeklyGemini } : {}),
    ...(weeklyClaude ? { weeklyClaude } : {}),
    ...(weeklyArgon ? { weeklyArgon } : {}),
    description: resp.description,
  };
}

export interface AccountTierSignals {
  tierId?: string | null;
  tierName?: string | null;
  teamsTier?: number | string | null;
  accountIdentity?: string | null;
}

/**
 * Produces a non-reversible, non-PII short tag from an account email/ID so
 * manual tier overrides can be scoped per account without persisting raw PII.
 */
export function hashAccountKey(identity: string | null | undefined): string | undefined {
  const normalized = typeof identity === 'string' ? identity.trim().toLowerCase() : '';
  if (!normalized) return undefined;
  let hash = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const ULTRA_TEAMS_TIERS = new Set<number | string>([7, 8, '7', '8', 'TEAMS_ULTIMATE', 'PRO_ULTIMATE']);
const PRO_TEAMS_TIERS = new Set<number | string>([1, 2, 9, '1', '2', '9', 'TEAMS', 'PRO', 'TRIAL']);

/**
 * Maps Antigravity / cloudcode-pa account tier metadata into a local SubscriptionTierId.
 * Generic Ultra identifiers (e.g. `g1-ultra-tier`) default to `ultra_5x` with
 * `isUltraAmbiguous: true` so the UI lets users choose between 5x and 20x manually.
 */
export function resolveSubscriptionTierFromSignals(
  signals: AccountTierSignals | null | undefined
): DetectedAccountTier | null {
  if (!signals) return null;
  const rawTierId = typeof signals.tierId === 'string' ? signals.tierId.trim() : '';
  const rawTierName = typeof signals.tierName === 'string' ? signals.tierName.trim() : '';
  const combined = `${rawTierId} ${rawTierName}`.trim().toLowerCase();
  const teamsTier = typeof signals.teamsTier === 'string' ? signals.teamsTier.trim().toUpperCase() : signals.teamsTier;

  let resolved: { tier: SubscriptionTierId; isUltraAmbiguous?: boolean } | null = null;

  if (/ultra[\s_-]*20x|20x[\s_-]*ultra/i.test(combined)) {
    resolved = { tier: 'ultra_20x', isUltraAmbiguous: false };
  } else if (/ultra[\s_-]*5x|5x[\s_-]*ultra/i.test(combined)) {
    resolved = { tier: 'ultra_5x', isUltraAmbiguous: false };
  } else if (/\bultra\b|g1-ultra|ultimate/i.test(combined)) {
    resolved = { tier: 'ultra_5x', isUltraAmbiguous: true };
  } else if (/g1-pro|\bpro\b/i.test(combined)) {
    resolved = { tier: 'pro', isUltraAmbiguous: false };
  } else if (teamsTier != null && ULTRA_TEAMS_TIERS.has(teamsTier)) {
    resolved = { tier: 'ultra_5x', isUltraAmbiguous: true };
  } else if (teamsTier != null && PRO_TEAMS_TIERS.has(teamsTier)) {
    resolved = { tier: 'pro', isUltraAmbiguous: false };
  } else if (/free-tier|legacy-tier|\bfree\b/i.test(combined) || rawTierName.toLowerCase() === 'antigravity') {
    resolved = { tier: 'free', isUltraAmbiguous: false };
  }

  if (!resolved) return null;
  const accountKey = hashAccountKey(signals.accountIdentity);
  return {
    tier: resolved.tier,
    ...(resolved.isUltraAmbiguous ? { isUltraAmbiguous: true } : {}),
    ...(rawTierId ? { rawTierId } : {}),
    ...(rawTierName ? { rawTierName } : {}),
    ...(accountKey ? { accountKey } : {}),
  };
}
