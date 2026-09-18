import { AggregatedStats, TimeRange, TokenBreakdown } from '../domain/stats.types';

export const EMPTY_BREAKDOWN: TokenBreakdown = {
  inputTokens: 0,
  inputTokensFormatted: '0',
  cacheReadTokens: 0,
  cacheReadTokensFormatted: '0',
  totalPromptTokens: 0,
  totalPromptTokensFormatted: '0',
  cacheHitRate: '0%',
  outputTokens: 0,
  outputTokensFormatted: '0',
  thinkingTokens: 0,
  thinkingTokensFormatted: '0',
  responseTokens: 0,
  responseTokensFormatted: '0',
  reasoningPct: 0,
};

// Zero-state empty baseline (no fake mock data)
export const EMPTY_STATS: AggregatedStats = {
  kpis: {
    lifetimeTokens: '0',
    lifetimeTokensRaw: 0,
    peakTokens: '0',
    longestTask: '—',
    currentStreak: 0,
    longestStreak: 0,
  },
  activity: {
    heatmap: [],
    activeDaysCount: 0,
    totalTasks: 0,
  },
  insights: {
    fastMode: '—',
    mostUsedReasoning: '—',
    skillsExplored: 0,
    totalSkillsUsed: 0,
    totalThreads: 0,
  },
  tokenBreakdown: EMPTY_BREAKDOWN,
  meta: {
    scannedConversations: 0,
    updatedAt: new Date().toISOString(),
    hasStaleSessions: false,
  },
};

export function formatTokens(t: number): string {
  if (t >= 1e9) return (t / 1e9).toFixed(2) + 'B';
  if (t >= 1e6) return (t / 1e6).toFixed(1) + 'M';
  if (t >= 1e3) return (t / 1e3).toFixed(1) + 'K';
  return String(Math.round(t));
}

function computeBreakdownFromValues(
  input: number,
  cache: number,
  output: number,
  thinking: number,
  response: number
): TokenBreakdown {
  const totalPrompt = input + cache;
  const cacheHitRate = totalPrompt > 0 ? ((cache / totalPrompt) * 100).toFixed(1) + '%' : '0%';
  const reasoningPct = output > 0 ? Number(((thinking / output) * 100).toFixed(1)) : 0;

  return {
    inputTokens: input,
    inputTokensFormatted: formatTokens(input),
    cacheReadTokens: cache,
    cacheReadTokensFormatted: formatTokens(cache),
    totalPromptTokens: totalPrompt,
    totalPromptTokensFormatted: formatTokens(totalPrompt),
    cacheHitRate,
    outputTokens: output,
    outputTokensFormatted: formatTokens(output),
    thinkingTokens: thinking,
    thinkingTokensFormatted: formatTokens(thinking),
    responseTokens: response,
    responseTokensFormatted: formatTokens(response),
    reasoningPct,
  };
}

function hasCompleteBreakdown(entry: {
  inputTokens?: number; cacheReadTokens?: number; outputTokens?: number;
  thinkingTokens?: number; responseTokens?: number;
} | undefined, total: number): boolean {
  if (!entry) return false;
  const values = [entry.inputTokens, entry.cacheReadTokens, entry.outputTokens, entry.thinkingTokens, entry.responseTokens];
  if (!values.every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0)) return false;
  const [input, cache, output, thinking, response] = values as number[];
  return (total === 0 || input + cache + output > 0)
    && input + cache + output === total
    && thinking + response === output;
}

