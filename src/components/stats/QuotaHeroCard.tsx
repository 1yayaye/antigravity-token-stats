import React from 'react';
import { AggregatedStats } from '../../domain/stats.types';
import { SubscriptionTierId } from '../../domain/pricing.types';
import { formatResetCountdown } from '../../services/pricing-service';
import { useLanguage } from '../../i18n/LanguageContext';
import { useQuotaMetrics } from './useQuotaMetrics';

const SAVINGS_COLOR = '#10b981';
const RING_SIZE = 76;
const RING_RADIUS = 30;
const RING_STROKE = 5;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const QuotaRing: React.FC<{ fraction: number; label: string; color: string }> = ({ fraction, label, color }) => {
  const pct = Math.round(Math.min(1, Math.max(0, fraction)) * 1000) / 10;
  const dash = Math.min(1, Math.max(0, fraction)) * RING_CIRCUMFERENCE;
  return (
    <div className="quota-ring">
      <svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} role="img" aria-label={`${label} ${pct}%`}>
        <circle cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_RADIUS} fill="none" stroke="var(--ring-track)" strokeWidth={RING_STROKE} />
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          fill="none"
          stroke={color}
          strokeWidth={RING_STROKE}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${RING_CIRCUMFERENCE - dash}`}
          transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
        />
      </svg>
      <div className="quota-ring-center" aria-hidden="true">
        <span className="tabular-nums">{pct}%</span>
        <span className="quota-ring-label">{label}</span>
      </div>
    </div>
  );
};

export const QuotaHeroCard: React.FC<{ stats: AggregatedStats }> = ({ stats }) => {
  const { lang, t } = useLanguage();
  const { liveQuota, selectedTier, setTier, metrics, plan } = useQuotaMetrics(stats);

  // User specification: If online quota is NOT captured, do NOT show concrete content
  if (!liveQuota?.weeklyGemini) {
    return null;
  }

  const gemini = liveQuota.weeklyGemini;
  const monthlyFraction =
    metrics.monthlyCostUsd !== null && metrics.totalMonthlyCapUsd > 0
      ? metrics.monthlyCostUsd / metrics.totalMonthlyCapUsd
      : 0;
  const roiMultiplier =
    metrics.monthlyCostUsd === null
      ? '—'
      : plan.monthlyFeeUsd > 0
        ? (metrics.monthlyCostUsd / plan.monthlyFeeUsd).toFixed(1) + 'x'
        : '∞';
  const netSavingsUsd = Number(Math.max(0, (metrics.monthlyCostUsd ?? 0) - plan.monthlyFeeUsd).toFixed(2));

  return (
    <section className="bento-tile bento-hero" aria-label={t('subscriptionQuotaTitle')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">✨ {t('subscriptionQuotaTitle')}</h2>
          <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-[#10b981]/10 text-[#10b981] border border-[#10b981]/25 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] animate-pulse" />
            {t('liveQuotaDetected')}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="quota-tier-select" className="text-xs text-muted-foreground whitespace-nowrap">
            {t('planFee')}:
          </label>
          <select
            id="quota-tier-select"
            value={selectedTier}
            onChange={e => setTier(e.target.value as SubscriptionTierId)}
            className="text-xs bg-card/70 text-foreground border border-card-border rounded-lg px-2.5 py-1 outline-none cursor-pointer hover:border-foreground/30 transition-colors"
          >
            <option value="pro">{t('tierPro')}</option>
            <option value="ultra_5x">{t('tierUltra5x')}</option>
            <option value="ultra_20x">{t('tierUltra20x')}</option>
            <option value="free">{t('tierFree')}</option>
          </select>
        </div>
      </div>

      <div className="bento-hero-body">
        <div className="bento-hero-main">
          <div className="text-xs text-muted-foreground">{t('roiMultiple')}</div>
          <div className="text-4xl font-semibold tabular-nums leading-tight" style={{ color: SAVINGS_COLOR }}>
            {roiMultiplier}
          </div>
          <div className="text-sm tabular-nums" style={{ color: SAVINGS_COLOR }}>
            +${netSavingsUsd} {t('netSavingsBooked')}
          </div>
          <div className="text-[11px] text-muted-foreground tabular-nums">
            {t('quotaHeroBasis')}: {metrics.monthlyCostUsd === null ? '—' : `$${metrics.monthlyCostUsd.toFixed(2)}`} ÷ ${plan.monthlyFeeUsd}{t('perMonth')}
          </div>
        </div>

        <div className="bento-hero-divider" />

        <div className="bento-hero-quota">
          <QuotaRing fraction={monthlyFraction} label={t('monthlyQuotaShort')} color="var(--accent-primary)" />
          <div className="text-xs space-y-0.5 min-w-0">
            <div className="text-sm font-medium text-foreground">{t('monthlyQuotaShort')} · 4w</div>
            <div className="text-muted-foreground tabular-nums">
              {t('quotaUsedShort')}{' '}
              <span className="text-foreground">{metrics.monthlyCostUsd === null ? '—' : `${metrics.isMonthlyExtrapolated ? '~' : ''}$${metrics.monthlyCostUsd.toFixed(2)}`}</span>
            </div>
            <div className="text-muted-foreground tabular-nums">
              {t('quotaCapacityShort')} <span className="text-foreground">~${metrics.totalMonthlyCapUsd.toFixed(2)}</span>
            </div>
          </div>
        </div>

        <div className="bento-hero-divider" />

        <div className="bento-hero-quota">
          <QuotaRing fraction={gemini.usedFraction} label={t('weeklyQuotaShort')} color={SAVINGS_COLOR} />
          <div className="text-xs space-y-0.5 min-w-0">
            <div className="text-sm font-medium text-foreground">{t('weeklyQuota')}</div>
            <div className="text-muted-foreground tabular-nums">
              {t('quotaUsedShort')}{' '}
              <span className="text-foreground">{metrics.weeklyCostUsd === null ? '—' : `$${metrics.weeklyCostUsd.toFixed(2)}`}</span>
              {' / '}
              <span className="text-foreground">~${metrics.totalWeeklyCapUsd.toFixed(2)}</span>
            </div>
            <div className="text-muted-foreground tabular-nums">
              {t('resetCountdown')} {formatResetCountdown(gemini.resetTime, lang)}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
