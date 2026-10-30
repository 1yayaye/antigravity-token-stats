import { useEffect, useMemo, useState } from 'react';
import { AggregatedStats } from '../../domain/stats.types';
import { LiveQuotaSummary, SubscriptionTierConfig, SubscriptionTierId } from '../../domain/pricing.types';
import {
  computeQuotaCycleMetrics,
  QuotaCycleMetrics,
  SUBSCRIPTION_PRESETS,
  tryFetchLiveQuotaFromHost,
} from '../../services/pricing-service';
import { EVENT_REQUEST_SYNC, EVENT_STATS_UPDATED, WINDOW_LIVE_QUOTA } from '../../injection-contract.cjs';

const TIER_STORAGE_KEY = 'antigravity_selected_tier';

export interface QuotaMetrics {
  liveQuota: LiveQuotaSummary | null;
  selectedTier: SubscriptionTierId;
  setTier: (tier: SubscriptionTierId) => void;
  metrics: QuotaCycleMetrics;
  plan: SubscriptionTierConfig;
  nowMs: number;
}

// Owns every stateful concern of the subscription quota view: live quota
// fetching and refresh listeners, tier persistence, the per-minute clock that
// drives the reset countdown, and the derived cycle metrics. Consumers stay
// purely presentational.
export function useQuotaMetrics(stats: AggregatedStats): QuotaMetrics {
  const [liveQuota, setLiveQuota] = useState<LiveQuotaSummary | null>(() => {
    if (typeof window === 'undefined') return null;
    // Resolved through the contract constant; the literal-key declare lives in pricing.types.ts.
    return (window as unknown as Record<string, LiveQuotaSummary | null | undefined>)[WINDOW_LIVE_QUOTA] || null;
  });
  const [selectedTier, setSelectedTier] = useState<SubscriptionTierId>(() => {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(TIER_STORAGE_KEY) as SubscriptionTierId | null;
      if (saved && SUBSCRIPTION_PRESETS[saved]) return saved;
    }
    return 'pro';
  });
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // Auto-fetch latest live quota on mount, and refresh on manual sync or stats update
  useEffect(() => {
    let isMounted = true;
    const refreshQuota = async (force = false) => {
      const quota = await tryFetchLiveQuotaFromHost(force);
      if (isMounted && quota) {
        setLiveQuota(quota);
      }
    };

    refreshQuota(true);

    const handleSync = () => refreshQuota(true);
    const handleStatsUpdated = () => refreshQuota(false);

    window.addEventListener(EVENT_REQUEST_SYNC, handleSync);
    window.addEventListener(EVENT_STATS_UPDATED, handleStatsUpdated);

    return () => {
      isMounted = false;
      window.removeEventListener(EVENT_REQUEST_SYNC, handleSync);
      window.removeEventListener(EVENT_STATS_UPDATED, handleStatsUpdated);
    };
  }, []);

  const metrics = useMemo(
    () => computeQuotaCycleMetrics(stats, liveQuota, selectedTier, nowMs),
    [stats, liveQuota, selectedTier, nowMs]
  );

  const setTier = (tier: SubscriptionTierId) => {
    setSelectedTier(tier);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(TIER_STORAGE_KEY, tier);
    }
  };

  return {
    liveQuota,
    selectedTier,
    setTier,
    metrics,
    plan: SUBSCRIPTION_PRESETS[selectedTier] || SUBSCRIPTION_PRESETS.pro,
    nowMs,
  };
}
