import { CapturedQuotaBucket, LiveQuotaSummary, SubscriptionTierConfig, SubscriptionTierId } from '../domain/pricing.types';

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
  custom: { id: 'custom', name: 'Custom', monthlyFeeUsd: 20, labelKey: 'tierCustom' },
};

/**
 * Calculates official API cost for given token counts based on Flash rates (baseline).
 */
export function calculateTokensCost(
  inputTokens: number,
  cacheReadTokens: number,
  outputTokens: number
): number {
  const rate = OFFICIAL_PRICING.flash;
  const cost =
    (Math.max(0, inputTokens) / 1e6) * rate.inputPerM +
    (Math.max(0, cacheReadTokens) / 1e6) * rate.cacheReadPerM +
    (Math.max(0, outputTokens) / 1e6) * rate.outputPerM;
  return Math.round((cost + Number.EPSILON) * 100) / 100;
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
  let weeklyClaude: CapturedQuotaBucket | undefined;

  for (const group of resp.groups) {
    const buckets = Array.isArray(group.buckets) ? group.buckets : [];
    for (const bucket of buckets) {
      const bId = String(bucket.bucketId || '').toLowerCase();
      const dName = String(bucket.displayName || '').toLowerCase();
      const isWeekly = bId.includes('weekly') || dName.includes('weekly');

      if (isWeekly) {
        if (bId.includes('gemini') || !weeklyGemini) {
          weeklyGemini = parseRawBucket(bucket);
        } else if (bId.includes('3p') || bId.includes('claude')) {
          weeklyClaude = parseRawBucket(bucket);
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

/**
 * Searches React Fiber tree for Antigravity's cloudCodeService and calls retrieveUserQuotaSummary
 */
export async function tryFetchLiveQuotaFromHost(): Promise<LiveQuotaSummary | null> {
  if (typeof window === 'undefined') return null;

  if (window.__ANTIGRAVITY_LIVE_QUOTA__) {
    return window.__ANTIGRAVITY_LIVE_QUOTA__;
  }

  try {
    const root = document.querySelector('#root, #app') || document.body.firstElementChild;
    if (!root) return null;

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
      const res = await cloudCodeService.retrieveUserQuotaSummary({}, false);
      const summary = parseQuotaSummaryResponse(res?.response);
      if (summary) {
        window.__ANTIGRAVITY_LIVE_QUOTA__ = summary;
        return summary;
      }
    }
  } catch (err) {
    // Graceful silence on failure
  }

  return null;
}
