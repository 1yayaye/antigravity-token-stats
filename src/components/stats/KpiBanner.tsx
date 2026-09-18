import React from 'react';
import { AggregatedStats } from '../../domain/stats.types';
import { useLanguage } from '../../i18n/LanguageContext';

export const KpiBanner: React.FC<{ stats: AggregatedStats }> = ({ stats }) => {
  const { lang, t } = useLanguage();
  const breakdown = stats.tokenBreakdown;
  const items = [
    { value: stats.kpis.lifetimeTokens, exact: stats.kpis.lifetimeTokensRaw, label: t('kpiLifetimeTokens') },
    { value: breakdown?.totalPromptTokensFormatted ?? '—', exact: breakdown?.totalPromptTokens, label: t('inputChannelTitle') },
    { value: breakdown?.outputTokensFormatted ?? '—', exact: breakdown?.outputTokens, label: t('outputChannelTitle') },
    { value: String(stats.activity.activeDaysCount), exact: stats.activity.activeDaysCount, label: t('activeDays') },
  ];
  return (
    <section aria-label={t('periodSummary')} className="kpi-banner grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-5 py-5 border-b border-card-border min-w-0 text-center">
      {items.map(item => (
        <div key={item.label} className="min-w-0 flex flex-col items-center text-center">
          <div className="text-xs text-muted-foreground mb-1">{item.label}</div>
          <span tabIndex={0} className="stats-detail text-2xl font-bold tabular-nums" aria-label={`${item.label}: ${item.exact ?? t('incompleteBreakdown')}`}>
            {item.value}
            <span role="tooltip">{item.exact === undefined ? t('incompleteBreakdown') : new Intl.NumberFormat(lang === 'zh' ? 'zh-CN' : 'en-US').format(item.exact)}</span>
          </span>
        </div>
      ))}
    </section>
  );
};
