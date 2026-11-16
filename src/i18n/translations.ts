import { zhTranslations } from './translations-zh';

export type Language = 'en' | 'zh';

const en = {
  // Header
  statsTitle: 'Stats',
  refreshTitle: 'Refresh statistics',
  timeRange_today: 'Today',
  timeRange_1d: 'Today + yesterday',
  timeRange_7d: 'Last 7 days',
  timeRange_30d: 'Last 30 days',
  timeRange_all: 'All time',

  // KPIs
  kpiLifetimeTokens: 'Total tokens (incl. cache reads)',
  days: 'days',

  // Bento summary & trend
  compositionByChannel: 'Composition by channel',
  dailyTrendTitle: 'Daily usage trend',
  dailyTrendUnit: 'tokens / day',
  monthlyQuotaShort: 'Monthly quota',
  monthlyCapacityTitle: 'Monthly quota · 4w',
  quotaRingsRegionLabel: 'Multi-model weekly quota and monthly capacity view',
  weeklyQuotaShort: 'Weekly quota',
  quotaUsedShort: 'Used',
  quotaCapacityShort: 'Capacity',
  quotaHeroBasis: 'API value used ÷ subscription fee',

  // Token Activity
  tokenActivityTitle: 'Activity history',
  activityLevelsTitle: 'Activity level',
  peak: 'Peak',
  less: 'Less',
  more: 'More',
  tasksExecuted: 'tasks',
  noActivity: 'No activity',
  tokensWord: 'tokens',
  promptChannel: 'Prompt Channel',
  generationChannel: 'Generation Channel',
  cacheHitSuffix: 'hit',
  thinkingShareSuffix: 'thinking',
  keyboardNavHint: '← → ↑ ↓ Navigate · Enter Pin · Esc Close',
  tier0: 'Tier 0 · Inactive',
  tier1: 'Tier 1 · Light',
  tier2: 'Tier 2 · Moderate',
  tier3: 'Tier 3 · Frequent',
  tier4: 'Tier 4 · Peak',

  // Token channels
  inputChannelTitle: 'Input tokens',
  outputChannelTitle: 'Output tokens',
  cacheReadLabel: 'Cache reads',
  rawInputLabel: 'Uncached input',
  thinkingTokensLabel: 'Thinking',
  responseTokensLabel: 'Response',

  timeRangeLabel: 'Summary time range',
  periodSummary: 'Period summary',
  activeDays: 'Active days',
  incompleteBreakdown: 'Complete breakdown unavailable',
  periodBasis: 'Lifetime totals come from exact SQLite usage. Daily ranges pair usage rows with transcript planner dates, falling back to SQLite step timestamps when logs are absent.',
  noData: 'No recorded activity',
  close: 'Close',

  // Theme & Window
  switchLanguage: 'Switch language',

  // Subscription & Quota
  subscriptionQuotaTitle: 'Subscription Quota & API Value',
  liveQuotaDetected: 'Official Quota Synced',
  weeklyQuota: 'Weekly Quota',
  weeklyGeminiTitle: 'Gemini Models',
  weeklyClaudeTitle: 'Claude & GPT',
  weeklyArgonTitle: 'Gemini 4 Argon',
  monthlyQuota: 'Monthly Value & ROI (4 Weeks)',
  usedPercent: 'Used',
  remainingPercent: 'Remaining',
  weeklyCapEst: 'Est. 100% Weekly Capacity',
  weeklyCostConsumed: 'Current Cycle API Value',
  monthlyCostConsumed: 'Monthly API Value (4-Week)',
  monthlyCapEst: 'Est. Monthly Capacity (4×Week)',
  planFee: 'Subscription Plan',
  roiMultiple: 'Value ROI',
  resetCountdown: 'Resets in',
  resetAt: 'Reset time',
  selectPlan: 'Subscription Plan',
  officialRatesBadge: 'Official API Rates',
  pricingFormulaNote: 'Prices computed from official API model rates per 1M tokens: Gemini Flash $0.75/$0.075/$3.75, Hydrogen $1.50/$0.075/$7.50, Carbon/Argon $2/$0.10/$10, 3.1 Pro $2/$0.20/$12 (<=200K) or $4/$0.40/$18 (>200K), Claude 5.5 $2-$4/$0.10-$0.20/$10-$20, Claude 4.6 $3-$5/$0.30-$0.50/$15-$25, GPT-OSS & unlisted $0',
  cnyEquivalent: 'CNY Approx',
  tierFree: 'Free ($0/mo)',
  tierPro: 'Google AI Pro ($19.99/mo)',
  tierUltra5x: 'Google AI Ultra 5x ($99.99/mo)',
  tierUltra20x: 'Google AI Ultra 20x ($199.99/mo)',
  tierAutoBadge: 'Auto',
  tierAutoTooltip: 'Auto-synced from active account subscription',
  tierAutoUltraTooltip: 'Ultra account detected — choose 5x or 20x manually',
  tierResetAuto: 'Restore Auto',
  tierResetAutoTooltip: 'Manually overridden — click to restore auto-detected plan',
  perMonth: '/mo',
  netSavingsBooked: 'net value saved',

  // Transparent Proxy
  proxyTitle: 'Transparent Proxy (No TUN)',
  proxyDesktopLabel: 'Desktop Client',
  proxyIdeLabel: 'Antigravity IDE',
  proxyInstalled: 'Active',
  proxyNotInstalled: 'Inactive',
  proxyRunning: 'Running',
  proxyIdle: 'Idle',
};

export const translations = {
  en,
  // Desktop builds swap ./translations-zh for the empty stub, so `zh` resolves at
  // runtime through the optional zh-pack (see LanguageContext); IDE builds inline it.
  zh: zhTranslations,
};

export type TranslationKey = keyof typeof en;
