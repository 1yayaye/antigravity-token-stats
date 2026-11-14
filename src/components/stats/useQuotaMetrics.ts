import { useEffect, useMemo, useState } from 'react';
import { AggregatedStats } from '../../domain/stats.types';
import {
  DetectedAccountTier,
  LiveQuotaSummary,
  SubscriptionTierConfig,
  SubscriptionTierId,
} from '../../domain/pricing.types';
import {
  computeQuotaCycleMetrics,
  QuotaCycleMetrics,
  SUBSCRIPTION_PRESETS,
} from '../../services/pricing-service';
import { EVENT_QUOTA_UPDATED, WINDOW_LIVE_QUOTA } from '../../injection-contract.cjs';

const TIER_STORAGE_KEY = 'antigravity_selected_tier';
const TIER_OVERRIDE_KEY = 'antigravity_tier_override';

export interface TierOverrideRecord {
  tier: SubscriptionTierId;
  scopeKey: string;
}

export function buildTierScopeKey(detected: DetectedAccountTier): string {
  return `${detected.accountKey || 'anon'}:${detected.rawTierId || detected.tier}`;
}

function readSavedTier(): SubscriptionTierId {
  if (typeof localStorage === 'undefined') return 'pro';
  try {
    const saved = localStorage.getItem(TIER_STORAGE_KEY) as SubscriptionTierId | null;
    if (saved && SUBSCRIPTION_PRESETS[saved]) return saved;
  } catch {}
  return 'pro';
}

function readSavedOverride(): TierOverrideRecord | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(TIER_OVERRIDE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TierOverrideRecord> | null;
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.scopeKey === 'string' &&
      parsed.tier &&
      SUBSCRIPTION_PRESETS[parsed.tier]
    ) {
      return { tier: parsed.tier, scopeKey: parsed.scopeKey };
    }
  } catch {}
  return null;
}

export function resolveEffectiveTier(
  detected: DetectedAccountTier | null | undefined,
  savedTier: SubscriptionTierId,
  override: TierOverrideRecord | null
): { selectedTier: SubscriptionTierId; isAutoSelected: boolean } {
  if (detected && SUBSCRIPTION_PRESETS[detected.tier]) {
    const scopeKey = buildTierScopeKey(detected);
    if (override && override.scopeKey === scopeKey && SUBSCRIPTION_PRESETS[override.tier]) {
      return { selectedTier: override.tier, isAutoSelected: false };
    }
    return { selectedTier: detected.tier, isAutoSelected: true };
  }
  return {
    selectedTier: SUBSCRIPTION_PRESETS[savedTier] ? savedTier : 'pro',
    isAutoSelected: false,
  };
}

export interface QuotaMetrics {
  liveQuota: LiveQuotaSummary | null;
  selectedTier: SubscriptionTierId;
  detectedTier: DetectedAccountTier | null;
  isAutoSelected: boolean;
  setTier: (tier: SubscriptionTierId) => void;
  resetToAuto: () => void;
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
  const [savedTier, setSavedTier] = useState<SubscriptionTierId>(readSavedTier);
  const [override, setOverride] = useState<TierOverrideRecord | null>(readSavedOverride);
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

  const detectedTier = liveQuota?.detectedAccountTier ?? null;
  const { selectedTier, isAutoSelected } = useMemo(
    () => resolveEffectiveTier(detectedTier, savedTier, override),
    [detectedTier, savedTier, override]
  );

  // Keep TIER_STORAGE_KEY warm with the auto-detected tier so initial renders match before quota syncs.
  useEffect(() => {
    if (!isAutoSelected) return;
    if (typeof localStorage !== 'undefined') {
      try { localStorage.setItem(TIER_STORAGE_KEY, selectedTier); } catch {}
    }
  }, [isAutoSelected, selectedTier]);

  const metrics = useMemo(
    () => computeQuotaCycleMetrics(stats, liveQuota, selectedTier, nowMs),
    [stats, liveQuota, selectedTier, nowMs]
  );

  const setTier = (tier: SubscriptionTierId) => {
    setSavedTier(tier);
    if (typeof localStorage !== 'undefined') {
      try { localStorage.setItem(TIER_STORAGE_KEY, tier); } catch {}
    }
    if (detectedTier) {
      if (tier === detectedTier.tier) {
        setOverride(null);
        if (typeof localStorage !== 'undefined') {
          try { localStorage.removeItem(TIER_OVERRIDE_KEY); } catch {}
        }
      } else {
        const nextOverride: TierOverrideRecord = { tier, scopeKey: buildTierScopeKey(detectedTier) };
        setOverride(nextOverride);
        if (typeof localStorage !== 'undefined') {
          try { localStorage.setItem(TIER_OVERRIDE_KEY, JSON.stringify(nextOverride)); } catch {}
        }
      }
    }
  };

  const resetToAuto = () => {
    setOverride(null);
    if (typeof localStorage !== 'undefined') {
      try { localStorage.removeItem(TIER_OVERRIDE_KEY); } catch {}
    }
    if (detectedTier && SUBSCRIPTION_PRESETS[detectedTier.tier]) {
      setSavedTier(detectedTier.tier);
      if (typeof localStorage !== 'undefined') {
        try { localStorage.setItem(TIER_STORAGE_KEY, detectedTier.tier); } catch {}
      }
    }
  };

  return {
    liveQuota,
    selectedTier,
    detectedTier,
    isAutoSelected,
    setTier,
    resetToAuto,
    metrics,
    plan: SUBSCRIPTION_PRESETS[selectedTier] || SUBSCRIPTION_PRESETS.pro,
    nowMs,
  };
}
