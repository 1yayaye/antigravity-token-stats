import type { DetectedAccountTier, LiveQuotaSummary } from '../../../src/domain/pricing.types';
import { parseQuotaSummaryResponse, resolveSubscriptionTierFromSignals } from '../../../src/services/pricing-service';
import { EVENT_QUOTA_UPDATED, EVENT_REQUEST_SYNC, EVENT_STATS_UPDATED, WINDOW_LIVE_QUOTA } from '../../../src/injection-contract.cjs';

let lastQuotaFetchTime = 0;
let quotaFetchInFlight: Promise<LiveQuotaSummary | null> | null = null;
const QUOTA_CACHE_TTL_MS = 30_000;

async function detectDesktopAccountTier(
  authService: any,
  cloudCodeService: any,
  force: boolean
): Promise<DetectedAccountTier | null> {
  let tierId: string | undefined;
  let tierName: string | undefined;
  let teamsTier: number | string | undefined;
  let accountIdentity: string | undefined;

  try {
    if (typeof authService?._lsClient?.getUserStatus === 'function') {
      const res = await authService._lsClient.getUserStatus({});
      const us = res?.userStatus;
      if (us) {
        tierId = us.userTier?.id || tierId;
        tierName = us.userTier?.name || us.userTier?.description || us.planStatus?.planInfo?.planName || tierName;
        teamsTier = us.planStatus?.planInfo?.teamsTier ?? teamsTier;
        accountIdentity = typeof us.email === 'string' ? us.email : accountIdentity;
      }
    }
  } catch {}

  if (!tierId && !tierName) {
    try {
      if (typeof authService?.refreshUserStatus === 'function') {
        const res = await authService.refreshUserStatus();
        if (res?.userTier) {
          tierId = res.userTier.id || tierId;
          tierName = res.userTier.name || res.userTier.description || tierName;
        }
      }
    } catch {}
  }

  if (!tierId && !tierName && typeof cloudCodeService?.loadCodeAssist === 'function') {
    try {
      const res = await cloudCodeService.loadCodeAssist(force);
      const tierObj = res?.paidTier || res?.currentTier;
      if (tierObj) {
        tierId = tierObj.id || tierId;
        tierName = tierObj.name || tierObj.description || tierName;
      }
    } catch {}
  }

  return resolveSubscriptionTierFromSignals({ tierId, tierName, teamsTier, accountIdentity });
}

/**
 * Searches React Fiber tree for Antigravity's cloudCodeService and calls retrieveUserQuotaSummary
 */
export async function fetchLiveQuota(force = false): Promise<LiveQuotaSummary | null> {
  if (typeof window === 'undefined') return null;
  if (quotaFetchInFlight) return quotaFetchInFlight;

  const quotaStore = window as unknown as Record<string, LiveQuotaSummary | null | undefined>;
  const now = Date.now();
  const cached = quotaStore[WINDOW_LIVE_QUOTA];
  if (!force && now - lastQuotaFetchTime < QUOTA_CACHE_TTL_MS) {
    return cached || null;
  }

  // Failed automatic requests share the TTL so missing login cannot cause a request storm.
  lastQuotaFetchTime = now;
  quotaFetchInFlight = (async () => {
    try {
      const root = document.querySelector('#root, #app') || document.body.firstElementChild;
      if (!root) return quotaStore[WINDOW_LIVE_QUOTA] || null;

      let cloudCodeService: any = null;
      let authService: any = null;
      function searchFiber(fiber: any, depth = 0) {
        if (!fiber || depth > 200 || cloudCodeService) return;
        const p = fiber.memoizedProps;
        if (p?.services?.core?.cloudCodeService) {
          cloudCodeService = p.services.core.cloudCodeService;
          authService = p.services.core.authService || null;
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
        const quotaPromise = (async () => {
          try {
            return await cloudCodeService.retrieveUserQuotaSummary(force);
          } catch (err: any) {
            const msg = String(err?.rawMessage || err?.message || err || '').toLowerCase();
            if (err instanceof TypeError || msg.includes('cannot encode') || msg.includes('expected')) {
              return await cloudCodeService.retrieveUserQuotaSummary({}, force);
            }
            throw err;
          }
        })();

        const [quotaSettled, tierSettled] = await Promise.allSettled([
          quotaPromise,
          detectDesktopAccountTier(authService, cloudCodeService, force),
        ]);

        if (quotaSettled.status === 'rejected') throw quotaSettled.reason;
        const summary = parseQuotaSummaryResponse(quotaSettled.value?.response ?? quotaSettled.value);
        if (summary) {
          if (tierSettled.status === 'fulfilled' && tierSettled.value) {
            summary.detectedAccountTier = tierSettled.value;
          }
          quotaStore[WINDOW_LIVE_QUOTA] = summary;
          window.dispatchEvent(new CustomEvent(EVENT_QUOTA_UPDATED, { detail: summary }));
          return summary;
        }
      }
    } catch (err) {
      // Graceful silence on failure
    }

    return quotaStore[WINDOW_LIVE_QUOTA] || null;
  })().finally(() => { quotaFetchInFlight = null; });
  return quotaFetchInFlight;
}

export function startQuotaUpdates(): () => void {
  const onSync = (event: Event) => {
    if (!(event as CustomEvent<{ sessionId?: string | null }>).detail?.sessionId) void fetchLiveQuota(true);
  };
  const onStats = () => { void fetchLiveQuota(); };
  window.addEventListener(EVENT_REQUEST_SYNC, onSync);
  window.addEventListener(EVENT_STATS_UPDATED, onStats);
  void fetchLiveQuota();
  return () => {
    window.removeEventListener(EVENT_REQUEST_SYNC, onSync);
    window.removeEventListener(EVENT_STATS_UPDATED, onStats);
  };
}
