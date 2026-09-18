import React from 'react';
import { TokenBreakdown } from '../../domain/stats.types';
import { formatTokens } from '../../services/stats-service';
import { useLanguage } from '../../i18n/LanguageContext';

export const TokenBreakdownCard: React.FC<{ breakdown?: TokenBreakdown }> = ({ breakdown }) => {
  const { t } = useLanguage();

  if (!breakdown) {
    return (
      <section className="py-5 border-b border-card-border" aria-label={t('tokenBreakdownTitle')}>
        <h2 className="text-sm font-semibold mb-4 text-foreground">{t('tokenBreakdownTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('incompleteBreakdown')}</p>
      </section>
    );
  }

  const values = {
    cacheRead: Math.max(0, breakdown.cacheReadTokens || 0),
    rawInput: Math.max(0, breakdown.inputTokens || 0),
    thinking: Math.max(0, breakdown.thinkingTokens || 0),
    response: Math.max(0, breakdown.responseTokens || 0),
  };
  const inputTotal = values.cacheRead + values.rawInput;
  const outputTotal = values.thinking + values.response;
  const share = (value: number, total: number) => total > 0 ? `${((value / total) * 100).toFixed(1)}%` : '—';

  const inputRows = [
    { label: t('cacheReadLabel'), value: values.cacheRead, color: '#34b8ac' },
    { label: t('rawInputLabel'), value: values.rawInput, color: '#699ef5' },
  ];
  const outputRows = [
    { label: t('thinkingTokensLabel'), value: values.thinking, color: '#b791e8' },
    { label: t('responseTokensLabel'), value: values.response, color: '#e8b867' },
  ];
  const renderRows = (rows: typeof inputRows, total: number) => rows.map(row => (
    <div key={row.label} className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-2 py-1.5">
      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: row.color }} aria-hidden="true" />
      <span className="text-xs sm:text-sm text-foreground truncate">{row.label}</span>
      <span className="text-xs sm:text-sm font-semibold text-foreground tabular-nums">{formatTokens(row.value)}</span>
      <span className="text-xs text-muted-foreground tabular-nums min-w-[3.2rem] text-right">{share(row.value, total)}</span>
    </div>
  ));

  return (
    <section className="py-5 border-b border-card-border" aria-label={t('tokenBreakdownTitle')}>
      <header className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-foreground">{t('tokenBreakdownTitle')}</h2>
        <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold bg-[#34b8ac]/10 text-[#34b8ac] border border-[#34b8ac]/25">
          ⚡ {t('cacheHitRateBadge')} {inputTotal > 0 ? share(values.cacheRead, inputTotal) : (breakdown.cacheHitRate || '0%')}
        </span>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="p-3.5 rounded-lg border border-card-border/60 bg-card/40">
          <h3 className="flex items-center justify-between text-xs font-semibold text-foreground mb-2 pb-2 border-b border-card-border/40">
            {t('inputChannelTitle')}<span className="font-normal text-[11px] text-muted-foreground">{t('shareOfInput')}</span>
          </h3>
          {renderRows(inputRows, inputTotal)}
        </div>
        <div className="p-3.5 rounded-lg border border-card-border/60 bg-card/40">
          <h3 className="flex items-center justify-between text-xs font-semibold text-foreground mb-2 pb-2 border-b border-card-border/40">
            {t('outputChannelTitle')}<span className="font-normal text-[11px] text-muted-foreground">{t('shareOfOutput')}</span>
          </h3>
          {renderRows(outputRows, outputTotal)}
        </div>
      </div>
    </section>
  );
};
