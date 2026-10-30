import React from 'react';
import { AggregatedStats } from '../../domain/stats.types';
import { useLanguage } from '../../i18n/LanguageContext';

// Channel colors mirror the --color-* tokens in index.css (constant across themes).
const CHANNEL_COLORS = {
  cacheRead: '#34b8ac',
  rawInput: '#699ef5',
  thinking: '#b791e8',
  response: '#e8b867',
};

export const TokenSummaryTile: React.FC<{ stats: AggregatedStats }> = ({ stats }) => {
  const { lang, t } = useLanguage();
  const breakdown = stats.tokenBreakdown;

  const items = [
    { value: stats.kpis.lifetimeTokens, exact: stats.kpis.lifetimeTokensRaw, label: t('kpiLifetimeTokens') },
    { value: breakdown?.totalPromptTokensFormatted ?? '—', exact: breakdown?.totalPromptTokens, label: t('inputChannelTitle') },
    { value: breakdown?.outputTokensFormatted ?? '—', exact: breakdown?.outputTokens, label: t('outputChannelTitle') },
    { value: String(stats.activity.activeDaysCount), exact: stats.activity.activeDaysCount, label: t('activeDays') },
  ];

  const channels = breakdown
    ? [
        { label: t('cacheReadLabel'), value: Math.max(0, breakdown.cacheReadTokens || 0), color: CHANNEL_COLORS.cacheRead },
        { label: t('rawInputLabel'), value: Math.max(0, breakdown.inputTokens || 0), color: CHANNEL_COLORS.rawInput },
        { label: t('thinkingTokensLabel'), value: Math.max(0, breakdown.thinkingTokens || 0), color: CHANNEL_COLORS.thinking },
        { label: t('responseTokensLabel'), value: Math.max(0, breakdown.responseTokens || 0), color: CHANNEL_COLORS.response },
      ]
    : [];
  const channelTotal = channels.reduce((sum, c) => sum + c.value, 0);
  const share = (value: number) => (channelTotal > 0 ? `${((value / channelTotal) * 100).toFixed(1)}%` : '—');

  return (
    <section className="bento-tile bento-token" aria-label={t('periodSummary')}>
      {items.map(item => (
        <div key={item.label} className="bento-token-seg min-w-0">
          <div className="text-xs text-muted-foreground whitespace-nowrap">{item.label}</div>
          <span
            tabIndex={0}
            className="stats-detail text-2xl font-semibold tabular-nums text-foreground"
            aria-label={`${item.label}: ${item.exact ?? t('incompleteBreakdown')}`}
          >
            {item.value}
            <span role="tooltip">{item.exact === undefined ? t('incompleteBreakdown') : new Intl.NumberFormat(lang === 'zh' ? 'zh-CN' : 'en-US').format(item.exact)}</span>
          </span>
        </div>
      ))}

      <div className="bento-token-viz min-w-0">
        <div className="text-xs text-muted-foreground">{t('compositionByChannel')}</div>
        {breakdown && channels.length ? (
          <>
            <div
              className="bento-track"
              role="img"
              aria-label={channels.map(c => `${c.label} ${share(c.value)}`).join(', ')}
            >
              {channels.map((c, i) => (
                <i
                  key={c.label}
                  style={{
                    width: channelTotal > 0 ? `${(c.value / channelTotal) * 100}%` : '0%',
                    backgroundColor: c.color,
                    borderRadius: i === 0 ? '4px 0 0 4px' : i === channels.length - 1 ? '0 4px 4px 0' : undefined,
                  }}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground tabular-nums">
              {channels.map(c => (
                <span key={c.label} className="inline-flex items-center gap-1 whitespace-nowrap">
                  <i className="w-2 h-2 rounded-sm inline-block" style={{ backgroundColor: c.color }} aria-hidden="true" />
                  {c.label} {share(c.value)}
                </span>
              ))}
            </div>
          </>
        ) : (
          <div className="text-sm text-muted-foreground">{t('incompleteBreakdown')}</div>
        )}
      </div>
    </section>
  );
};
