import React, { useCallback, useRef } from 'react';
import { HeatmapCell } from '../../domain/stats.types';
import { useLanguage } from '../../i18n/LanguageContext';

export interface MonthHeaderItem {
  col: number;
  label: string;
  key: string;
}

export interface HeatmapDailyCalendarGridProps {
  calendar: HeatmapCell[];
  totalWeeks: number;
  monthHeaders: MonthHeaderItem[];
  todayKey: string;
  focusDate?: string;
  activeCell: {
    cell: HeatmapCell;
    isPinned: boolean;
  } | null;
  scrollRef?: React.Ref<HTMLDivElement>;
  onTriggerPopover: (cell: HeatmapCell, target: HTMLElement, pin: boolean) => void;
  onClearHoverPopover: () => void;
  onSetFocusedDate: (date: string) => void;
}

export const HeatmapDailyCalendarGrid: React.FC<HeatmapDailyCalendarGridProps> = ({
  calendar,
  totalWeeks,
  monthHeaders,
  todayKey,
  focusDate,
  activeCell,
  scrollRef,
  onTriggerPopover,
  onClearHoverPopover,
  onSetFocusedDate,
}) => {
  const { lang, t } = useLanguage();
  const localContainerRef = useRef<HTMLDivElement>(null);

  const formatNumber = useCallback((num: number) => new Intl.NumberFormat().format(num), []);

  const formatDate = useCallback(
    (dateStr: string) => {
      const d = new Date(`${dateStr}T00:00:00Z`);
      return d.toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', {
        timeZone: 'UTC',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    },
    [lang]
  );

  return (
    <div className="w-full" ref={localContainerRef}>
      <div
        ref={scrollRef}
        onScroll={() => {
          if (activeCell) {
            onClearHoverPopover();
          }
        }}
        className="w-full min-w-0 overflow-x-auto pb-1 [scrollbar-width:thin]"
      >
        <div className="flex gap-2 w-full min-w-[620px] py-1">
          {/* Left weekday labels aligned with rows */}
          <div
            className="grid gap-1 text-[10px] text-muted-foreground text-right pr-1 pt-6 shrink-0 select-none"
            style={{ gridTemplateRows: 'repeat(7, 20px)' }}
          >
            <span className="h-[20px] flex items-center justify-end leading-none">{lang === 'zh' ? '日' : 'Sun'}</span>
            <span className="h-[20px] flex items-center justify-end leading-none">{lang === 'zh' ? '一' : 'Mon'}</span>
            <span className="h-[20px] flex items-center justify-end leading-none">{lang === 'zh' ? '二' : 'Tue'}</span>
            <span className="h-[20px] flex items-center justify-end leading-none">{lang === 'zh' ? '三' : 'Wed'}</span>
            <span className="h-[20px] flex items-center justify-end leading-none">{lang === 'zh' ? '四' : 'Thu'}</span>
            <span className="h-[20px] flex items-center justify-end leading-none">{lang === 'zh' ? '五' : 'Fri'}</span>
            <span className="h-[20px] flex items-center justify-end leading-none">{lang === 'zh' ? '六' : 'Sat'}</span>
          </div>

          {/* Month Header Row + Cells Grid */}
          <div className="flex-1 min-w-0 flex flex-col">
            {/* Dynamic Aligned Month Headers */}
            <div
              className="grid gap-1 h-5 mb-1 relative select-none"
              style={{ gridTemplateColumns: `repeat(${totalWeeks}, minmax(13px, 1fr))` }}
            >
              {monthHeaders.map((header) => (
                <span
                  key={header.key}
                  style={{ gridColumnStart: header.col + 1 }}
                  className="text-[11px] font-semibold text-muted-foreground whitespace-nowrap"
                >
                  {header.label}
                </span>
              ))}
            </div>

            {/* Heatmap 7-row calendar grid */}
            <div
              className="grid gap-1"
              style={{
                gridTemplateColumns: `repeat(${totalWeeks}, minmax(13px, 1fr))`,
                gridTemplateRows: 'repeat(7, 20px)',
              }}
            >
              {calendar.map((cell, index) => {
                const isFuture = cell.date > todayKey;
                const isSelected = activeCell?.cell.date === cell.date;

                return (
                  <button
                    key={cell.date}
                    style={{
                      gridRow: cell.dayOfWeek + 1,
                      gridColumn: Math.floor(index / 7) + 1,
                    }}
                    data-cell-date={cell.date}
                    data-cell-level={cell.level}
                    type="button"
                    aria-label={`${formatDate(cell.date)}: ${formatNumber(cell.tokens)} ${t('tokensWord')}, ${cell.tasks} ${t('tasksExecuted')}`}
                    disabled={isFuture}
                    tabIndex={cell.date === focusDate ? 0 : -1}
                    onMouseEnter={(e) => {
                      if (!activeCell?.isPinned) {
                        onTriggerPopover(cell, e.currentTarget, false);
                      }
                    }}
                    onMouseLeave={() => {
                      if (!activeCell?.isPinned) {
                        onClearHoverPopover();
                      }
                    }}
                    onFocus={(e) => {
                      onSetFocusedDate(cell.date);
                      if (!activeCell?.isPinned) {
                        onTriggerPopover(cell, e.currentTarget, false);
                      }
                    }}
                    onBlur={() => {
                      if (!activeCell?.isPinned) {
                        onClearHoverPopover();
                      }
                    }}
                    onClick={(e) => {
                      onSetFocusedDate(cell.date);
                      onTriggerPopover(cell, e.currentTarget, true);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        onClearHoverPopover();
                        return;
                      }
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onTriggerPopover(cell, e.currentTarget, true);
                        return;
                      }
                      if (e.key === 'ArrowUp' && cell.dayOfWeek === 0) return;
                      if (e.key === 'ArrowDown' && cell.dayOfWeek === 6) return;

                      const offsetMap: Record<string, number> = {
                        ArrowLeft: -7,
                        ArrowRight: 7,
                        ArrowUp: -1,
                        ArrowDown: 1,
                      };
                      const offset = offsetMap[e.key];
                      if (offset === undefined) return;
                      e.preventDefault();

                      const nextCell = calendar[index + offset];
                      if (nextCell && nextCell.date <= todayKey) {
                        const btn = localContainerRef.current?.querySelector<HTMLButtonElement>(
                          `[data-cell-date="${nextCell.date}"]`
                        );
                        btn?.focus();
                      }
                    }}
                    className={`w-full h-[20px] min-w-[13px] min-h-[20px] border-0 p-0 rounded-[3.5px] cell-interactive cursor-pointer disabled:opacity-20 disabled:cursor-default heat-cell-${cell.level} ${
                      isSelected ? 'is-selected ring-2 ring-[var(--accent-primary)]' : ''
                    }`}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
