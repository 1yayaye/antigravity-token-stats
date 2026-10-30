import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { HeatmapCell, TimeRange } from '../../domain/stats.types';
import { formatTokens } from '../../services/stats-service';
import { useLanguage } from '../../i18n/LanguageContext';

const RANGE_DAYS: Record<Exclude<TimeRange, 'all'>, number> = { today: 1, '1d': 2, '7d': 7, '30d': 30 };

const MIN_CHART_HEIGHT = 150;
const PAD = { top: 10, right: 10, bottom: 22, left: 44 };

// Round up to a 1/2/2.5/5 × 10^n step so gridline ticks stay round and even.
function niceCeil(value: number): number {
  if (value <= 0) return 0;
  const pow = Math.pow(10, Math.floor(Math.log10(value)));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (m * pow >= value) return m * pow;
  }
  return 10 * pow;
}

// Measure both axes so the chart can fill the tile when the bento row stretches it.
function useMeasuredSize(): [React.RefObject<HTMLDivElement | null>, { width: number; height: number }] {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size];
}

export const DailyTrendCard: React.FC<{ cells: HeatmapCell[]; timeRange: TimeRange }> = ({ cells, timeRange }) => {
  const { t } = useLanguage();
  const [containerRef, { width, height }] = useMeasuredSize();
  const chartHeight = Math.max(height, MIN_CHART_HEIGHT);

  const series = useMemo(() => {
    const sorted = [...cells].sort((a, b) => a.date.localeCompare(b.date));
    const count = timeRange === 'all' ? sorted.length : RANGE_DAYS[timeRange];
    return sorted.slice(-count).map(cell => ({ date: cell.date, tokens: cell.tokens }));
  }, [cells, timeRange]);

  const max = useMemo(() => series.reduce((m, d) => Math.max(m, d.tokens), 0), [series]);
  const hasData = series.length > 1 && max > 0;

  const chart = useMemo(() => {
    if (!hasData || width <= 0) return null;
    const plotW = width - PAD.left - PAD.right;
    const plotH = chartHeight - PAD.top - PAD.bottom;
    const top = niceCeil(max);
    const x = (i: number) => PAD.left + (i / (series.length - 1)) * plotW;
    const y = (v: number) => PAD.top + plotH - (v / top) * plotH;

    const points = series.map((d, i) => `${x(i).toFixed(1)},${y(d.tokens).toFixed(1)}`);
    const line = 'M' + points.join(' L');
    const area = `${line} L${x(series.length - 1).toFixed(1)},${(PAD.top + plotH).toFixed(1)} L${PAD.left},${(PAD.top + plotH).toFixed(1)} Z`;

    // 3-5 round gridlines including the zero baseline
    const step = top / 4;
    const ticks = [0, 1, 2, 3, 4].map(i => ({ value: i * step, y: y(i * step) }));

    // 4-6 x labels, evenly indexed (first and last included)
    const labelCount = Math.min(5, series.length);
    const labelIdx = Array.from({ length: labelCount }, (_, i) =>
      Math.round((i / (labelCount - 1)) * (series.length - 1))
    );
    const xLabels = [...new Set(labelIdx)].map(i => ({
      x: x(i),
      label: series[i].date.slice(5), // MM-DD
    }));

    const last = series.length - 1;
    return { line, area, ticks, xLabels, lastX: x(last), lastY: y(series[last].tokens) };
  }, [hasData, width, chartHeight, series, max]);

  return (
    <section className="bento-tile bento-trend" aria-label={t('dailyTrendTitle')}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <h2 className="text-sm font-semibold text-foreground">{t('dailyTrendTitle')}</h2>
        <span className="text-[11px] text-muted-foreground">{t('dailyTrendUnit')}</span>
      </div>
      <div ref={containerRef} className="flex-1 min-h-0">
        {!hasData ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">{t('noData')}</div>
        ) : chart ? (
          <svg
            width="100%"
            height={chartHeight}
            viewBox={`0 0 ${width} ${chartHeight}`}
            role="img"
            aria-label={t('dailyTrendTitle')}
            className="block"
          >
            <defs>
              <linearGradient id="daily-trend-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="var(--accent-primary)" stopOpacity="0.16" />
                <stop offset="1" stopColor="var(--accent-primary)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {chart.ticks.map(tick => (
              <g key={tick.value}>
                <line
                  x1={PAD.left}
                  x2={width - PAD.right}
                  y1={tick.y}
                  y2={tick.y}
                  stroke="var(--card-border)"
                  strokeWidth="1"
                />
                <text x={PAD.left - 6} y={tick.y + 3.5} textAnchor="end" fontSize="11" fill="currentColor" className="text-muted-foreground tabular-nums">
                  {formatTokens(tick.value)}
                </text>
              </g>
            ))}
            <path d={chart.area} fill="url(#daily-trend-fill)" />
            <path d={chart.line} fill="none" stroke="var(--accent-primary)" strokeWidth="2" strokeLinejoin="round" />
            <circle cx={chart.lastX} cy={chart.lastY} r="3" fill="var(--accent-primary)" />
            {chart.xLabels.map(l => (
              <text key={l.x} x={l.x} y={chartHeight - 6} textAnchor="middle" fontSize="11" fill="currentColor" className="text-muted-foreground tabular-nums">
                {l.label}
              </text>
            ))}
          </svg>
        ) : null}
      </div>
    </section>
  );
};