export function toLocalDateKey(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function filterStatsByRange(stats: AggregatedStats, timeRange: TimeRange): AggregatedStats {
  if (timeRange === 'all') {
    const raw = stats.tokenBreakdown;
    const complete = hasCompleteBreakdown(raw, stats.kpis.lifetimeTokensRaw);
    return {
      ...stats,
      tokenBreakdown: complete && raw
        ? computeBreakdownFromValues(raw.inputTokens, raw.cacheReadTokens, raw.outputTokens, raw.thinkingTokens, raw.responseTokens)
        : stats.kpis.lifetimeTokensRaw === 0 ? EMPTY_BREAKDOWN : undefined,
    };
  }

  const today = Date.parse(toLocalDateKey() + 'T00:00:00Z');
  // The existing 1d option includes today and yesterday, not a rolling 24 hours.
  const days = timeRange === 'today' ? 1 : timeRange === '1d' ? 2 : timeRange === '7d' ? 7 : 30;
  const daily = new Map(stats.activity.heatmap.map(cell => [cell.date, { tokens: cell.tokens, tasks: cell.tasks }]));
  for (const [date, entry] of Object.entries(stats.activity.dailyStats || {})) daily.set(date, entry);
  const entries = [...daily].filter(([date]) => {
    const age = Math.round((today - Date.parse(date + 'T00:00:00Z')) / 86400000);
    return age >= 0 && age < days;
  });
  let tokens = 0;
  let tasks = 0;
  let activeDays = 0;
  let input = 0;
  let cache = 0;
  let output = 0;
  let thinking = 0;
  let response = 0;
  let complete = entries.length > 0 || stats.kpis.lifetimeTokensRaw === 0;
  for (const [date, entry] of entries) {
    tokens += entry.tokens;
    tasks += entry.tasks;
    if (entry.tokens > 0 || entry.tasks > 0) activeDays++;
    const detail = stats.activity.dailyStats?.[date];
    if (entry.tokens === 0 && !detail) continue;
    if (!hasCompleteBreakdown(detail, entry.tokens)) {
      complete = false;
      continue;
    }
    input += detail!.inputTokens!;
    cache += detail!.cacheReadTokens!;
    output += detail!.outputTokens!;
    thinking += detail!.thinkingTokens!;
    response += detail!.responseTokens!;
  }
  return {
    ...stats,
    kpis: { ...stats.kpis, lifetimeTokens: formatTokens(tokens), lifetimeTokensRaw: tokens },
    activity: { ...stats.activity, activeDaysCount: activeDays, totalTasks: tasks },
    tokenBreakdown: complete ? computeBreakdownFromValues(input, cache, output, thinking, response) : undefined,
  };
}

export async function fetchRawStats(): Promise<AggregatedStats> {
  let baseStats: AggregatedStats | null = null;

  // If running in injected Antigravity Electron mode with preloaded stats
  if (typeof window !== 'undefined' && window.__ANTIGRAVITY_STATS__) {
    baseStats = window.__ANTIGRAVITY_STATS__;
  }

  if (!baseStats) {
    try {
      const response = await fetch('/api/stats');
      if (response.ok) {
        baseStats = (await response.json()) as AggregatedStats;
      }
    } catch {
      // API fetch failed, fallback to clean baseline
    }
  }

  return baseStats || EMPTY_STATS;
}

/** Detects the host theme from explicit classes and data attributes. */
export function detectAntigravityTheme(): 'dark' | 'light' {
  if (typeof document === 'undefined') return 'dark';
  const doc = document.documentElement;
  const body = document.body;

  if (['dark', 'theme-dark', 'dark-theme'].some(className => doc.classList.contains(className) || body.classList.contains(className))) {
    return 'dark';
  }

  if (['light', 'theme-light', 'light-theme'].some(className => doc.classList.contains(className) || body.classList.contains(className))) {
    return 'light';
  }

  const themeAttr =
    doc.getAttribute('data-theme') ||
    body.getAttribute('data-theme') ||
    doc.getAttribute('data-vscode-theme-kind') ||
    body.getAttribute('data-vscode-theme-kind');
  if (themeAttr) {
    if (/dark/i.test(themeAttr)) return 'dark';
    if (/light/i.test(themeAttr)) return 'light';
  }

  return 'dark';
}

/**
 * Synchronizes dark/light class on target container element
 */
export function syncThemeToElement(el: HTMLElement | null): 'dark' | 'light' {
  const theme = detectAntigravityTheme();
  if (el) {
    if (theme === 'dark') {
      el.classList.add('dark');
      el.classList.remove('light');
    } else {
      el.classList.add('light');
      el.classList.remove('dark');
    }
  }
  return theme;
}
