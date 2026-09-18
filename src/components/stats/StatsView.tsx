import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { StatsHeader } from './StatsHeader';
import { KpiBanner } from './KpiBanner';
import { TokenActivityHeatmap } from './TokenActivityHeatmap';
import { ActivityInsightsCard } from './ActivityInsightsCard';
import { TokenBreakdownCard } from './TokenBreakdownCard';
import { AggregatedStats, TimeRange } from '../../domain/stats.types';
import { fetchRawStats, filterStatsByRange, EMPTY_STATS, detectAntigravityTheme, syncThemeToElement } from '../../services/stats-service';

export const StatsView: React.FC = () => {
  const [rawStats, setRawStats] = useState<AggregatedStats>(EMPTY_STATS);
  const [timeRange, setTimeRange] = useState<TimeRange>('30d');
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isDark, setIsDark] = useState<boolean>(() => detectAntigravityTheme() === 'dark');

  // Synchronously compute filtered stats whenever rawStats or timeRange changes (instant, 0 latency)
  const stats = useMemo(() => filterStatsByRange(rawStats, timeRange), [rawStats, timeRange]);

  // Synchronize with Antigravity host dark/light mode dynamically
  useEffect(() => {
    const handleThemeChange = () => {
      const theme = detectAntigravityTheme();
      setIsDark(theme === 'dark');
      if (typeof document !== 'undefined') {
        syncThemeToElement(document.getElementById('antigravity-stats-settings-content'));
        syncThemeToElement(document.getElementById('antigravity-stats-modal-overlay'));
      }
    };
    handleThemeChange();

    const observer = new MutationObserver(handleThemeChange);
    if (typeof document !== 'undefined') {
      if (document.body) {
        observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
      }
      if (document.documentElement) {
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
      }
    }

    const media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    media?.addEventListener('change', handleThemeChange);

    return () => {
      observer.disconnect();
      media?.removeEventListener('change', handleThemeChange);
    };
  }, []);

  const loadData = useCallback(async (showIndicator = false) => {
    if (showIndicator) setIsRefreshing(true);
    try {
      const data = await fetchRawStats();
      setRawStats(data);
    } catch (err) {
      console.error('Failed to load stats:', err);
    } finally {
      if (showIndicator) {
        setTimeout(() => setIsRefreshing(false), 600);
      }
    }
  }, []);

  // Initial load on mount and proactive background sync request
  useEffect(() => {
    if (typeof window !== 'undefined' && typeof window.__ANTIGRAVITY_REQUEST_SYNC__ === 'function') {
      try {
        window.__ANTIGRAVITY_REQUEST_SYNC__();
      } catch (err) {
        console.warn('[TokenStats] Request sync on mount error:', err);
      }
    }
    loadData(false);
  }, [loadData]);

  // Listen for real-time live sync events from inject-live watcher
  useEffect(() => {
    const handleStatsUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<AggregatedStats>;
      const freshRaw = customEvent.detail || (typeof window !== 'undefined' ? window.__ANTIGRAVITY_STATS__ : undefined);
      if (freshRaw) {
        setRawStats(freshRaw);
      } else {
        loadData(false);
      }
    };

    window.addEventListener('antigravity:stats-updated', handleStatsUpdated);
    return () => {
      window.removeEventListener('antigravity:stats-updated', handleStatsUpdated);
    };
  }, [loadData]);

  // Manual refresh button triggers both CDP background sync and local reload
  const handleManualRefresh = useCallback(() => {
    if (typeof window !== 'undefined' && typeof window.__ANTIGRAVITY_REQUEST_SYNC__ === 'function') {
      try {
        window.__ANTIGRAVITY_REQUEST_SYNC__();
      } catch (err) {
        console.warn('[TokenStats] Request sync error:', err);
      }
    }
    loadData(true);
  }, [loadData]);

  return (
    <div
      className={`stats-view antigravity-stats-container ${isDark ? 'dark' : 'light'} flex flex-col h-full min-w-0 overflow-y-auto px-4 sm:px-6 pt-4 pb-5 bg-background text-foreground antialiased`}
      style={{ scrollbarGutter: 'stable' }}
    >
      <div className="w-full max-w-5xl mx-auto min-w-0 flex flex-col">
        {/* Header */}
        <StatsHeader
          timeRange={timeRange}
          onTimeRangeChange={(range) => setTimeRange(range)}
          onRefresh={handleManualRefresh}
          isRefreshing={isRefreshing}
        />

        <KpiBanner stats={stats} />
        <TokenBreakdownCard breakdown={stats.tokenBreakdown} />
        <TokenActivityHeatmap cells={rawStats.activity.heatmap} dailyStats={rawStats.activity.dailyStats} />
        <ActivityInsightsCard insights={rawStats.insights} kpis={rawStats.kpis} />
      </div>
    </div>
  );
};
