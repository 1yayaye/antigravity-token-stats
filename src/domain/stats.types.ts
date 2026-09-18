export interface KpiMetrics {
  lifetimeTokens: string;
  lifetimeTokensRaw: number;
  peakTokens: string;
  longestTask: string;
  currentStreak: number;
  longestStreak: number;
}

export interface HeatmapCell {
  date: string;
  month: string;
  dayOfWeek: number;
  tokens: number;
  tasks: number;
  level: 0 | 1 | 2 | 3 | 4;
  detail?: DailyStatEntry;
}

export interface ActivityInsights {
  fastMode: string;
  mostUsedReasoning: string;
  skillsExplored: number;
  totalSkillsUsed: number;
  totalThreads: number;
  cacheHitRate?: string;
  toolPrimitivesUsed?: number;
}

export interface DailyStatEntry {
  tokens: number;
  tasks: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  thinkingTokens?: number;
  responseTokens?: number;
}

export interface TokenBreakdown {
  inputTokens: number;
  inputTokensFormatted: string;
  cacheReadTokens: number;
  cacheReadTokensFormatted: string;
  totalPromptTokens: number;
  totalPromptTokensFormatted: string;
  cacheHitRate: string;
  outputTokens: number;
  outputTokensFormatted: string;
  thinkingTokens: number;
  thinkingTokensFormatted: string;
  responseTokens: number;
  responseTokensFormatted: string;
  reasoningPct: number;
}

/**
 * Aggregated token metrics and activity snapshot for a given time window.
 */
export interface AggregatedStats {
  kpis: KpiMetrics;
  activity: {
    heatmap: HeatmapCell[];
    activeDaysCount: number;
    totalTasks: number;
    dailyStats?: Record<string, DailyStatEntry>;
  };
  insights: ActivityInsights;
  tokenBreakdown?: TokenBreakdown;
  meta: {
    scannedConversations: number;
    updatedAt: string;
    models?: Record<string, { count: number; pct: number }>;
    hasStaleSessions?: boolean;
  };
}

/**
 * TimeRange represents the selected summary period filter.
 * - 'today': Current calendar day (from 00:00:00 in device local time)
 * - '1d': Today and yesterday (2 calendar days, snapshot window, not rolling 24h)
 * - '7d': Last 7 calendar days
 * - '30d': Last 30 calendar days
 * - 'all': All recorded history across all conversations
 */
export type TimeRange = 'today' | '1d' | '7d' | '30d' | 'all';

/**
 * Public JavaScript API exposed on window.AntigravityStats
 */
export interface AntigravityStatsApi {
  mount: (container: HTMLElement) => void;
  unmount: () => void;
  openModal: () => void;
  closeModal: () => void;
  showToast: (message?: string, durationMs?: number) => void;
  closeToast: (immediate?: boolean) => void;
  init: () => void;
}

declare global {
  interface Window {
    __ANTIGRAVITY_STATS__?: AggregatedStats;
    __ANTIGRAVITY_STATS_ROOT__?: import('react-dom/client').Root | null;
    __ANTIGRAVITY_OBSERVER__?: MutationObserver | null;
    __ANTIGRAVITY_KEY_HANDLER__?: ((e: KeyboardEvent) => void) | null;
    __ANTIGRAVITY_KEY_LISTENER__?: boolean;
    __ANTIGRAVITY_REQUEST_SYNC__?: () => void;
    __ANTIGRAVITY_CDP_SYNC__?: (rawPayload: string) => void;
    AntigravityStats?: AntigravityStatsApi;
  }
}
