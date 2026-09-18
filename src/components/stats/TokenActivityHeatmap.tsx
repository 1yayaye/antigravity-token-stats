import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { HeatmapCell, DailyStatEntry } from '../../domain/stats.types';
import { buildActivityHistory } from '../../services/activity-history';
import { useLanguage } from '../../i18n/LanguageContext';
import { HeatmapDayDetailPopover } from './HeatmapDayDetailPopover';
import { HeatmapDailyCalendarGrid } from './HeatmapDailyCalendarGrid';

interface TokenActivityHeatmapProps {
  cells: HeatmapCell[];
  dailyStats?: Record<string, DailyStatEntry>;
}

export const TokenActivityHeatmap: React.FC<TokenActivityHeatmapProps> = ({ cells, dailyStats }) => {
  const { lang, t } = useLanguage();
  const cardRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [focusedDate, setFocusedDate] = useState<string>();

  // Active popover state
  const [activeCell, setActiveCell] = useState<{
    cell: HeatmapCell;
    x: number;
    y: number;
    isPinned: boolean;
  } | null>(null);

  const history = useMemo(() => buildActivityHistory(cells, dailyStats), [cells, dailyStats]);
  const currentMonth = history.days.at(-1)?.month || '';

  // Construct calendar range covering the last ~6 months, padded from Sunday to Saturday
  const calendar = useMemo(() => {
    if (!currentMonth) return [];
    const [year, month] = currentMonth.split('-').map(Number);
    const byDate = new Map(history.days.map((cell) => [cell.date, cell]));
    const start = new Date(year, month - 7, 1);
    start.setDate(start.getDate() - start.getDay()); // Snap to Sunday
    const end = new Date(year, month, 0);
    end.setDate(end.getDate() + (6 - end.getDay())); // Snap to Saturday

    const result: HeatmapCell[] = [];
    for (const dateValue = new Date(start); dateValue <= end; dateValue.setDate(dateValue.getDate() + 1)) {
      const date = `${dateValue.getFullYear()}-${String(dateValue.getMonth() + 1).padStart(2, '0')}-${String(dateValue.getDate()).padStart(2, '0')}`;
      const entry = byDate.get(date);
      if (entry) {
        result.push(entry);
      } else {
        const detail = dailyStats?.[date];
        result.push({
          date,
          month: date.slice(0, 7),
          dayOfWeek: dateValue.getDay(),
          tokens: 0,
          tasks: 0,
          level: 0,
          detail,
        });
      }
    }
    return result;
  }, [currentMonth, history.days, dailyStats]);

  const today = useMemo(() => new Date(), []);
  const todayKey = useMemo(
    () => `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`,
    [today]
  );

  const focusDate = calendar.some((cell) => cell.date === focusedDate)
    ? focusedDate
    : calendar.filter((cell) => cell.date <= todayKey).at(-1)?.date;

  // Auto-scroll calendar container to rightmost end on initial mount or month change
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      const scrollToEnd = () => {
        el.scrollLeft = el.scrollWidth;
      };
      scrollToEnd();
      const raf = requestAnimationFrame(scrollToEnd);
      return () => cancelAnimationFrame(raf);
    }
  }, [currentMonth]);

  // Dismiss popover on global Escape key, outside click, or window resize
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveCell(null);
      }
    };
    const handleClickOutside = (e: PointerEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        setActiveCell(null);
      }
    };
    const handleResize = () => {
      setActiveCell(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handleClickOutside);
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handleClickOutside);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const totalWeeks = useMemo(() => Math.ceil(calendar.length / 7), [calendar.length]);

  // Aligned month header positions: precisely match each month's starting column
  const monthHeaders = useMemo(() => {
    const headers: { col: number; label: string; key: string }[] = [];
    if (!totalWeeks) return headers;

    for (let col = 0; col < totalWeeks; col++) {
      const colCells = calendar.slice(col * 7, (col + 1) * 7);
      const firstDayCell = colCells.find((c) => c.date.endsWith('-01'));
      if (firstDayCell && (firstDayCell.date <= todayKey || firstDayCell.month <= currentMonth)) {
        const d = new Date(`${firstDayCell.month}-01T00:00:00Z`);
        const label = d.toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', {
          timeZone: 'UTC',
          month: 'short',
        });
        headers.push({ col, label, key: `${firstDayCell.month}-${col}` });
      }
    }

    // If no month boundaries detected, show initial month at col 0
    if (calendar[0]) {
      if (headers.length === 0) {
        const initialMonth = calendar[0].month;
        const d = new Date(`${initialMonth}-01T00:00:00Z`);
        const label = d.toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', {
          timeZone: 'UTC',
          month: 'short',
        });
        headers.push({ col: 0, label, key: `${initialMonth}-0` });
      } else if (headers[0].col >= 3) {
        const initialMonth = calendar[0].month;
        const d = new Date(`${initialMonth}-01T00:00:00Z`);
        const label = d.toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', {
          timeZone: 'UTC',
          month: 'short',
        });
        headers.unshift({ col: 0, label, key: `${initialMonth}-0` });
      }
    }

    return headers;
  }, [calendar, totalWeeks, lang, currentMonth, todayKey]);

  const getMonthLabel = useCallback(
    (month: string) => {
      return new Date(`${month}-01T00:00:00Z`).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', {
        timeZone: 'UTC',
        year: 'numeric',
        month: 'short',
      });
    },
    [lang]
  );

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

  const triggerCellPopover = (cell: HeatmapCell, target: HTMLElement, pin = false) => {
    if (!cardRef.current) return;
    const rect = target.getBoundingClientRect();
    const cardRect = cardRef.current.getBoundingClientRect();
    const rawX = rect.left - cardRect.left + rect.width / 2;
    const rawY = rect.top - cardRect.top;

    const popoverHalfWidth = 140;
    const clampedX = cardRect.width <= popoverHalfWidth * 2 + 10
      ? cardRect.width / 2
      : Math.max(popoverHalfWidth + 5, Math.min(cardRect.width - popoverHalfWidth - 5, rawX));

    setActiveCell((prev) => {
      if (pin && prev?.isPinned && prev.cell.date === cell.date) {
        return null;
      }
      return {
        cell,
        x: clampedX,
        y: rawY,
        isPinned: pin,
      };
    });
  };

  if (!currentMonth || !calendar.length) {
    return (
      <section className="py-5">
        <h2 className="text-sm font-semibold text-foreground">{t('tokenActivityTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('noData')}</p>
      </section>
    );
  }

  return (
    <div
      ref={cardRef}
      className="rounded-xl border border-card-border bg-card p-4 sm:p-5 shadow-sm text-foreground relative select-none my-4"
    >
      {/* 1. Card Header: Title and calendar range */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div>
          <h2 className="text-sm font-bold text-foreground tracking-tight">{t('tokenActivityTitle')}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {`${getMonthLabel(calendar[0]?.month || currentMonth)} – ${getMonthLabel(currentMonth)}`}
          </p>
        </div>
      </div>

      <HeatmapDailyCalendarGrid
        calendar={calendar}
        totalWeeks={totalWeeks}
        monthHeaders={monthHeaders}
        todayKey={todayKey}
        focusDate={focusDate}
        activeCell={activeCell}
        scrollRef={scrollRef}
        onTriggerPopover={triggerCellPopover}
        onClearHoverPopover={() => {
          setActiveCell(null);
        }}
        onSetFocusedDate={setFocusedDate}
      />

      {/* 6. Footer: Legend & A11y Shortcuts */}
      <div className="flex flex-wrap items-center justify-between gap-3 mt-4 pt-3 border-t border-card-border/50 text-[11px] text-muted-foreground select-none">
        <div className="flex items-center gap-2">
          <span>{t('activityLevelsTitle')}</span>
          <div className="flex items-center gap-1.5 ml-1">
            <span className="text-[10px]">{t('less')}</span>
            {[0, 1, 2, 3, 4].map((lvl) => (
              <div
                key={lvl}
                title={`Level ${lvl} (${getTierBadge(lvl)})`}
                className={`w-3 h-3 rounded-[2.5px] shadow-xs cursor-help transition-transform hover:scale-125 heat-cell-${lvl}`}
              />
            ))}
            <span className="text-[10px]">{t('more')}</span>
          </div>
        </div>

        <div className="text-[10.5px] text-muted-foreground hidden sm:block">{t('keyboardNavHint')}</div>
      </div>

      {/* 7. Extracted Day Inspector Popover */}
      {activeCell && (
        <HeatmapDayDetailPopover
          cell={activeCell.cell}
          x={activeCell.x}
          y={activeCell.y}
          isPinned={activeCell.isPinned}
          onClose={() => setActiveCell(null)}
          dailyStat={dailyStats?.[activeCell.cell.date]}
        />
      )}
    </div>
  );
};
