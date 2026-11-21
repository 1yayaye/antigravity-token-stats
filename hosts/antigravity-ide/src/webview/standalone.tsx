import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import {
  CONTAINER_IDE_POPOVER_ID, CONTAINER_IDE_STATUSBAR_ID, IPC_IDE_SYNC, WINDOW_IDE_STATE,
} from '../../../../src/injection-contract.cjs';
import { computeQuotaCycleMetrics, formatResetCountdown } from '../../../../src/services/pricing-service';
import { filterStatsByRange, formatTokens } from '../../../../src/services/stats-service';
import type { LiveQuotaSummary, QuotaPoolId } from '../../../../src/domain/pricing.types';
import type { IdeHostState } from '../host-state';
import './widgets.css';

export type Widget = 'session' | 'tokens' | 'context';
export type Lang = 'zh' | 'en';
export type Theme = 'dark' | 'light';

const WIDGET_ORDER: Widget[] = ['session', 'tokens', 'context'];
const LANG_STORAGE_KEY = 'antigravity-ide-stats-lang';
const EMPTY_STATE: IdeHostState = {
  stats: null, quota: null, activeSessionId: null, sessionTitle: null, session: null, contextLimit: null, error: null,
};
const POOLS = [
  { pool: 'gemini', key: 'weeklyGemini', name: 'Gemini' },
  { pool: 'claude', key: 'weeklyClaude', name: 'Claude / GPT' },
  { pool: 'argon', key: 'weeklyArgon', name: 'Argon' },
] as const;

