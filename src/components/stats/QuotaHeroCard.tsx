import React from 'react';
import { AggregatedStats } from '../../domain/stats.types';
import { QuotaPoolId, SubscriptionTierId } from '../../domain/pricing.types';
import { useLanguage } from '../../i18n/LanguageContext';
import { useQuotaMetrics } from './useQuotaMetrics';

const RING_SIZE = 60;
const RING_RADIUS = 26.5;
const RING_STROKE = 4.5;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS; // ~166.504

interface RadialRingProps {
  fraction: number;
  label: string;
  gradientId: string;
  startColor: string;
  endColor: string;
  pctText: string;
}

const RadialRing: React.FC<RadialRingProps> = ({ fraction, label, gradientId, startColor, endColor, pctText }) => {
  const clampedFraction = Math.min(1, Math.max(0, fraction));
  const dash = clampedFraction * RING_CIRCUMFERENCE;
  return (
    <div className="ring-svg-wrap">
      <svg
        width={RING_SIZE}
        height={RING_SIZE}
        viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
        role="img"
        aria-label={`${label} ${pctText}`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={startColor} />
            <stop offset="100%" stopColor={endColor} />
          </linearGradient>
        </defs>
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          fill="none"
          stroke="var(--ring-track)"
          strokeWidth={RING_STROKE}
        />
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={RING_STROKE}
          strokeLinecap={dash > 0.5 ? 'round' : 'butt'}
          strokeDasharray={`${dash.toFixed(1)} ${RING_CIRCUMFERENCE.toFixed(1)}`}
          transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
          style={{ transition: 'stroke-dasharray 350ms cubic-bezier(0.16, 1, 0.3, 1)' }}
        />
      </svg>
      <div className="ring-inner-stat" aria-hidden="true">
        <span className="ring-inner-num tabular-nums">{pctText}</span>
      </div>
    </div>
  );
};

interface WeeklyPoolRenderConfig {
  pool: QuotaPoolId;
  titleKey: 'weeklyGeminiTitle' | 'weeklyClaudeTitle' | 'weeklyArgonTitle';
  gradientId: string;
  startColor: string;
  endColor: string;
  usedId: string;
  capId: string;
}

const WEEKLY_POOL_CONFIGS: WeeklyPoolRenderConfig[] = [
  {
    pool: 'gemini',
    titleKey: 'weeklyGeminiTitle',
    gradientId: 'ringWeekGrad',
    startColor: '#10b981',
    endColor: '#3b82f6',
    usedId: 'ringWeekUsed',
    capId: 'ringWeekCap',
  },
  {
    pool: 'claude',
    titleKey: 'weeklyClaudeTitle',
    gradientId: 'ringClaudeGrad',
    startColor: '#f59e0b',
    endColor: '#ea580c',
    usedId: 'ringClaudeWeekUsed',
    capId: 'ringClaudeWeekCap',
  },
  {
    pool: 'argon',
    titleKey: 'weeklyArgonTitle',
    gradientId: 'ringArgonGrad',
    startColor: '#06b6d4',
    endColor: '#6366f1',
    usedId: 'ringArgonWeekUsed',
    capId: 'ringArgonWeekCap',
  },
];

export const QuotaHeroCard: React.FC<{ stats: AggregatedStats }> = ({ stats }) => {
  const { lang, t } = useLanguage();
  const { liveQuota, selectedTier, detectedTier, isAutoSelected, setTier, resetToAuto, metrics, plan } = useQuotaMetrics(stats);

  const visibleWeeklyPools = WEEKLY_POOL_CONFIGS.filter(cfg => Boolean(metrics.pools[cfg.pool].bucket));

  // User specification: If online quota is NOT captured (or no visible pool remains), do NOT show concrete content
  if (!liveQuota || visibleWeeklyPools.length === 0) {
    return null;
  }

  const monthlyCost = metrics.cappedMonthlyCostUsd ?? metrics.monthlyCostUsd;
  const monthlyCap = metrics.totalMonthlyCapUsd;
  const hasMonthlyCap = monthlyCap !== null && monthlyCap > 0;
  const monthlyFraction =
    monthlyCost !== null && hasMonthlyCap
      ? Math.min(1, Math.max(0, monthlyCost / monthlyCap))
      : 0;
  const monthlyPctVal =
    monthlyCost !== null && hasMonthlyCap
      ? Math.min(100, Math.round((monthlyCost / monthlyCap) * 1000) / 10)
      : null;
  const monthlyPctText = monthlyPctVal !== null
    ? `${monthlyPctVal % 1 === 0 ? monthlyPctVal : monthlyPctVal.toFixed(1)}%`
    : '—';

  const roiMultiplier =
    metrics.monthlyCostUsd === null
      ? null
      : plan.monthlyFeeUsd > 0
        ? (metrics.monthlyCostUsd / plan.monthlyFeeUsd).toFixed(1) + 'x'
        : '∞';

  return (
    <section className="bento-tile quota-card-row" aria-label={t('subscriptionQuotaTitle')}>
      <div className="quota-top-meta">
        <div className="ring-info-title-row">
          <span className="ring-col-title">{lang === 'zh' ? '本周配额已用' : t('weeklyQuota')}</span>
          <span
            className="w-1.5 h-1.5 rounded-full bg-[#10b981] animate-pulse"
            title={t('liveQuotaDetected')}
            aria-label={t('liveQuotaDetected')}
          />
        </div>
        <div className="flex items-center gap-1.5">
          {detectedTier && isAutoSelected && (
            <span
              id="quota-tier-auto-badge"
              className="track-pill-badge opacity-80"
              title={detectedTier.isUltraAmbiguous ? t('tierAutoUltraTooltip') : t('tierAutoTooltip')}
            >
              {t('tierAutoBadge')}
            </span>
          )}
          {detectedTier && !isAutoSelected && (
            <button
              id="quota-tier-reset-auto"
              type="button"
              onClick={resetToAuto}
              className="track-pill-badge cursor-pointer transition-colors hover:opacity-90"
              title={detectedTier.isUltraAmbiguous ? t('tierAutoUltraTooltip') : t('tierResetAutoTooltip')}
            >
              {t('tierResetAuto')}
            </button>
          )}
          <select
            id="quota-tier-select"
            value={selectedTier}
            onChange={e => setTier(e.target.value as SubscriptionTierId)}
            className="track-pill-badge cursor-pointer outline-none transition-colors"
            aria-label={t('selectPlan')}
          >
            <option value="pro">{t('tierPro')}</option>
            <option value="ultra_5x">{t('tierUltra5x')}</option>
            <option value="ultra_20x">{t('tierUltra20x')}</option>
            <option value="free">{t('tierFree')}</option>
          </select>
        </div>
      </div>

      <div className="view-dual-rings" role="region" aria-label={lang === 'zh' ? '多模型周配额与月容量视图' : t('subscriptionQuotaTitle')}>
        {visibleWeeklyPools.map(cfg => {
          const poolMetrics = metrics.pools[cfg.pool];
          const fraction = Math.min(1, Math.max(0, poolMetrics.usedFraction));
          const pct = Math.min(100, Math.round(fraction * 100));
          const title = t(cfg.titleKey);
          return (
            <div key={cfg.pool} className="ring-col">
              <RadialRing
                fraction={fraction}
                label={title}
                gradientId={cfg.gradientId}
                startColor={cfg.startColor}
                endColor={cfg.endColor}
                pctText={`${pct}%`}
              />
              <div className="ring-col-info">
                <div className="ring-info-title-row">
                  <span className="ring-col-title truncate">{title}</span>
                </div>
                <div className="ring-col-amount tabular-nums">
                  <strong id={cfg.usedId}>
                    {poolMetrics.weeklyCostUsd === null ? '—' : `$${poolMetrics.weeklyCostUsd.toFixed(2)}`}
                  </strong>
                  {' / '}
                  <span className="text-muted-foreground" id={cfg.capId}>
                    {poolMetrics.totalWeeklyCapUsd === null ? '~' : `~$${poolMetrics.totalWeeklyCapUsd.toFixed(2)}`}
                  </span>
                </div>
              </div>
            </div>
          );
        })}

        {/* Subtle divider between weekly model pools and 4-week aggregate */}
        <div className="ring-vertical-divider" aria-hidden="true" />

        {/* Right column: Monthly Extrapolated Capacity */}
        <div className="ring-col ring-col-summary">
          <RadialRing
            fraction={monthlyFraction}
            label={lang === 'zh' ? '4周容量' : t('monthlyQuotaShort')}
            gradientId="ringMonthGrad"
            startColor="#3b82f6"
            endColor="#8b5cf6"
            pctText={monthlyPctText}
          />
          <div className="ring-col-info">
            <div className="ring-info-title-row">
              <span className="ring-col-title truncate">{lang === 'zh' ? '4周折算总容量' : `${t('monthlyQuotaShort')} · 4w`}</span>
              <span className="track-pill-badge badge-primary tabular-nums shrink-0" id="ringRoiBadge">
                {roiMultiplier !== null ? `${roiMultiplier} ROI` : '—'}
              </span>
            </div>
            <div className="ring-col-amount tabular-nums">
              <strong id="ringMonthUsed">
                {metrics.monthlyCostUsd === null
                  ? '—'
                  : `${metrics.isMonthlyExtrapolated ? '~' : ''}$${metrics.monthlyCostUsd.toFixed(2)}`}
              </strong>
              {' / '}
              <span className="text-muted-foreground" id="ringMonthCap">
                {metrics.totalMonthlyCapUsd === null ? '~' : `~$${metrics.totalMonthlyCapUsd.toFixed(2)}`}
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
