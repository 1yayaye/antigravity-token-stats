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
  costUsd?: number;
}

export interface CostTimelineEntry {
  ts: number;
  costUsd: number;
  pool: 'gemini' | 'claude';
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

export interface SessionSummary {
  /** Host run state (conversation_summaries.status); absent when the summaries DB is unavailable. */
  isRunning?: boolean;
  /** Model calls completed since the last user input step, with their exact token sum. */
  turnCalls?: number;
  turnTokens?: number;
  turnStartedAt?: number | null;
  promptTokens: number;
  latestInput: number;
  latestCacheRead: number;
  latestOutput: number;
  latestThinking: number;
  latestResponse: number;
  modelName: string;
  totalTokens: number;
  totalInputTokens: number;
  totalCacheReadTokens: number;
  totalOutputTokens: number;
  compactionLimit: number;
  turnsCount: number;
  rounds?: number;
  steps?: number;
  tps?: number | null;
  modelDurationSec?: number;
  toolDurationSec?: number;
  ttftSec?: number | null;
  dshTelemetry?: import('../types/dsh-telemetry').DshTelemetryData;
}

export interface ProxyTargetInfo {
  target: 'desktop' | 'ide';
  installed: boolean;
  available: boolean;
  dir: string | null;
  isRunning: boolean;
  dllExists: boolean;
  configExists: boolean;
  config?: {
    proxy?: {
      type: 'socks5' | 'http';
      host: string;
      port: number;
    };
    diagnostics?: {
      agent_ip_probe?: boolean;
    };
  } | null;
}

export interface ProxyStatusSummary {
  desktop: ProxyTargetInfo;
  ide: ProxyTargetInfo;
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
    costTimeline?: CostTimelineEntry[];
    costTimelineCoverageStartMs?: number | null;
  };
  insights: ActivityInsights;
  tokenBreakdown?: TokenBreakdown;
  sessions?: Record<string, SessionSummary>;
  proxy?: ProxyStatusSummary;
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
    __ANTIGRAVITY_STATUSBAR_ROOT__?: import('react-dom/client').Root | null;
    __ANTIGRAVITY_STATUSBAR_CONTAINER__?: HTMLElement | null;
    __ANTIGRAVITY_OBSERVER__?: MutationObserver | null;
    __ANTIGRAVITY_KEY_HANDLER__?: ((e: KeyboardEvent) => void) | null;
    __ANTIGRAVITY_KEY_LISTENER__?: boolean;
    __ANTIGRAVITY_REQUEST_SYNC__?: (sessionId?: string | null) => void;
    __ANTIGRAVITY_SYNC_BRIDGE__?: {
      requestSync: (payload?: { sessionId?: string | null } | string) => Promise<any>;
    };
    __ANTIGRAVITY_CDP_SYNC__?: (rawPayload: string) => void;
    __ANTIGRAVITY_STATS_LISTENER__?: boolean;
    AntigravityStats?: AntigravityStatsApi;
    require?: (module: string) => any;
  }
}
