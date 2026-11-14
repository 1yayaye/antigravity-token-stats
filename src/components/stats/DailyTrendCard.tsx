import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { HeatmapCell, TimeRange } from '../../domain/stats.types';
import { formatTokens, toLocalDateKey } from '../../services/stats-service';
import { useLanguage } from '../../i18n/LanguageContext';

const MIN_TREND_DAYS = 7;
const RANGE_DAYS: Record<Exclude<TimeRange, 'all'>, number> = { today: 7, '1d': 7, '7d': 7, '30d': 30 };

export function selectTrendSeries(cells: HeatmapCell[], timeRange: TimeRange): Array<{ date: string; tokens: number }> {
  const sorted = [...cells].sort((a, b) => a.date.localeCompare(b.date));
  const targetCount = timeRange === 'all'
    ? Math.max(MIN_TREND_DAYS, sorted.length)
    : Math.max(MIN_TREND_DAYS, RANGE_DAYS[timeRange] || MIN_TREND_DAYS);

  if (sorted.length >= targetCount) {
    return sorted.slice(-targetCount).map(cell => ({ date: cell.date, tokens: cell.tokens }));
  }

  // When cells has fewer than targetCount (e.g. < 7 days), pad to targetCount (min 7)
  // using consecutive calendar days ending on the latest available date or today.
  const cellMap = new Map<string, number>();
  for (const cell of sorted) {
    cellMap.set(cell.date, (cellMap.get(cell.date) ?? 0) + cell.tokens);
  }

  const todayKey = toLocalDateKey();
  const latestDate = sorted.length > 0 ? sorted[sorted.length - 1].date : todayKey;
  const parts = latestDate.split('-').map(Number);
  const [y, m, d] = parts.length === 3 && parts.every(Number.isFinite)
    ? parts
    : todayKey.split('-').map(Number);

  const series: Array<{ date: string; tokens: number }> = [];
  for (let i = targetCount - 1; i >= 0; i--) {
    const dt = new Date(y, m - 1, d - i);
    const dateKey = toLocalDateKey(dt);
    series.push({
      date: dateKey,
      tokens: cellMap.get(dateKey) ?? 0,
    });
  }
  return series;
}

const MIN_CHART_HEIGHT = 125;
const PAD = { top: 12, right: 16, bottom: 24, left: 44 };

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

// Memoized: only new heatmap cells or a range change should redraw the SVG.
const DailyTrendCardImpl: React.FC<{ cells: HeatmapCell[]; timeRange: TimeRange }> = ({ cells, timeRange }) => {
  const { lang, t } = useLanguage();
  const [containerRef, { width, height }] = useMeasuredSize();
  const chartHeight = Math.max(height, MIN_CHART_HEIGHT);

  const series = useMemo(() => selectTrendSeries(cells, timeRange), [cells, timeRange]);

  const max = useMemo(() => series.reduce((m, d) => Math.max(m, d.tokens), 0), [series]);
  const hasData = series.length > 1 && max > 0;

  const { avgTokens, peakTokens, peakDate } = useMemo(() => {
    if (!series.length) return { avgTokens: 0, peakTokens: 0, peakDate: '' };
    const sum = series.reduce((acc, d) => acc + d.tokens, 0);
    const avg = Math.round(sum / series.length);
    const peak = series.reduce((maxItem, d) => (d.tokens > maxItem.tokens ? d : maxItem), { date: '', tokens: 0 });
    return { avgTokens: avg, peakTokens: peak.tokens, peakDate: peak.date };
  }, [series]);

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
    <section className="bento-tile trend-card" aria-label={t('dailyTrendTitle')}>
      <div className="card-head-simple flex items-center justify-between gap-3 mb-2">
        <span className="card-title-simple text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          <span aria-hidden="true">📈</span>
          <span className="text-foreground text-sm font-bold">{t('dailyTrendTitle')}</span>
          <span className="text-[11px] font-normal text-muted-foreground">({t('dailyTrendUnit')})</span>
        </span>
        <div className="trend-summary-tags flex items-center gap-3.5 text-[11px] text-muted-foreground select-none">
          <span>
            {lang === 'zh' ? '统计期日均' : 'Avg'}:{' '}
            <strong className="font-semibold text-foreground tabular-nums">{hasData ? formatTokens(avgTokens) : '—'}</strong>
          </span>
          <span>
            {lang === 'zh' ? '峰值' : 'Peak'}:{' '}
            <strong className="font-semibold tabular-nums" style={{ color: 'var(--accent-primary, #2F71E3)' }}>
              {hasData ? `${formatTokens(peakTokens)}${peakDate ? ` (${peakDate.slice(5)})` : ''}` : '—'}
            </strong>
          </span>
        </div>
      </div>

      <div ref={containerRef} className="trend-svg-stage flex-1 min-h-[125px]">
        {!hasData ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">{t('noData')}</div>
        ) : chart ? (
          <svg
            width="100%"
            height={chartHeight}
            viewBox={`0 0 ${width} ${chartHeight}`}
            role="img"
            aria-label={t('dailyTrendTitle')}
            className="trend-chart-svg block"
          >
            <defs>
              <linearGradient id="daily-trend-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent-primary, #2F71E3)" stopOpacity="0.25" />
                <stop offset="100%" stopColor="var(--accent-primary, #2F71E3)" stopOpacity="0.0" />
              </linearGradient>
            </defs>
            {chart.ticks.map(tick => (
              <g key={tick.value}>
                <line
                  x1={PAD.left}
                  x2={width - PAD.right}
                  y1={tick.y}
                  y2={tick.y}
                  className="chart-grid-line"
                />
                <text
                  x={PAD.left - 6}
                  y={tick.y + 3.5}
                  textAnchor="end"
                  className="chart-axis-txt tabular-nums"
                >
                  {formatTokens(tick.value)}
                </text>
              </g>
            ))}
            <path d={chart.area} className="chart-area-path" />
            <path d={chart.line} className="chart-line-path" />
            <circle cx={chart.lastX} cy={chart.lastY} r="3.5" fill="var(--accent-primary, #2F71E3)" />
            {chart.xLabels.map(l => (
              <text
                key={l.x}
                x={l.x}
                y={chartHeight - 6}
                textAnchor="middle"
                className="chart-axis-txt tabular-nums"
              >
                {l.label}
              </text>
            ))}
          </svg>
        ) : null}
      </div>
    </section>
  );
};

export const DailyTrendCard = React.memo(DailyTrendCardImpl);