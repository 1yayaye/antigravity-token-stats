export type Language = 'en' | 'zh';

export const translations = {
  en: {
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
    pricingFormulaNote: 'Prices computed from official API model rates (Gemini Flash $0.75/$0.075/$3.75, Pro $2/$0.20/$12, Claude $2-$4/$0.20-$0.40/$10-$20 per 1M tokens)',
    cnyEquivalent: 'CNY Approx',
    tierFree: 'Free ($0/mo)',
    tierPro: 'Google AI Pro ($19.99/mo)',
    tierUltra5x: 'Google AI Ultra 5x ($99.99/mo)',
    tierUltra20x: 'Google AI Ultra 20x ($199.99/mo)',
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
  },
  zh: {
    // Header
    statsTitle: '数据看板',
    refreshTitle: '刷新数据',
    timeRange_today: '今天',
    timeRange_1d: '今天和昨天',
    timeRange_7d: '近 7 天',
    timeRange_30d: '近 30 天',
    timeRange_all: '全部时间',

    // KPIs
    kpiLifetimeTokens: '总 Token（含缓存读取）',
    days: '天',

    // Bento summary & trend
    compositionByChannel: '构成 · 按渠道',
    dailyTrendTitle: '每日消耗趋势',
    dailyTrendUnit: 'Token / 天',
    monthlyQuotaShort: '月额度',
    weeklyQuotaShort: '周额度',
    quotaUsedShort: '已用',
    quotaCapacityShort: '容量',
    quotaHeroBasis: '已用 API 价值 ÷ 订阅费',

    // Token Activity
    tokenActivityTitle: '活跃历史',
    activityLevelsTitle: '活跃度',
    peak: '峰值',
    less: '低',
    more: '高',
    tasksExecuted: '次任务',
    noActivity: '无活动',
    tokensWord: 'Token',
    promptChannel: '输入',
    generationChannel: '输出',
    cacheHitSuffix: '命中',
    thinkingShareSuffix: '思考',
    keyboardNavHint: '← → ↑ ↓ 切换日期 · Enter 锁定详情 · Esc 关闭',
    tier0: 'Tier 0 · 无活动',
    tier1: 'Tier 1 · 轻度活跃',
    tier2: 'Tier 2 · 中度消耗',
    tier3: 'Tier 3 · 频繁编码',
    tier4: 'Tier 4 · 峰值高频',

    // Token channels
    inputChannelTitle: '输入 Token',
    outputChannelTitle: '输出 Token',
    cacheReadLabel: '缓存读取',
    rawInputLabel: '非缓存输入',
    thinkingTokensLabel: '思考',
    responseTokensLabel: '回答',

    timeRangeLabel: '汇总时间范围',
    periodSummary: '期间汇总',
    activeDays: '活跃天数',
    incompleteBreakdown: '暂无完整明细',
    periodBasis: '累计总量来自 SQLite 精确用量。按设备本地自然日汇总时，优先匹配 transcript 的 planner 日期，若日志已清理则自动回退至 SQLite 原生步骤时间戳。',
    noData: '暂无活动记录',
    close: '关闭',

    // Theme & Window
    switchLanguage: '切换语言',

    // Subscription & Quota
    subscriptionQuotaTitle: '订阅额度与官方 API 价值',
    liveQuotaDetected: '官方配额已实时同步',
    weeklyQuota: '周额度',
    monthlyQuota: '月额度与回本（4 周周期）',
    usedPercent: '已消耗',
    remainingPercent: '剩余',
    weeklyCapEst: '推算周满额价值（100% 容量）',
    weeklyCostConsumed: '本周期已用 API 价值',
    monthlyCostConsumed: '月度已用价值（4 周累计/推算）',
    monthlyCapEst: '预计月度总容量（4×周额度）',
    planFee: '订阅级别',
    roiMultiple: '回本倍数',
    resetCountdown: '距离刷新还剩',
    resetAt: '刷新时间',
    selectPlan: '选择订阅层级',
    officialRatesBadge: '官方 API 计价标准',
    pricingFormulaNote: '价格完全按各模型官方 API 费率（Gemini Flash $0.75/$0.075/$3.75、Pro $2/$0.20/$12、Claude $2-$4/$0.20-$0.40/$10-$20 每百万 Token）精确核算',
    cnyEquivalent: '折合人民币',
    tierFree: '免费层',
    tierPro: 'Google AI Pro ($19.99/月)',
    tierUltra5x: 'Google AI Ultra 5x ($99.99/月)',
    tierUltra20x: 'Google AI Ultra 20x ($199.99/月)',
    perMonth: '/月',
    netSavingsBooked: '净节省价值',

    // Transparent Proxy
    proxyTitle: '免 TUN 进程代理',
    proxyDesktopLabel: '桌面端 (Desktop)',
    proxyIdeLabel: 'IDE 扩展端',
    proxyInstalled: '已启用',
    proxyNotInstalled: '未启用',
    proxyRunning: '运行中',
    proxyIdle: '未运行',
  },
};

export type TranslationKey = keyof typeof translations['en'];
