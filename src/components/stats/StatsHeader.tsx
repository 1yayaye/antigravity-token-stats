import React from 'react';
import { TimeRange } from '../../domain/stats.types';
import { useLanguage } from '../../i18n/LanguageContext';

interface StatsHeaderProps {
  timeRange: TimeRange;
  onTimeRangeChange: (range: TimeRange) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
}

export const StatsHeader: React.FC<StatsHeaderProps> = ({ timeRange, onTimeRangeChange, onRefresh, isRefreshing }) => {
  const { lang, toggleLang, t } = useLanguage();
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-card-border shrink-0">
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-bold text-foreground">{t('statsTitle')}</h1>
        <span className="stats-detail" tabIndex={0} aria-label={t('periodBasis')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v5M12 8h.01" />
          </svg>
          <span role="tooltip">{t('periodBasis')}</span>
        </span>
      </div>
      <div className="flex flex-nowrap items-center gap-2 shrink-0 mr-9">
        <select
          aria-label={t('timeRangeLabel')}
          value={timeRange}
          onChange={event => onTimeRangeChange(event.target.value as TimeRange)}
          className="h-9 max-w-full px-2 text-sm bg-card text-foreground border border-card-border rounded-md"
        >
          {(['today', '1d', '7d', '30d', 'all'] as TimeRange[]).map(range => (
            <option key={range} value={range}>{t(`timeRange_${range}`)}</option>
          ))}
        </select>
        <div className="flex items-center gap-2 shrink-0">
          <button className="stats-icon-button" onClick={toggleLang} aria-label={t('switchLanguage')} title={lang === 'zh' ? 'Switch to English' : '切换为中文'}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
            </svg>
          </button>
          <button className="stats-icon-button" onClick={onRefresh} disabled={isRefreshing} aria-label={t('refreshTitle')} title={t('refreshTitle')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={isRefreshing ? 'animate-spin' : ''} aria-hidden="true">
              <path d="M20 11a8 8 0 0 0-14.7-4L4 9" />
              <path d="M4 4v5h5M4 13a8 8 0 0 0 14.7 4L20 15" />
              <path d="M20 20v-5h-5" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
};
