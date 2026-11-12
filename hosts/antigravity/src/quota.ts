import type { LiveQuotaSummary } from '../../../src/domain/pricing.types';
import { parseQuotaSummaryResponse } from '../../../src/services/pricing-service';
import { EVENT_QUOTA_UPDATED, EVENT_REQUEST_SYNC, EVENT_STATS_UPDATED, WINDOW_LIVE_QUOTA } from '../../../src/injection-contract.cjs';

let lastQuotaFetchTime = 0;
let quotaFetchInFlight: Promise<LiveQuotaSummary | null> | null = null;
const QUOTA_CACHE_TTL_MS = 30_000;

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
