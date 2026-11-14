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

// Memoized: range/theme changes re-render siblings, but this tile only depends on the
// filtered stats object identity.
const TokenSummaryTileImpl: React.FC<{ stats: AggregatedStats }> = ({ stats }) => {
  const { lang, t } = useLanguage();
  const breakdown = stats.tokenBreakdown;

  const channels = breakdown
    ? [
        {
          key: 'cacheRead',
          label: lang === 'zh' ? '上下文缓存 (Cache)' : t('cacheReadLabel'),
          value: Math.max(0, breakdown.cacheReadTokens || 0),
          formatted: breakdown.cacheReadTokensFormatted ?? '—',
          color: CHANNEL_COLORS.cacheRead,
        },
        {
          key: 'rawInput',
          label: lang === 'zh' ? '原始输入 (Prompt)' : t('rawInputLabel'),
          value: Math.max(0, breakdown.inputTokens || 0),
          formatted: breakdown.inputTokensFormatted ?? '—',
          color: CHANNEL_COLORS.rawInput,
          subDetail: `${t('inputChannelTitle')}: ${breakdown.totalPromptTokensFormatted ?? '—'}`,
        },
        {
          key: 'thinking',
          label: lang === 'zh' ? '深度思考 (Thinking)' : t('thinkingTokensLabel'),
          value: Math.max(0, breakdown.thinkingTokens || 0),
          formatted: breakdown.thinkingTokensFormatted ?? '—',
          color: CHANNEL_COLORS.thinking,
        },
        {
          key: 'response',
          label: lang === 'zh' ? '模型生成 (Output)' : t('responseTokensLabel'),
          value: Math.max(0, breakdown.responseTokens || 0),
          formatted: breakdown.responseTokensFormatted ?? '—',
          color: CHANNEL_COLORS.response,
          subDetail: `${t('outputChannelTitle')}: ${breakdown.outputTokensFormatted ?? '—'}`,
        },
      ]
    : [];

  const channelTotal = channels.reduce((sum, c) => sum + c.value, 0);
  const share = (value: number) => (channelTotal > 0 ? `${((value / channelTotal) * 100).toFixed(1)}%` : '—');

  return (
    <section className="bento-tile token-card-row" aria-label={t('periodSummary')}>
      {/* Top headline and cache hit rate badge */}
      <div className="token-top-meta">
        <div className="token-headline-wrap">
          <span className="token-headline-val tabular-nums">{stats.kpis.lifetimeTokens}</span>
          <span className="token-headline-unit">
            Tokens ({t('kpiLifetimeTokens')} · {t('activeDays')} <strong className="font-semibold text-foreground tabular-nums">{stats.activity.activeDaysCount}</strong> {t('days')})
          </span>
        </div>
        {breakdown && (
          <span className="cache-rate-badge tabular-nums" id="cacheHitRateBadge">
            {breakdown.cacheHitRate || '0%'} {lang === 'zh' ? '缓存命中' : t('cacheHitSuffix')}
          </span>
        )}
      </div>

      {/* Full-width 4-segment slim distribution bar across 774px */}
      {breakdown && channels.length > 0 ? (
        <div
          className="channel-strip"
          role="img"
          aria-label={`${t('compositionByChannel')}: ${channels.map(c => `${c.label} ${share(c.value)}`).join(', ')}`}
          title={channels.map(c => `${c.label}: ${share(c.value)}`).join(' | ')}
        >
          {channels.map((c, i) => (
            <div
              key={c.key}
              className="channel-seg"
              style={{
                width: channelTotal > 0 ? `${(c.value / channelTotal) * 100}%` : '0%',
                backgroundColor: c.color,
                borderRadius: i === 0 ? '999px 0 0 999px' : i === channels.length - 1 ? '0 999px 999px 0' : undefined,
              }}
            />
          ))}
        </div>
      ) : null}

      {/* 4 Horizontal Channel Columns */}
      {breakdown ? (
        <div className="channel-legend-grid">
          {channels.map(c => (
            <div key={c.key} className="legend-cell min-w-0">
              <div className="legend-lbl-row">
                <span className="legend-color-dot" style={{ backgroundColor: c.color }} aria-hidden="true" />
                <span className="truncate">{c.label}</span>
              </div>
              <span className="legend-val-row tabular-nums">{c.formatted}</span>
              <span className="legend-pct-row tabular-nums truncate">
                {lang === 'zh' ? '占比 ' : ''}{share(c.value)}
                {c.subDetail ? ` · ${c.subDetail}` : ''}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-sm text-muted-foreground py-2">{t('incompleteBreakdown')}</div>
      )}
    </section>
  );
};

export const TokenSummaryTile = React.memo(TokenSummaryTileImpl);