const COPY = {
  zh: {
    groupLabel: 'IDE 用量统计',
    titles: { session: '会话统计', tokens: 'Token 用量', context: '上下文与额度' } as Record<Widget, string>,
    sessionTitle: '会话统计',
    noSessionMeta: '未识别当前聊天',
    turnsSuffix: (turns: number, steps: number, samples: number | null) =>
      samples !== null ? `${turns} 轮 · ${steps} 步 · ${samples} 次采样` : `${turns} 轮 · ${steps} 步`,
    modelTime: '模型用时',
    toolTime: '工具用时',
    avgTtft: '平均 TTFT',
    sessionTps: '会话 TPS',
    lastReq: '最近请求',
    respThink: '正文 / 思考',
    sessionFormula: '计算方式：正文输出 Token ÷ 流式生成耗时；会话 TPS 按耗时加权。',
    sessionEmpty: '当前窗口未识别到活跃聊天。打开原生对话面板后自动采集性能与上下文，不用后台会话替代。',
    tokenTitle: 'Token 用量',
    cacheHit: '缓存命中率',
    uncachedInput: '未缓存输入',
    cacheRead: '缓存读取',
    output: '输出',
    tokenFormula: '缓存读取 ÷ 总输入（按请求加权）。缓存写入不计入命中。',
    today: '今日',
    month30: '近 30 天',
    viewUsage: '展开今日 / 7天 / 30天分项明细',
    hideUsage: '收起时间窗明细',
    rangeCol: '范围',
    totalCol: '总量',
    inputCol: '输入',
    cacheCol: '缓存',
    outputCol: '输出',
    thinkCol: '思考¹',
    rangeLabels: ['今日', '近七天', '近三十天'] as const,
    rangeNote: '全部 IDE 项目与会话 · 按本机自然日。¹思考已包含在输出内，不重复计入总量；记录不完整的分项显示 —。',
    missingBreakdownTitle: '分项不可用',
    ctxTitle: '上下文窗口',
    ctxHero: (pct: number) => `已用 ${pct}%（剩余 ${100 - pct}%）`,
    ctxHeroUnconfirmed: (used: string) => `${used} Token`,
    ctxHeroPending: '待采样',
    ctxHeroEmpty: '未识别当前聊天',
    ctxSub: (used: string, limit: string) => `${used} 已用 / ${limit} 上限`,
    ctxSubUnconfirmed: '上限未确认 · 暂不计算占用百分比',
    ctxSubEmpty: '等待原生聊天路由信号或首个已记录请求',
    sampledModel: '采样模型',
    modelUnrecorded: '模型未记录',
    ctxNote: '来自最近一次已记录请求的上下文估算，非累计总量或流式实时计数器。',
    ctxStreamingNote: '生成中 · 保留最近一次已记录采样，不展示伪实时占用。',
    quotaGroup: '额度池',
    refreshQuota: '刷新额度',
    weeklyQuota: '服务端周额度',
    cycleEst: '四周周期估算',
    remaining: '剩余',
    usedLabel: '估算已用',
    unavailable: '不可用',
    noSample: '暂无样本',
    resetsIn: '距离重置',
    resetTime: '重置时间',
    quotaShareNote: (t: string) => `同组模型共享周额度 · 更新于 ${t}`,
    cycleDetail: (cost: string, cap: string) => `API 等值消耗 ${cost} / 估算容量 ${cap}`,
    cycleExtrap: '历史不足四周，已按现有周记录外推估算。',
    cycleNormal: '按四个周重置周期估算，并非实测月度额度。',
    cycleMissing: '缺少有效的周消耗校准，暂不能估算容量。',
    quotaEmpty: '额度不可用。当前处于未登录或 Hub 托管模式，不将缺失数据视为剩余 100%。',
    langRow: 'Language / 语言',
    pillHit: '命中',
    pillCtxEmpty: 'Ctx --',
    pillCtxPending: 'Ctx 待采样',
    notSampled: '尚未采样',
    syncError: '暂时无法获取 IDE 数据，稍后自动重试。',
    readStatsError: '读取 IDE 统计失败，保留最近一次结果。',
  },
  en: {
    groupLabel: 'IDE Usage Stats',
    titles: { session: 'Session statistics', tokens: 'Token usage', context: 'Context & Quota' } as Record<Widget, string>,
    sessionTitle: 'Session statistics',
    noSessionMeta: 'No active chat detected',
    turnsSuffix: (turns: number, steps: number, samples: number | null) =>
      samples !== null ? `${turns} turns · ${steps} steps · ${samples} samples` : `${turns} turns · ${steps} steps`,
    modelTime: 'Model time',
    toolTime: 'Tool time',
    avgTtft: 'Average TTFT',
    sessionTps: 'Session TPS',
    lastReq: 'Last request',
    respThink: 'Response / thinking',
    sessionFormula: 'Calculation: response tokens ÷ streaming time; session TPS is time-weighted.',
    sessionEmpty: 'No active chat detected in this window. Open a chat panel to sample session telemetry; background chats are never substituted.',
    tokenTitle: 'Token usage',
    cacheHit: 'Cache hit',
    uncachedInput: 'Uncached input',
    cacheRead: 'Cache read',
    output: 'Output',
    tokenFormula: 'Cached input ÷ total input, weighted across requests. Cache writes are not hits.',
    today: 'Today',
    month30: 'This month',
    viewUsage: 'View token usage',
    hideUsage: 'Hide breakdown',
    rangeCol: 'Range',
    totalCol: 'Total',
    inputCol: 'Input',
    cacheCol: 'Cache',
    outputCol: 'Output',
    thinkCol: 'Thinking¹',
    rangeLabels: ['Today', 'Last 7d', 'Last 30d'] as const,
    rangeNote: 'All IDE projects & sessions · local calendar days. ¹Thinking is included in output; incomplete breakdowns show —.',
    missingBreakdownTitle: 'Breakdown unavailable',
    ctxTitle: 'Context window',
    ctxHero: (pct: number) => `${pct}% used (${100 - pct}% left)`,
    ctxHeroUnconfirmed: (used: string) => `${used} tokens`,
    ctxHeroPending: 'Pending sample',
    ctxHeroEmpty: 'Chat unrecognized',
    ctxSub: (used: string, limit: string) => `${used} tokens used / ${limit} total`,
    ctxSubUnconfirmed: 'Limit unconfirmed · percentage omitted',
    ctxSubEmpty: 'Waiting for visible chat route or recorded request',
    sampledModel: 'Sampled model',
    modelUnrecorded: 'Model not recorded',
    ctxNote: 'Host estimate at the latest request start; not cumulative tokens or a live streaming counter.',
    ctxStreamingNote: 'Streaming · Holding latest recorded sample rather than synthetic live count.',
    quotaGroup: 'Quota group',
    refreshQuota: 'Refresh quota',
    weeklyQuota: 'Weekly quota',
    cycleEst: '4-week cycle est.',
    remaining: 'remaining',
    usedLabel: 'est. used',
    unavailable: 'Unavailable',
    noSample: 'No sample',
    resetsIn: 'Resets in',
    resetTime: 'Reset time',
    quotaShareNote: (t: string) => `Models in this group share quota. Updated ${t}`,
    cycleDetail: (cost: string, cap: string) => `API equiv. spend ${cost} / est. cap ${cap}`,
    cycleExtrap: 'Insufficient 4-week history; extrapolated from recorded cycles.',
    cycleNormal: 'Estimated across 4 weekly reset cycles; not metered monthly quota.',
    cycleMissing: 'Missing valid weekly spend calibration; unable to estimate capacity.',
    quotaEmpty: 'Quota unavailable. Missing credentials or hub-managed auth; never assumed 100%.',
    langRow: 'Language / 语言',
    pillHit: 'Cache hit',
    pillCtxEmpty: 'Ctx --',
    pillCtxPending: 'Ctx --',
    notSampled: 'Not sampled',
    syncError: 'IDE telemetry temporarily unavailable; retrying automatically.',
    readStatsError: 'Failed to read IDE stats; showing previous snapshot.',
  },
} as const;

function hasCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function count(value: unknown): string {
  return hasCount(value) ? formatTokens(value) : '—';
}

function exactCount(value: unknown, lang: Lang): string {
  return hasCount(value) ? value.toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US') : '—';
}

function formatTpsValue(value: unknown): string | null {
  if (!hasCount(value) || value <= 0) return null;
  return value < 10 ? value.toFixed(1) : (Number.isInteger(value) ? String(value) : value.toFixed(1));
}

function formatSec(value: unknown): string {
  return hasCount(value) ? `${value.toFixed(2)}s` : '—';
}

function computeCacheHitPct(input: unknown, cacheRead: unknown): string | null {
  if (!hasCount(input) || !hasCount(cacheRead)) return null;
  const totalPrompt = input + cacheRead;
  if (totalPrompt <= 0) return null;
  return ((cacheRead / totalPrompt) * 100).toFixed(1);
}

function timestamp(value: string | undefined | null, lang: Lang): string {
  return value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US')
    : COPY[lang].notSampled;
}

function availablePools(quota: LiveQuotaSummary | null) {
  return POOLS.flatMap(pool => {
    const bucket = quota?.[pool.key];
    return bucket ? [{ ...pool, bucket }] : [];
  });
}

function loadSavedLang(): Lang {
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem(LANG_STORAGE_KEY) === 'en') {
      return 'en';
    }
  } catch {}
  return 'zh';
}

