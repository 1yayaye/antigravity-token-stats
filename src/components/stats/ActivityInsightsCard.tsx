import React from 'react';
import { ActivityInsights, KpiMetrics } from '../../domain/stats.types';
import { useLanguage } from '../../i18n/LanguageContext';

interface ActivityInsightsCardProps {
  insights: ActivityInsights;
  kpis: KpiMetrics;
}

export const ActivityInsightsCard: React.FC<ActivityInsightsCardProps> = ({ insights, kpis }) => {
  const { lang, t } = useLanguage();

  const formattedReasoning = insights.mostUsedReasoning === 'N/A' ? '—' : insights.mostUsedReasoning;

  const rows = [
    { label: t('kpiPeakTokens'), value: kpis.peakTokens },
    { label: t('kpiLongestTask'), value: kpis.longestTask },
    { label: t('kpiCurrentStreak'), value: `${kpis.currentStreak} ${t('days')}` },
    { label: t('kpiLongestStreak'), value: `${kpis.longestStreak} ${t('days')}` },
    { label: t('fastMode'), value: insights.fastMode },
    { label: t('mostUsedReasoning'), value: formattedReasoning },
    { label: t('skillsExplored'), value: String(insights.skillsExplored) },
    { label: t('totalSkillsUsed'), value: new Intl.NumberFormat(lang === 'zh' ? 'zh-CN' : 'en-US').format(insights.totalSkillsUsed) },
    { label: t('totalThreads'), value: new Intl.NumberFormat(lang === 'zh' ? 'zh-CN' : 'en-US').format(insights.totalThreads) },
  ];

  return (
    <section className="py-5 border-t border-card-border">
      <h3 className="text-sm font-bold text-foreground mb-3">{t('activityInsightsTitle')}</h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
        {rows.map((row, index) => (
          <div
            key={index}
            className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 border-b border-card-border/50 min-w-0"
          >
            <span className="text-xs text-muted-foreground font-normal">{row.label}</span>
            <span className="text-xs font-semibold text-foreground break-words max-w-full tabular-nums">
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
};
