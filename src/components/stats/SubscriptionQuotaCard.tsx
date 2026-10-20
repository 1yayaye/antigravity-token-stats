import React, { useState, useEffect, useMemo } from 'react';
import { AggregatedStats } from '../../domain/stats.types';
import { LiveQuotaSummary, SubscriptionTierId } from '../../domain/pricing.types';
import {
  computeQuotaCycleMetrics,
  formatResetCountdown,
  SUBSCRIPTION_PRESETS,
  tryFetchLiveQuotaFromHost,
} from '../../services/pricing-service';
import { useLanguage } from '../../i18n/LanguageContext';

export interface SubscriptionQuotaCardProps {
  stats: AggregatedStats;
  liveQuotaOverride?: LiveQuotaSummary | null;
}

const EXCHANGE_RATE_CNY = 7.2;

export const SubscriptionQuotaCard: React.FC<SubscriptionQuotaCardProps> = ({
  stats,
  liveQuotaOverride,
}) => {
  const { lang, t } = useLanguage();
  const [liveQuota, setLiveQuota] = useState<LiveQuotaSummary | null>(() => {
    return liveQuotaOverride || (typeof window !== 'undefined' ? window.__ANTIGRAVITY_LIVE_QUOTA__ || null : null);
  });
  const [selectedTier, setSelectedTier] = useState<SubscriptionTierId>(() => {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('antigravity_selected_tier') as SubscriptionTierId | null;
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
    if (liveQuotaOverride !== undefined) {
      setLiveQuota(liveQuotaOverride);
      return;
    }
    let isMounted = true;
    const refreshQuota = async (force = false) => {
      const quota = await tryFetchLiveQuotaFromHost(force);
      if (isMounted && quota) {
        setLiveQuota(quota);
      }
    };

    // Force fresh fetch on mount
    refreshQuota(true);

    const handleSync = () => refreshQuota(true);
    const handleStatsUpdated = () => refreshQuota(false);

    window.addEventListener('antigravity:request-sync', handleSync);
    window.addEventListener('antigravity:stats-updated', handleStatsUpdated);

    return () => {
      isMounted = false;
      window.removeEventListener('antigravity:request-sync', handleSync);
      window.removeEventListener('antigravity:stats-updated', handleStatsUpdated);
    };
  }, [liveQuotaOverride]);

  const handleTierChange = (tier: SubscriptionTierId) => {
    setSelectedTier(tier);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('antigravity_selected_tier', tier);
    }
  };

  // Calculate current weekly cycle cost, 100% weekly quota capacity, and 4-week monthly value
  const {
    weeklyCostUsd,
    monthlyCostUsd,
    totalWeeklyCapUsd,
    totalMonthlyCapUsd,
    isMonthlyExtrapolated,
  } = useMemo(
    () => computeQuotaCycleMetrics(stats, liveQuota, selectedTier, nowMs),
    [stats, liveQuota, selectedTier, nowMs]
  );

  // User specification: If online quota is NOT captured, do NOT show concrete content
  if (!liveQuota?.weeklyGemini) {
    return null;
  }

  const gemini = liveQuota.weeklyGemini;
  const plan = SUBSCRIPTION_PRESETS[selectedTier] || SUBSCRIPTION_PRESETS.pro;

  // Real captured percentage from Google Cloud
  const usedPct = gemini ? Math.round(gemini.usedFraction * 1000) / 10 : 0;
  const remainingPct = gemini ? Math.round(gemini.remainingFraction * 1000) / 10 : 100;
  const resetCountdown = gemini ? formatResetCountdown(gemini.resetTime, lang) : '—';

  const roiMultiplier = monthlyCostUsd === null
    ? '—'
    : plan.monthlyFeeUsd > 0
      ? (monthlyCostUsd / plan.monthlyFeeUsd).toFixed(1) + 'x'
      : '∞';
  const netSavingsUsd = Number(Math.max(0, (monthlyCostUsd ?? 0) - plan.monthlyFeeUsd).toFixed(2));

  return (
    <section
      className="py-5 border-b border-card-border"
      aria-label={t('subscriptionQuotaTitle')}
    >
      {/* Header with Title and Plan Selector */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
            <span>✨</span> {t('subscriptionQuotaTitle')}
          </h2>
          <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-[#10b981]/10 text-[#10b981] border border-[#10b981]/25 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] animate-pulse" />
            {t('liveQuotaDetected')}
          </span>
        </div>

        {/* Plan Selector */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <label htmlFor="quota-tier-select" className="text-xs text-muted-foreground whitespace-nowrap">
            {t('planFee')}:
          </label>
          <select
            id="quota-tier-select"
            value={selectedTier}
            onChange={(e) => handleTierChange(e.target.value as SubscriptionTierId)}
            className="text-xs bg-card/70 text-foreground border border-card-border rounded-lg px-2.5 py-1 outline-none cursor-pointer hover:border-foreground/30 transition-colors"
          >
            <option value="pro">{t('tierPro')}</option>
            <option value="ultra_5x">{t('tierUltra5x')}</option>
            <option value="ultra_20x">{t('tierUltra20x')}</option>
            <option value="free">{t('tierFree')}</option>
          </select>
        </div>
      </header>

      {/* Main Dual-Column Quota & Value Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Column 1: Weekly Quota Capacity & Progress */}
        <div className="p-4 rounded-xl border border-card-border/60 bg-card/40 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <span>📅</span> {t('weeklyQuota')}
              </span>
              <span className="text-[11px] font-medium text-muted-foreground bg-foreground/5 px-2 py-0.5 rounded-md">
                {t('resetCountdown')} {resetCountdown}
              </span>
            </div>

            {/* Progress Meter Bar */}
            <div className="my-3">
              <div className="flex justify-between text-xs mb-1">
                <span className="font-semibold text-foreground tabular-nums">
                  {t('usedPercent')} {usedPct}%
                </span>
                <span className="text-muted-foreground tabular-nums">
                  {t('remainingPercent')} {remainingPct}%
                </span>
              </div>
              <div className="w-full h-2.5 rounded-full bg-card-border/50 overflow-hidden relative">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min(100, Math.max(0, usedPct))}%`,
                    background: usedPct > 85 ? '#ef4444' : usedPct > 65 ? '#f59e0b' : '#3b82f6',
                  }}
                />
              </div>
            </div>

            {/* Detailed Values */}
            <div className="grid grid-cols-2 gap-2 mt-4 pt-3 border-t border-card-border/40 text-xs">
              <div>
                <span className="text-muted-foreground block mb-0.5">{t('weeklyCostConsumed')}</span>
                <span className="font-bold text-foreground text-base tabular-nums">
                  {weeklyCostUsd === null ? '—' : `$${weeklyCostUsd.toFixed(2)}`}
                </span>
                <span className="text-[11px] text-muted-foreground block tabular-nums">
                  {weeklyCostUsd === null ? '' : `≈ ¥${(weeklyCostUsd * EXCHANGE_RATE_CNY).toFixed(1)}`}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block mb-0.5">{t('weeklyCapEst')}</span>
                <span className="font-bold text-foreground text-base tabular-nums">
                  ~${totalWeeklyCapUsd.toFixed(2)}
                </span>
                <span className="text-[11px] text-muted-foreground block tabular-nums">
                  ≈ ¥{(totalWeeklyCapUsd * EXCHANGE_RATE_CNY).toFixed(1)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Column 2: Monthly Quota Capacity & ROI */}
        <div className="p-4 rounded-xl border border-card-border/60 bg-card/40 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <span>🏆</span> {t('monthlyQuota')}
              </span>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-[#3b82f6]/10 text-[#3b82f6] border border-[#3b82f6]/25 tabular-nums">
                {t('roiMultiple')}: {roiMultiplier}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 my-3 text-xs">
              <div>
                <span className="text-muted-foreground block mb-0.5">{t('monthlyCostConsumed')}</span>
                <span className="font-bold text-foreground text-xl tabular-nums">
                  {monthlyCostUsd === null ? '—' : `${isMonthlyExtrapolated ? '~' : ''}$${monthlyCostUsd.toFixed(2)}`}
                </span>
                <span className="text-[11px] text-muted-foreground block tabular-nums">
                  {monthlyCostUsd === null ? '' : `≈ ¥${(monthlyCostUsd * EXCHANGE_RATE_CNY).toFixed(1)}`}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block mb-0.5">{t('monthlyCapEst')}</span>
                <span className="font-bold text-foreground text-xl tabular-nums">
                  ~${totalMonthlyCapUsd.toFixed(2)}
                </span>
                <span className="text-[11px] text-muted-foreground block tabular-nums">
                  ≈ ¥{(totalMonthlyCapUsd * EXCHANGE_RATE_CNY).toFixed(1)}
                </span>
              </div>
            </div>

            {/* Savings & Plan Note */}
            <div className="mt-3 pt-3 border-t border-card-border/40 text-[11px] text-muted-foreground flex items-center justify-between">
              <span>{t('planFee')}: ${plan.monthlyFeeUsd}{t('perMonth')}</span>
              {netSavingsUsd > 0 && (
                <span className="text-[#10b981] font-semibold">
                  +${netSavingsUsd} {t('netSavingsBooked')}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Official Pricing Formula Transparency */}
      <footer className="mt-3 text-[11px] text-muted-foreground/80 flex items-center gap-1.5">
        <span className="text-[10px] px-1.5 py-0.2 rounded border border-card-border/60 font-mono">
          API
        </span>
        <span>{t('pricingFormulaNote')}</span>
      </footer>
    </section>
  );
};
