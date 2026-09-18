import React from 'react';
import { HeatmapCell, DailyStatEntry } from '../../domain/stats.types';
import { useLanguage } from '../../i18n/LanguageContext';

export interface HeatmapDayDetailPopoverProps {
  cell: HeatmapCell;
  x: number;
  y: number;
  isPinned: boolean;
  onClose: () => void;
  dailyStat?: DailyStatEntry;
}

export const HeatmapDayDetailPopover: React.FC<HeatmapDayDetailPopoverProps> = ({
  cell,
  x,
  y,
  isPinned,
  onClose,
  dailyStat,
}) => {
  const { lang, t } = useLanguage();

  const detail = cell.detail || dailyStat;
  const inputTokens = detail?.inputTokens ?? 0;
  const cacheReadTokens = detail?.cacheReadTokens ?? 0;
  const outputTokens = detail?.outputTokens ?? 0;
  const thinkingTokens = detail?.thinkingTokens ?? 0;
  const responseTokens = detail?.responseTokens ?? 0;

  const promptTotal = inputTokens + cacheReadTokens;
  const genTotal = outputTokens > 0 ? outputTokens : thinkingTokens + responseTokens;

  const cacheHitRate = promptTotal > 0 ? Math.min(100, Math.max(0, (cacheReadTokens / promptTotal) * 100)) : 0;
  const reasoningRate = genTotal > 0 ? Math.min(100, Math.max(0, (thinkingTokens / genTotal) * 100)) : 0;
  const hasDetailedChannels = promptTotal > 0 || genTotal > 0;

  // Auto flip downward if cell is near the top of the card
  const isFlipDown = y < 150;

  const formatNumber = (num: number) => new Intl.NumberFormat().format(num);

  const formatCompact = (num: number) => {
    if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(1) + 'B';
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
    if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K';
    return String(num);
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(`${dateStr}T00:00:00Z`);
    return d.toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', {
      timeZone: 'UTC',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatWeekday = (dateStr: string) => {
    const d = new Date(`${dateStr}T00:00:00Z`);
    return d.toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', {
      timeZone: 'UTC',
      weekday: 'long',
    });
  };

  const getTierBadge = (level: number) => {
    switch (level) {
      case 1:
        return t('tier1');
      case 2:
        return t('tier2');
      case 3:
        return t('tier3');
      case 4:
        return t('tier4');
      default:
        return t('tier0');
    }
  };

  return (
    <div
      role="tooltip"
      style={{
        position: 'absolute',
        left: `${x}px`,
        top: `${isFlipDown ? y + 26 : y - 10}px`,
        transform: isFlipDown ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
        width: '280px',
        maxWidth: 'calc(100vw - 32px)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
      }}
      className="z-50 appica-popover rounded-xl p-3.5 shadow-2xl text-foreground text-xs animate-in fade-in zoom-in-95 duration-100"
    >
      {/* Popover Header */}
      <div className="flex justify-between items-start mb-2">
        <div>
          <div className="font-bold text-foreground text-xs">{formatDate(cell.date)}</div>
          <div className="text-[10.5px] text-muted-foreground">{formatWeekday(cell.date)}</div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[var(--accent-primary-subtle)] text-[var(--accent-primary)] border border-[var(--accent-primary)]/20">
            {getTierBadge(cell.level)}
          </span>
          {isPinned && (
            <button
              type="button"
              aria-label={t('close')}
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground text-xs leading-none p-0.5 rounded cursor-pointer bg-transparent border-0"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Popover Hero Metric */}
      <div className="flex items-baseline justify-between mb-2.5 pb-2 border-b border-card-border/60">
        <div className="text-base font-extrabold text-foreground font-mono tabular-nums">
          {formatNumber(cell.tokens)}
          <span className="text-[10.5px] font-normal text-muted-foreground ml-1">{t('tokensWord')}</span>
        </div>
        <div className="text-[10.5px] text-muted-foreground">
          {cell.tasks > 0 ? `${cell.tasks} ${t('tasksExecuted')}` : t('noActivity')}
        </div>
      </div>

      {/* Dual-Channel Breakdown Meters */}
      {hasDetailedChannels && (
        <div className="flex flex-col gap-2 pt-0.5">
          {/* Channel A: Input (Cache Read vs Uncached) */}
          {promptTotal > 0 && (
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-[10.5px]">
                <span className="text-muted-foreground">{t('promptChannel')}</span>
                <span className="font-semibold font-mono" style={{ color: 'var(--color-cache)' }}>
                  {cacheHitRate.toFixed(1)}% {t('cacheHitSuffix')}
                </span>
              </div>
              <div className="h-1.5 w-full bg-muted/80 rounded-full overflow-hidden flex">
                <div
                  style={{ width: `${cacheHitRate}%`, backgroundColor: 'var(--color-cache)' }}
                  className="h-full transition-all duration-300"
                  title={t('cacheReadLabel')}
                />
                <div
                  style={{ width: `${100 - cacheHitRate}%`, backgroundColor: 'var(--color-input)' }}
                  className="h-full transition-all duration-300"
                  title={t('rawInputLabel')}
                />
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
                <span>
                  {formatCompact(cacheReadTokens)} {t('cacheReadLabel')}
                </span>
                <span>
                  {formatCompact(inputTokens)} {t('rawInputLabel')}
                </span>
              </div>
            </div>
          )}

          {/* Channel B: Output (Thinking vs Response) */}
          {genTotal > 0 && (
            <div className="flex flex-col gap-1 mt-0.5">
              <div className="flex justify-between text-[10.5px]">
                <span className="text-muted-foreground">{t('generationChannel')}</span>
                <span className="font-semibold font-mono" style={{ color: 'var(--color-thinking)' }}>
                  {reasoningRate.toFixed(1)}% {t('thinkingShareSuffix')}
                </span>
              </div>
              <div className="h-1.5 w-full bg-muted/80 rounded-full overflow-hidden flex">
                <div
                  style={{ width: `${reasoningRate}%`, backgroundColor: 'var(--color-thinking)' }}
                  className="h-full transition-all duration-300"
                  title={t('thinkingTokensLabel')}
                />
                <div
                  style={{ width: `${100 - reasoningRate}%`, backgroundColor: 'var(--color-response)' }}
                  className="h-full transition-all duration-300"
                  title={t('responseTokensLabel')}
                />
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
                <span>
                  {formatCompact(thinkingTokens)} {t('thinkingTokensLabel')}
                </span>
                <span>
                  {formatCompact(responseTokens)} {t('responseTokensLabel')}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