function saveLang(lang: Lang) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {}
}

export function detectIdeTheme(): Theme {
  if (typeof document === 'undefined') return 'dark';
  const workbench = typeof document.querySelector === 'function' ? document.querySelector('.monaco-workbench') : null;
  const nodes = [document.documentElement, document.body, workbench];
  for (const el of nodes) {
    const cl = el?.classList;
    if (!cl) continue;
    if (cl.contains('vscode-light') || cl.contains('hc-light') || cl.contains('light') || cl.contains('theme-light')) {
      return 'light';
    }
    if (
      cl.contains('vscode-dark') || cl.contains('vs-dark') || cl.contains('hc-black') ||
      cl.contains('vscode-high-contrast') || cl.contains('dark') || cl.contains('theme-dark')
    ) {
      return 'dark';
    }
    if (cl.contains('vs')) return 'light';
  }
  const kind = document.body?.getAttribute?.('data-vscode-theme-kind')
    || document.documentElement?.getAttribute?.('data-vscode-theme-kind')
    || workbench?.getAttribute?.('data-vscode-theme-kind')
    || '';
  return /light/i.test(kind) ? 'light' : 'dark';
}

// --- Inline SVG Icons (no external assets, safe under strict CSP) ---

function GaugeIcon({ pulse = false }: { pulse?: boolean }) {
  return (
    <svg className={pulse ? 'anti-ide-pulse-icon' : undefined} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m12 14 4-4" />
      <path d="M3.34 19a10 10 0 1 1 17.32 0" />
    </svg>
  );
}

function DbIcon({ pulse = false }: { pulse?: boolean }) {
  return (
    <svg className={pulse ? 'anti-ide-pulse-icon' : undefined} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
      <path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3" />
    </svg>
  );
}

