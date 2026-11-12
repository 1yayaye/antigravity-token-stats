import { useEffect, useMemo, useState } from 'react';
import { AggregatedStats } from '../../domain/stats.types';
import { LiveQuotaSummary, SubscriptionTierConfig, SubscriptionTierId } from '../../domain/pricing.types';
import {
  computeQuotaCycleMetrics,
  QuotaCycleMetrics,
  SUBSCRIPTION_PRESETS,
} from '../../services/pricing-service';
import { EVENT_QUOTA_UPDATED, WINDOW_LIVE_QUOTA } from '../../injection-contract.cjs';

const TIER_STORAGE_KEY = 'antigravity_selected_tier';

export interface QuotaMetrics {
  liveQuota: LiveQuotaSummary | null;
  selectedTier: SubscriptionTierId;
  setTier: (tier: SubscriptionTierId) => void;
  metrics: QuotaCycleMetrics;
  plan: SubscriptionTierConfig;
  nowMs: number;
}

// Hosts own quota retrieval; the view subscribes to snapshots and derives display metrics.
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

  useEffect(() => {
    const handleQuotaUpdated = () => {
      setLiveQuota((window as unknown as Record<string, LiveQuotaSummary | null | undefined>)[WINDOW_LIVE_QUOTA] || null);
    };
    window.addEventListener(EVENT_QUOTA_UPDATED, handleQuotaUpdated);
    handleQuotaUpdated();
    return () => window.removeEventListener(EVENT_QUOTA_UPDATED, handleQuotaUpdated);
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
