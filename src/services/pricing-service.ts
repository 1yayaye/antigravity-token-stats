import { CapturedQuotaBucket, LiveQuotaSummary, SubscriptionTierConfig, SubscriptionTierId } from '../domain/pricing.types';
import { AggregatedStats } from '../domain/stats.types';

// Official developer API pricing per 1M tokens (USD)
export const OFFICIAL_PRICING = {
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

export const SUBSCRIPTION_PRESETS: Record<SubscriptionTierId, SubscriptionTierConfig> = {
  free: { id: 'free', name: 'Free', monthlyFeeUsd: 0, labelKey: 'tierFree' },
  pro: { id: 'pro', name: 'Google AI Pro', monthlyFeeUsd: 19.99, labelKey: 'tierPro' },
  ultra_5x: { id: 'ultra_5x', name: 'Google AI Ultra (5x)', monthlyFeeUsd: 99.99, labelKey: 'tierUltra5x' },
  ultra_20x: { id: 'ultra_20x', name: 'Google AI Ultra (20x)', monthlyFeeUsd: 199.99, labelKey: 'tierUltra20x' },
};

export const BASELINE_WEEKLY_CAP_USD: Record<SubscriptionTierId, number> = {
  free: 12,
  pro: 60,
  ultra_5x: 300,
  ultra_20x: 1200,
};

export interface QuotaCycleMetrics {
  weeklyCostUsd: number | null;
  monthlyCostUsd: number | null;
  totalWeeklyCapUsd: number;
  totalMonthlyCapUsd: number;
  isMonthlyExtrapolated: boolean;
  activeCyclesCount: number;
}
const WEEK_MS = 7 * 86400000;

function roundUsd(val: number): number {
  return Math.round((Math.max(0, val) + Number.EPSILON) * 100) / 100;
}

/**
 * Computes current weekly cycle cost, estimated 100% weekly quota capacity,
 * and 4-week monthly consumed cost & capacity.
 * - Uses only Gemini events in the current weekly reset cycle `[resetMs - 7d, nowMs]`.
 * - Monthly capacity = 4 × weekly quota capacity.
 * - Covered past weeks include zero-use weeks; missing weeks use the average covered week or current-week cost.
 */
export function computeQuotaCycleMetrics(
  stats: AggregatedStats,
  liveQuota: LiveQuotaSummary | null | undefined,
  selectedTier: SubscriptionTierId = 'pro',
  nowMs: number = Date.now()
): QuotaCycleMetrics {
  const gemini = liveQuota?.weeklyGemini;
  const resetIso = gemini?.resetTime;
  const parsedResetMs = resetIso ? new Date(resetIso).getTime() : NaN;
  const baselineWeeklyCap = BASELINE_WEEKLY_CAP_USD[selectedTier] ?? BASELINE_WEEKLY_CAP_USD.pro;
  if (!Number.isFinite(parsedResetMs) || parsedResetMs <= nowMs) {
    return {
      weeklyCostUsd: null,
      monthlyCostUsd: null,
      totalWeeklyCapUsd: baselineWeeklyCap,
      totalMonthlyCapUsd: roundUsd(baselineWeeklyCap * 4),
      isMonthlyExtrapolated: false,
      activeCyclesCount: 0,
    };
  }
  const cycleStartMs = parsedResetMs - WEEK_MS;

  const timeline = stats.activity?.costTimeline || [];

  // Cycle 0 is current; cycles 1..3 are the preceding reset-aligned weeks.
  const cycleCosts = [0, 0, 0, 0];
  let earliestGeminiMs = Infinity;

  for (const item of timeline) {
    if (item.pool !== 'gemini' || !Number.isFinite(item.ts) || !(item.costUsd > 0)) continue;
    if (item.ts < earliestGeminiMs) earliestGeminiMs = item.ts;
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
  if (gemini?.usedFraction === 0) cycleCosts[0] = 0;

  const weeklyCostUsd = roundUsd(cycleCosts[0]);

  // Estimate 100% weekly quota capacity:
  // Back-calculate from current cycle cost / usedFraction when usedFraction >= 5% (statistically stable),
  // otherwise fall back to subscription tier baseline capacity.
  let totalWeeklyCapUsd = baselineWeeklyCap;
  if (gemini && gemini.usedFraction >= 0.05 && weeklyCostUsd > 0) {
    totalWeeklyCapUsd = roundUsd(weeklyCostUsd / gemini.usedFraction);
  }

  // Monthly capacity is strictly 4 weekly quota capacities
  const totalMonthlyCapUsd = roundUsd(totalWeeklyCapUsd * 4);

  // The first fully covered day bounds which past reset cycles can be treated as complete.
  const historyStartMs = stats.activity?.costTimelineCoverageStartMs ?? earliestGeminiMs;
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
    weeklyCostUsd,
    monthlyCostUsd,
    totalWeeklyCapUsd,
    totalMonthlyCapUsd,
    isMonthlyExtrapolated,
    activeCyclesCount,
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
  const fraction = typeof b.remaining?.value === 'number' ? b.remaining.value : 1;
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

  for (const group of resp.groups) {
    const buckets = Array.isArray(group.buckets) ? group.buckets : [];
    for (const bucket of buckets) {
      const bId = String(bucket.bucketId || '').toLowerCase();
      const dName = String(bucket.displayName || '').toLowerCase();
      const isWeekly = bId.includes('weekly') || dName.includes('weekly');

      if (isWeekly) {
        if (!bId.includes('3p') && !bId.includes('claude') && !dName.includes('claude') && (bId.includes('gemini') || !weeklyGemini)) {
          weeklyGemini = parseRawBucket(bucket);
        }
      }
    }
  }

  if (!weeklyGemini) return null;

  return {
    capturedAt: new Date().toISOString(),
    weeklyGemini,
    description: resp.description,
  };
}

let lastQuotaFetchTime = 0;
const QUOTA_CACHE_TTL_MS = 30_000;

/**
 * Searches React Fiber tree for Antigravity's cloudCodeService and calls retrieveUserQuotaSummary
 */
export async function tryFetchLiveQuotaFromHost(force = false): Promise<LiveQuotaSummary | null> {
  if (typeof window === 'undefined') return null;

  const now = Date.now();
  if (!force && window.__ANTIGRAVITY_LIVE_QUOTA__ && now - lastQuotaFetchTime < QUOTA_CACHE_TTL_MS) {
    return window.__ANTIGRAVITY_LIVE_QUOTA__;
  }

  try {
    const root = document.querySelector('#root, #app') || document.body.firstElementChild;
    if (!root) return window.__ANTIGRAVITY_LIVE_QUOTA__ || null;

    let cloudCodeService: any = null;
    function searchFiber(fiber: any, depth = 0) {
      if (!fiber || depth > 200 || cloudCodeService) return;
      const p = fiber.memoizedProps;
      if (p?.services?.core?.cloudCodeService) {
        cloudCodeService = p.services.core.cloudCodeService;
        return;
      }
      searchFiber(fiber.child, depth + 1);
      searchFiber(fiber.sibling, depth + 1);
    }

    for (const key in root) {
      if (key.startsWith('__reactFiber') || key.startsWith('__reactContainer')) {
        searchFiber((root as any)[key]);
        if (cloudCodeService) break;
      }
    }

    if (cloudCodeService && typeof cloudCodeService.retrieveUserQuotaSummary === 'function') {
      const res = await cloudCodeService.retrieveUserQuotaSummary({}, true);
      const summary = parseQuotaSummaryResponse(res?.response);
      if (summary) {
        lastQuotaFetchTime = now;
        window.__ANTIGRAVITY_LIVE_QUOTA__ = summary;
        return summary;
      }
    }
  } catch (err) {
    // Graceful silence on failure
  }

  return window.__ANTIGRAVITY_LIVE_QUOTA__ || null;
}