function DonutIcon({ pct, streaming = false }: { pct: number | null; streaming?: boolean }) {
  const r = 5.5;
  const c = 2 * Math.PI * r;
  const valid = typeof pct === 'number' && Number.isFinite(pct);
  const clamped = valid ? Math.max(0, Math.min(100, pct)) : 0;
  const offset = c - (clamped / 100) * c;
  let stroke = 'var(--anti-accent)';
  if (!valid) stroke = 'var(--anti-text-muted)';
  else if (clamped >= 85) stroke = 'var(--anti-danger)';
  else if (clamped >= 70) stroke = 'var(--anti-warn)';

  return (
    <svg className={streaming ? 'anti-ide-pulse-icon' : undefined} width="14" height="14" viewBox="0 0 16 16" style={{ transform: 'rotate(-90deg)' }} aria-hidden="true">
      <circle
        cx="8"
        cy="8"
        r={r}
        fill="none"
        stroke="var(--anti-track-bg)"
        strokeWidth="2"
        strokeDasharray={!valid ? '2 2' : undefined}
      />
      {valid ? (
        <circle
          cx="8"
          cy="8"
          r={r}
          fill="none"
          stroke={stroke}
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={c.toFixed(2)}
          strokeDashoffset={offset.toFixed(2)}
        />
      ) : null}
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

function CycleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 16h5v5" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg className="anti-ide-select-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function resolveContextMetrics(state: IdeHostState) {
  const session = state.activeSessionId ? state.session : null;
  const limit = hasCount(state.contextLimit) && state.contextLimit > 0 ? state.contextLimit : null;
  const hasPrompt = Boolean(session && session.turnsCount > 0 && hasCount(session.promptTokens));
  const pct = hasPrompt && limit !== null
    ? Math.min(100, Math.round((session!.promptTokens / limit) * 100))
    : null;
  return { session, limit, hasPrompt, pct };
}

function resolveTokenOverview(state: IdeHostState) {
  const session = state.activeSessionId ? state.session : null;
  const todayStats = state.stats ? filterStatsByRange(state.stats, 'today') : null;
  const monthStats = state.stats ? filterStatsByRange(state.stats, '30d') : null;
  const todayRaw = todayStats ? todayStats.kpis.lifetimeTokensRaw : null;
  const monthRaw = monthStats ? monthStats.kpis.lifetimeTokensRaw : null;

  if (session) {
    return {
      total: hasCount(session.totalTokens) ? session.totalTokens : null,
      uncachedInput: hasCount(session.totalInputTokens) ? session.totalInputTokens : null,
      cacheRead: hasCount(session.totalCacheReadTokens) ? session.totalCacheReadTokens : null,
      output: hasCount(session.totalOutputTokens) ? session.totalOutputTokens : null,
      hitPct: computeCacheHitPct(session.totalInputTokens, session.totalCacheReadTokens),
      todayRaw,
      monthRaw,
    };
  }

  const tb = todayStats?.tokenBreakdown;
  return {
    total: todayRaw,
    uncachedInput: tb ? tb.inputTokens : null,
    cacheRead: tb ? tb.cacheReadTokens : null,
    output: tb ? tb.outputTokens : null,
    hitPct: tb ? computeCacheHitPct(tb.inputTokens, tb.cacheReadTokens) : null,
    todayRaw,
    monthRaw,
  };
}

export function widgetSummaries(state: IdeHostState, lang: Lang = 'zh'): Record<Widget, string> {
  const t = COPY[lang];
  const { session, hasPrompt, pct } = resolveContextMetrics(state);
  const tpsText = session ? formatTpsValue(session.tps) : null;
  const sessionSummary = tpsText ? `${tpsText} tok/s` : '-- tok/s';

  const tok = resolveTokenOverview(state);
  const totalStr = hasCount(tok.total) ? `${formatTokens(tok.total)} tok` : '— tok';
  const tokensSummary = tok.hitPct !== null ? `${totalStr} · ${t.pillHit} ${tok.hitPct}%` : totalStr;

  let contextSummary: string = t.pillCtxEmpty;
  if (pct !== null) {
    contextSummary = `Ctx ${pct}%`;
  } else if (session) {
    contextSummary = hasPrompt ? `Ctx ${formatTokens(session.promptTokens)}` : t.pillCtxPending;
  }

  return {
    session: sessionSummary,
    tokens: tokensSummary,
    context: contextSummary,
  };
}

export interface IdeWidgetContentProps {
  widget: Widget;
  state: IdeHostState;
  lang?: Lang;
  selectedPool?: QuotaPoolId;
  onSelectPool?: (pool: QuotaPoolId) => void;
  onRefreshQuota?: () => void;
  refreshingQuota?: boolean;
  tokenDrawerOpen?: boolean;
  onToggleTokenDrawer?: () => void;
  onChangeLang?: (lang: Lang) => void;
}

function SessionStatsCard({ state, lang }: { state: IdeHostState; lang: Lang }) {
  const t = COPY[lang];
  const session = state.activeSessionId ? state.session : null;
  const streaming = Boolean(session?.isRunning || session?.telemetry?.isStreaming);

  const turns = session ? (hasCount(session.rounds) ? session.rounds : session.turnsCount) : 0;
  const steps = session ? (hasCount(session.steps) ? session.steps : session.turnsCount) : 0;
  const samples = session && hasCount(session.samplesCount) ? session.samplesCount : null;

  const tpsStr = session ? formatTpsValue(session.tps) : null;
  const lastTpsStr = session ? formatTpsValue(session.lastRequestTps) : null;
  const extSession = session as (typeof session & { totalThinkingTokens?: number; totalResponseTokens?: number }) | null;
  const respTokens = extSession?.totalResponseTokens;
  const thinkTokens = extSession?.totalThinkingTokens;
  const respThinkStr = session && (hasCount(respTokens) || hasCount(thinkTokens))
    ? `${exactCount(respTokens, lang)} / ${exactCount(thinkTokens, lang)} tok`
    : '—';

  const rows: Array<[string, string]> = [
    [t.modelTime, session ? formatSec(session.modelDurationSec) : '—'],
    [t.toolTime, session ? formatSec(session.toolDurationSec) : '—'],
    [t.avgTtft, session ? formatSec(session.ttftSec) : '—'],
    [t.sessionTps, tpsStr ? `${tpsStr} tok/s` : '—'],
    [t.lastReq, lastTpsStr ? `${lastTpsStr} tok/s` : '—'],
    [t.respThink, respThinkStr],
  ];

  return (
    <div className="anti-ide-card" data-card="session">
      <div className="anti-ide-card-header">
        <span className="anti-ide-card-title"><GaugeIcon pulse={streaming} /><span>{t.sessionTitle}</span></span>
        <span className="anti-ide-card-subtitle">
          {session ? t.turnsSuffix(turns, steps, samples) : t.noSessionMeta}
        </span>
      </div>
      <div className="anti-ide-divider" />
      {!session ? (
        <div className="anti-ide-empty-box"><InfoIcon /><span>{t.sessionEmpty}</span></div>
      ) : null}
      <div className="anti-ide-kv-list">
        {rows.map(([label, value]) => (
          <div key={label} className="anti-ide-kv-row">
            <span className="anti-ide-kv-label">{label}</span>
            <span className={`anti-ide-kv-value${value === '—' ? ' muted' : ''}`}>{value}</span>
          </div>
        ))}
      </div>
      <p className="anti-ide-card-note">{t.sessionFormula}</p>
    </div>
  );
}

function TokenUsageCard({
  state,
  lang,
  tokenDrawerOpen,
  onToggleTokenDrawer,
}: {
  state: IdeHostState;
  lang: Lang;
  tokenDrawerOpen: boolean;
  onToggleTokenDrawer?: () => void;
}) {
  const t = COPY[lang];
  const session = state.activeSessionId ? state.session : null;
  const streaming = Boolean(session?.isRunning || session?.telemetry?.isStreaming);
  const overview = resolveTokenOverview(state);

  const rows: Array<[string, string]> = [
    [t.cacheHit, overview.hitPct !== null ? `${overview.hitPct}%` : '—'],
    [t.uncachedInput, hasCount(overview.uncachedInput) ? `${exactCount(overview.uncachedInput, lang)} tok` : '—'],
    [t.cacheRead, hasCount(overview.cacheRead) ? `${exactCount(overview.cacheRead, lang)} tok` : '—'],
    [t.output, hasCount(overview.output) ? `${exactCount(overview.output, lang)} tok` : '—'],
  ];

  return (
    <div className="anti-ide-card" data-card="tokens">
      <div className="anti-ide-card-header">
        <span className="anti-ide-card-title"><DbIcon pulse={streaming} /><span>{t.tokenTitle}</span></span>
        <span className="anti-ide-card-total">
          {hasCount(overview.total) ? `${exactCount(overview.total, lang)} tok` : '—'}
        </span>
      </div>
      <div className="anti-ide-divider" />
      <div className="anti-ide-kv-list">
        {rows.map(([label, value]) => (
          <div key={label} className="anti-ide-kv-row">
            <span className="anti-ide-kv-label">{label}</span>
            <span className={`anti-ide-kv-value${value === '—' ? ' muted' : ''}`}>{value}</span>
          </div>
        ))}
      </div>
      <p className="anti-ide-card-note">{t.tokenFormula}</p>
      <div className="anti-ide-divider" />
      <div className="anti-ide-kpi-split">
        <div>
          <div className="anti-ide-kpi-label">{t.today}</div>
          <div className="anti-ide-kpi-val">
            {count(overview.todayRaw)}
            {hasCount(overview.todayRaw) ? <small>Token</small> : null}
          </div>
        </div>
        <div>
          <div className="anti-ide-kpi-label">{t.month30}</div>
          <div className="anti-ide-kpi-val">
            {count(overview.monthRaw)}
            {hasCount(overview.monthRaw) ? <small>Token</small> : null}
          </div>
        </div>
      </div>
      <div className="anti-ide-divider" />
      <button
        type="button"
        className="anti-ide-link-row"
        data-action="toggle-token-drawer"
        aria-expanded={tokenDrawerOpen}
        onClick={onToggleTokenDrawer}
      >
        <span>{tokenDrawerOpen ? t.hideUsage : t.viewUsage}</span>
        <span aria-hidden="true">{tokenDrawerOpen ? '↑' : '→'}</span>
      </button>
      {tokenDrawerOpen ? (
        <div className="anti-ide-range-drawer">
          <div className="anti-ide-table-scroll">
            <table className="anti-ide-range-table">
              <thead>
                <tr>
                  <th scope="col">{t.rangeCol}</th>
                  <th scope="col">{t.totalCol}</th>
                  <th scope="col">{t.inputCol}</th>
                  <th scope="col">{t.cacheCol}</th>
                  <th scope="col">{t.outputCol}</th>
                  <th scope="col">{t.thinkCol}</th>
                </tr>
              </thead>
              <tbody>
                {(['today', '7d', '30d'] as const).map((range, index) => {
                  const rangeStats = state.stats ? filterStatsByRange(state.stats, range) : null;
                  const breakdown = rangeStats?.tokenBreakdown;
                  const values = [
                    rangeStats?.kpis.lifetimeTokensRaw,
                    breakdown?.inputTokens,
                    breakdown?.cacheReadTokens,
                    breakdown?.outputTokens,
                    breakdown?.thinkingTokens,
                  ];
                  return (
                    <tr key={range} data-range={range}>
                      <th scope="row">{t.rangeLabels[index]}</th>
                      {values.map((value, col) => (
                        <td
                          key={col}
                          title={hasCount(value) ? exactCount(value, lang) : t.missingBreakdownTitle}
                        >
                          {count(value)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="anti-ide-card-note">{t.rangeNote}</p>
        </div>
      ) : null}
    </div>
  );
}

function ContextQuotaCard({
  state,
  lang,
  selectedPool,
  onSelectPool,
  onRefreshQuota,
  refreshingQuota,
  onChangeLang,
}: {
  state: IdeHostState;
  lang: Lang;
  selectedPool: QuotaPoolId;
  onSelectPool?: (pool: QuotaPoolId) => void;
  onRefreshQuota?: () => void;
  refreshingQuota: boolean;
  onChangeLang?: (lang: Lang) => void;
}) {
  const t = COPY[lang];
  const { session, limit, hasPrompt, pct } = resolveContextMetrics(state);
  const streaming = Boolean(session?.isRunning || session?.telemetry?.isStreaming);
  const barClass = pct !== null ? (pct >= 85 ? ' danger' : pct >= 70 ? ' warn' : '') : '';

  const pools = availablePools(state.quota);
  const activePool = pools.find(p => p.pool === selectedPool) || pools[0] || null;
  const cycles = state.stats && pools.length > 0
    ? computeQuotaCycleMetrics(state.stats, state.quota, state.quota?.detectedAccountTier?.tier ?? 'pro')
    : null;
  const poolMetrics = activePool ? cycles?.pools[activePool.pool] : null;
  const validFraction = Boolean(
    activePool && hasCount(activePool.bucket.remainingFraction) && activePool.bucket.remainingFraction <= 1
  );
  const weeklyRemainingPct = validFraction && activePool
    ? parseFloat((activePool.bucket.remainingFraction * 100).toFixed(1))
    : null;
  const hasCycleSample = Boolean(
    activePool && poolMetrics?.bucket && validFraction &&
    hasCount(activePool.bucket.usedFraction) && activePool.bucket.usedFraction <= 1 &&
    hasCount(poolMetrics.monthlyCostUsd) && hasCount(poolMetrics.totalMonthlyCapUsd) && poolMetrics.totalMonthlyCapUsd > 0
  );
  const cycleUsedPct = hasCycleSample && poolMetrics
    ? Math.round((poolMetrics.monthlyCostUsd! / poolMetrics.totalMonthlyCapUsd!) * 100)
    : null;

  return (
    <div className="anti-ide-card" data-card="context">
      <div className="anti-ide-card-header">
        <span className="anti-ide-card-title"><ClockIcon /><span>{t.ctxTitle}</span></span>
        {session && state.sessionTitle ? (
          <span className="anti-ide-card-subtitle">{state.sessionTitle}</span>
        ) : null}
      </div>

      {session ? (
        <>
          <div className="anti-ide-ctx-hero">
            {pct !== null
              ? t.ctxHero(pct)
              : hasPrompt
                ? t.ctxHeroUnconfirmed(count(session.promptTokens))
                : t.ctxHeroPending}
          </div>
          <div className="anti-ide-ctx-sub">
            {hasPrompt
              ? (limit !== null ? t.ctxSub(count(session.promptTokens), count(limit)) : t.ctxSubUnconfirmed)
              : t.ctxSubEmpty}
          </div>
          <div className="anti-ide-progress-track">
            <div className={`anti-ide-progress-fill${barClass}`} style={{ width: `${pct ?? 0}%` }} />
          </div>
          <div className="anti-ide-kv-list" style={{ marginTop: 11 }}>
            <div className="anti-ide-kv-row">
              <span className="anti-ide-kv-label">{t.sampledModel}</span>
              <span className={`anti-ide-kv-value${session.modelName ? '' : ' muted'}`}>
                {session.modelName || t.modelUnrecorded}
              </span>
            </div>
          </div>
          <p className="anti-ide-card-note">{streaming ? t.ctxStreamingNote : t.ctxNote}</p>
        </>
      ) : (
        <>
          <div className="anti-ide-ctx-hero muted">{t.ctxHeroEmpty}</div>
          <div className="anti-ide-ctx-sub">{t.ctxSubEmpty}</div>
          <div className="anti-ide-progress-track">
            <div className="anti-ide-progress-fill" style={{ width: '0%' }} />
          </div>
          <div className="anti-ide-empty-box flush-bottom"><InfoIcon /><span>{t.sessionEmpty}</span></div>
        </>
      )}

      <div className="anti-ide-divider lg" />

      <div className="anti-ide-quota-header">
        <span className="anti-ide-quota-title">{t.quotaGroup}</span>
        <div className="anti-ide-quota-actions">
          <div className="anti-ide-select-wrap">
            <select
              className="anti-ide-pool-select"
              data-action="select-pool"
              aria-label={t.quotaGroup}
              disabled={!pools.length}
              value={activePool?.pool ?? 'gemini'}
              onChange={event => onSelectPool?.(event.target.value as QuotaPoolId)}
            >
              {pools.length > 0 ? (
                pools.map(p => (
                  <option key={p.pool} value={p.pool}>{p.bucket.displayName || p.name}</option>
                ))
              ) : (
                <option value="gemini">Gemini</option>
              )}
            </select>
            <ChevronDownIcon />
          </div>
          <button
            type="button"
            className={`anti-ide-icon-btn${refreshingQuota ? ' spinning' : ''}`}
            data-action="refresh-quota"
            title={t.refreshQuota}
            aria-label={t.refreshQuota}
            disabled={refreshingQuota}
            onClick={onRefreshQuota}
          >
            <RefreshIcon />
          </button>
        </div>
      </div>

      {activePool ? (
        <div data-pool={activePool.pool}>
          <div className="anti-ide-quota-block">
            <div className="anti-ide-quota-row-top">
              <span className="anti-ide-quota-name"><CalendarIcon /><span>{t.weeklyQuota}</span></span>
              <span className="anti-ide-quota-pct">
                <strong>{weeklyRemainingPct !== null ? `${weeklyRemainingPct}%` : t.unavailable}</strong>
                {weeklyRemainingPct !== null ? ` ${t.remaining}` : ''}
              </span>
            </div>
            <div className="anti-ide-progress-track">
              <div className="anti-ide-progress-fill" style={{ width: `${weeklyRemainingPct ?? 0}%` }} />
            </div>
            <div className="anti-ide-quota-meta">
              <div className="anti-ide-kv-row">
                <span className="anti-ide-kv-label">{t.resetsIn}</span>
                <span className="anti-ide-kv-value">{formatResetCountdown(activePool.bucket.resetTime, lang)}</span>
              </div>
              <div className="anti-ide-kv-row">
                <span className="anti-ide-kv-label">{t.resetTime}</span>
                <span className="anti-ide-kv-value">
                  {activePool.bucket.resetTime && Number.isFinite(Date.parse(activePool.bucket.resetTime))
                    ? timestamp(activePool.bucket.resetTime, lang)
                    : '—'}
                </span>
              </div>
            </div>
            <p className="anti-ide-card-note">{t.quotaShareNote(timestamp(state.quota?.capturedAt, lang))}</p>
          </div>

          <div className="anti-ide-quota-block">
            <div className="anti-ide-quota-row-top">
              <span className="anti-ide-quota-name"><CycleIcon /><span>{t.cycleEst}</span></span>
              <span className="anti-ide-quota-pct">
                <strong>{cycleUsedPct !== null ? `${cycleUsedPct}%` : t.noSample}</strong>
                {cycleUsedPct !== null ? ` ${t.usedLabel}` : ''}
              </span>
            </div>
            <div className="anti-ide-progress-track">
              <div className="anti-ide-progress-fill" style={{ width: `${cycleUsedPct !== null ? Math.min(100, cycleUsedPct) : 0}%` }} />
            </div>
            {hasCycleSample && poolMetrics ? (
              <>
                <p className="anti-ide-card-note" style={{ marginTop: 8 }}>
                  {t.cycleDetail(`$${poolMetrics.monthlyCostUsd!.toFixed(2)}`, `$${poolMetrics.totalMonthlyCapUsd!.toFixed(2)}`)}
                </p>
                <p className="anti-ide-card-note" style={{ marginTop: 4 }}>
                  {poolMetrics.isMonthlyExtrapolated ? t.cycleExtrap : t.cycleNormal}
                </p>
              </>
            ) : (
              <p className="anti-ide-card-note" style={{ marginTop: 8 }}>{t.cycleMissing}</p>
            )}
          </div>
        </div>
      ) : (
        <div className="anti-ide-empty-box"><InfoIcon /><span>{t.quotaEmpty}</span></div>
      )}

      <div className="anti-ide-divider footer-gap" />
      <div className="anti-ide-lang-footer">
        <span>{t.langRow}</span>
        <div className="anti-ide-lang-toggle" role="group" aria-label={t.langRow}>
          <button
            type="button"
            className={`anti-ide-lang-btn${lang === 'en' ? ' active' : ''}`}
            data-lang-btn="en"
            onClick={() => onChangeLang?.('en')}
          >
            English
          </button>
          <button
            type="button"
            className={`anti-ide-lang-btn${lang === 'zh' ? ' active' : ''}`}
            data-lang-btn="zh"
            onClick={() => onChangeLang?.('zh')}
          >
            简体中文
          </button>
        </div>
      </div>
    </div>
  );
}

export function IdeWidgetContent({
  widget,
  state,
  lang = 'zh',
  selectedPool = 'gemini',
  onSelectPool,
  onRefreshQuota,
  refreshingQuota = false,
  tokenDrawerOpen = false,
  onToggleTokenDrawer,
  onChangeLang,
}: IdeWidgetContentProps) {
  if (widget === 'session') return <SessionStatsCard state={state} lang={lang} />;
  if (widget === 'tokens') {
    return (
      <TokenUsageCard
        state={state}
        lang={lang}
        tokenDrawerOpen={tokenDrawerOpen}
        onToggleTokenDrawer={onToggleTokenDrawer}
      />
    );
  }
  return (
    <ContextQuotaCard
      state={state}
      lang={lang}
      selectedPool={selectedPool}
      onSelectPool={onSelectPool}
      onRefreshQuota={onRefreshQuota}
      refreshingQuota={refreshingQuota}
      onChangeLang={onChangeLang}
    />
  );
}

export function popoverPosition(anchor: { top: number; right: number }, panelWidth: number, viewportWidth: number, viewportHeight: number) {
  const width = Math.max(0, Math.min(panelWidth, viewportWidth - 16));
  const top = Math.max(8, Math.min(anchor.top, viewportHeight - 8));
  return {
    left: Math.max(8, Math.min(anchor.right - width, viewportWidth - width - 8)),
    bottom: viewportHeight - top + 6,
    maxHeight: Math.max(0, top - 14),
  };
}

export function IdeWidgets() {
  const [state, setState] = useState<IdeHostState>(EMPTY_STATE);
  const [open, setOpen] = useState<Widget | null>(null);
  const [lang, setLang] = useState<Lang>(loadSavedLang);
  const [theme, setTheme] = useState<Theme>(detectIdeTheme);
  const [selectedPool, setSelectedPool] = useState<QuotaPoolId>('gemini');
  const [tokenDrawerOpen, setTokenDrawerOpen] = useState(false);
  const [refreshingQuota, setRefreshingQuota] = useState(false);

  const triggers = useRef<Partial<Record<Widget, HTMLButtonElement | null>>>({});
  const panel = useRef<HTMLDivElement>(null);
  const group = useRef<HTMLDivElement>(null);
  const disposedRef = useRef(false);
  const refreshingRef = useRef(false);
  const langRef = useRef<Lang>(lang);
  langRef.current = lang;

  const invokeSync = useCallback(async (forceQuota = false) => {
    const ipc = (window as unknown as {
      vscode?: { ipcRenderer?: { invoke(channel: string, options?: { forceQuota?: boolean }): Promise<IdeHostState> } };
    }).vscode?.ipcRenderer;
    if (!ipc) throw new Error('IDE bridge unavailable');
    const next = await ipc.invoke(IPC_IDE_SYNC, forceQuota ? { forceQuota: true } : undefined);
    if (!next || typeof next !== 'object' || !('stats' in next) || !('quota' in next)) throw new Error('Invalid IDE state');
    if (!disposedRef.current) {
      (window as unknown as Record<string, unknown>)[WINDOW_IDE_STATE] = next;
      setState(next);
    }
  }, []);

  useEffect(() => {
    disposedRef.current = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        await invokeSync(false);
      } catch {
        if (!disposedRef.current) {
          const unavailable = { ...EMPTY_STATE, error: COPY[langRef.current].syncError };
          (window as unknown as Record<string, unknown>)[WINDOW_IDE_STATE] = unavailable;
          setState(unavailable);
        }
      } finally {
        // Schedule after completion: a slow IPC call never creates overlapping polls.
        if (!disposedRef.current) timer = setTimeout(poll, 3_000);
      }
    };
    void poll();
    return () => {
      disposedRef.current = true;
      clearTimeout(timer);
    };
  }, [invokeSync]);

  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
    const syncTheme = () => setTheme(detectIdeTheme());
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    const attrFilter = { attributes: true, attributeFilter: ['class', 'data-vscode-theme-kind', 'data-theme'] };
    if (document.documentElement) observer.observe(document.documentElement, attrFilter);
    if (document.body) observer.observe(document.body, attrFilter);
    const workbench = typeof document.querySelector === 'function' ? document.querySelector('.monaco-workbench') : null;
    if (workbench && workbench !== document.body && workbench !== document.documentElement) {
      observer.observe(workbench, attrFilter);
    }
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const position = () => {
      const trigger = triggers.current[open];
      if (!trigger || !panel.current) return;
      const next = popoverPosition(trigger.getBoundingClientRect(), panel.current.offsetWidth, window.innerWidth, window.innerHeight);
      Object.assign(panel.current.style, { left: `${next.left}px`, bottom: `${next.bottom}px`, maxHeight: `${next.maxHeight}px` });
    };
    position();
    panel.current?.focus({ preventScroll: true });
    window.addEventListener('resize', position);
    document.addEventListener('scroll', position, { capture: true, passive: true });
    const observer = new ResizeObserver(position);
    const trigger = triggers.current[open];
    if (trigger) observer.observe(trigger);
    if (group.current) observer.observe(group.current);
    if (panel.current) observer.observe(panel.current);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', position);
      document.removeEventListener('scroll', position, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !group.current?.contains(event.target) && !panel.current?.contains(event.target)) setOpen(null);
    };
    const blur = () => setOpen(null);
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(null);
      triggers.current[open]?.focus({ preventScroll: true });
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    window.addEventListener('blur', blur);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape, true);
      window.removeEventListener('blur', blur);
    };
  }, [open]);

  const handleRefreshQuota = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshingQuota(true);
    try {
      await invokeSync(true);
    } catch {
      // Next background poll handles transient IPC errors.
    } finally {
      refreshingRef.current = false;
      if (!disposedRef.current) setRefreshingQuota(false);
    }
  }, [invokeSync]);

  const handleChangeLang = useCallback((nextLang: Lang) => {
    setLang(nextLang);
    saveLang(nextLang);
    setState(current => {
      if (current.error !== COPY.zh.syncError && current.error !== COPY.en.syncError) return current;
      const nextState = { ...current, error: COPY[nextLang].syncError };
      (window as unknown as Record<string, unknown>)[WINDOW_IDE_STATE] = nextState;
      return nextState;
    });
  }, []);

  const t = COPY[lang];
  const summaries = widgetSummaries(state, lang);
  const activeSession = state.activeSessionId ? state.session : null;
  const streaming = Boolean(activeSession?.isRunning || activeSession?.telemetry?.isStreaming);
  const { pct: ctxPct } = resolveContextMetrics(state);
  const tokenOverview = resolveTokenOverview(state);

  const renderPillInner = (widget: Widget) => {
    if (widget === 'session') {
      return (
        <>
          <GaugeIcon pulse={streaming} />
          <span className="anti-ide-pill-label">{summaries.session}</span>
        </>
      );
    }
    if (widget === 'tokens') {
      const totalLabel = hasCount(tokenOverview.total) ? `${formatTokens(tokenOverview.total)} tok` : '— tok';
      return (
        <>
          <DbIcon pulse={streaming} />
          <span className="anti-ide-pill-label">
            <span>{totalLabel}</span>
            {tokenOverview.hitPct !== null ? (
              <>
                <span className="anti-ide-pill-sep">·</span>
                <span>{t.pillHit} <strong>{tokenOverview.hitPct}%</strong></span>
              </>
            ) : null}
          </span>
        </>
      );
    }
    return (
      <>
        <DonutIcon pct={ctxPct} streaming={streaming} />
        <span className="anti-ide-pill-label">{summaries.context}</span>
      </>
    );
  };

  return (
    <>
      <div ref={group} className="anti-ide-widget-group" data-theme={theme} role="group" aria-label={t.groupLabel}>
        {WIDGET_ORDER.map(widget => (
          <button
            key={widget}
            ref={element => { triggers.current[widget] = element; }}
            type="button"
            data-widget={widget}
            className="anti-ide-widget-trigger"
            aria-label={`${t.titles[widget]}：${summaries[widget]}`}
            aria-expanded={open === widget}
            aria-controls={open === widget ? CONTAINER_IDE_POPOVER_ID : undefined}
            aria-haspopup="dialog"
            title={summaries[widget]}
            onClick={() => setOpen(current => current === widget ? null : widget)}
          >
            {renderPillInner(widget)}
          </button>
        ))}
      </div>
      {open ? createPortal(
        <div
          id={CONTAINER_IDE_POPOVER_ID}
          className="anti-ide-popover"
          data-theme={theme}
          ref={panel}
          tabIndex={-1}
          role="dialog"
          aria-label={t.titles[open]}
          data-widget={open}
        >
          {state.error ? (
            <p className="anti-ide-error" role="status">
              {state.error === 'stats_read_failed' ? t.readStatsError : state.error}
            </p>
          ) : null}
          <IdeWidgetContent
            widget={open}
            state={state}
            lang={lang}
            selectedPool={selectedPool}
            onSelectPool={setSelectedPool}
            onRefreshQuota={handleRefreshQuota}
            refreshingQuota={refreshingQuota}
            tokenDrawerOpen={tokenDrawerOpen}
            onToggleTokenDrawer={() => setTokenDrawerOpen(v => !v)}
            onChangeLang={handleChangeLang}
          />
        </div>,
        document.querySelector('.monaco-workbench') ?? document.body
      ) : null}
    </>
  );
}

if (typeof document !== 'undefined') {
  let container: HTMLDivElement | null = null;
  let frame = 0;
  const attach = () => {
    frame = 0;
    const bar = document.querySelector('.part.statusbar .right-items');
    if (!bar || container?.parentElement === bar) return;
    if (!container) {
      if (document.getElementById(CONTAINER_IDE_STATUSBAR_ID)) return;
      container = document.createElement('div');
      container.id = CONTAINER_IDE_STATUSBAR_ID;
      container.className = 'anti-ide-widgets';
      createRoot(container).render(<IdeWidgets />);
    }
    bar.append(container);
  };
  new MutationObserver(() => { if (!frame) frame = requestAnimationFrame(attach); }).observe(document.documentElement, { childList: true, subtree: true });
  attach();
}
