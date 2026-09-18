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
    kpiPeakTokens: 'Highest tokens in one conversation',
    kpiLongestTask: 'Longest conversation span (incl. idle time)',
    kpiCurrentStreak: 'Current streak',
    kpiLongestStreak: 'Longest streak',
    days: 'days',

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

    // Activity Insights
    activityInsightsTitle: 'Historical usage',
    fastMode: 'Calls without thinking tokens',
    mostUsedReasoning: 'Most used model (by calls)',
    skillsExplored: 'Distinct skills used',
    totalSkillsUsed: 'Skill invocations',
    totalThreads: 'Total conversations',

    // Token Breakdown Card
    tokenBreakdownTitle: 'Input and output details',
    inputChannelTitle: 'Input tokens',
    outputChannelTitle: 'Output tokens',
    cacheReadLabel: 'Cache reads',
    rawInputLabel: 'Uncached input',
    thinkingTokensLabel: 'Thinking',
    responseTokensLabel: 'Response',
    cacheHitRateBadge: 'Cache Hit Rate',

    timeRangeLabel: 'Summary time range',
    periodSummary: 'Period summary',
    activeDays: 'Active days',
    shareOfInput: 'Share of input',
    shareOfOutput: 'Share of output',
    incompleteBreakdown: 'Complete breakdown unavailable',
    periodBasis: 'Lifetime totals come from exact SQLite usage. Daily ranges use only usage rows matched to transcript planner dates; unmatched usage is excluded from calendar-day totals.',
    noData: 'No recorded activity',
    close: 'Close',

    // Theme & Window
    switchLanguage: 'Switch language',
  },
  zh: {
    // Header
    statsTitle: '数据看板',
    refreshTitle: '刷新数据',
    timeRange_today: '当日',
    timeRange_1d: '今天和昨天',
    timeRange_7d: '近 7 天',
    timeRange_30d: '近 30 天',
    timeRange_all: '全部时间',

    // KPIs
    kpiLifetimeTokens: '总 Token（含缓存读取）',
    kpiPeakTokens: '单个对话最高 Token',
    kpiLongestTask: '最长对话跨度（含空闲时间）',
    kpiCurrentStreak: '当前连续使用天数',
    kpiLongestStreak: '最长连续使用天数',
    days: '天',

    // Token Activity
    tokenActivityTitle: '活跃历史',
    activityLevelsTitle: '活跃度',
    peak: '峰值',
    less: '低',
    more: '高',
    tasksExecuted: '次任务',
    noActivity: '无活动',
    tokensWord: 'Token',
    promptChannel: '输入侧 (Prompt Channel)',
    generationChannel: '输出侧 (Generation Channel)',
    cacheHitSuffix: '命中',
    thinkingShareSuffix: '思考',
    keyboardNavHint: '← → ↑ ↓ 切换日期 · Enter 锁定详情 · Esc 关闭',
    tier0: 'Tier 0 · 无活动',
    tier1: 'Tier 1 · 轻度活跃',
    tier2: 'Tier 2 · 中度消耗',
    tier3: 'Tier 3 · 频繁编码',
    tier4: 'Tier 4 · 峰值高频',

    // Activity Insights
    activityInsightsTitle: '历史使用统计',
    fastMode: '无思考 Token 调用占比',
    mostUsedReasoning: '最常用模型（按调用次数）',
    skillsExplored: '使用过的技能数',
    totalSkillsUsed: '技能调用次数',
    totalThreads: '累计对话',

    // Token Breakdown Card
    tokenBreakdownTitle: '输入输出明细',
    inputChannelTitle: '输入 Token',
    outputChannelTitle: '输出 Token',
    cacheReadLabel: '缓存读取',
    rawInputLabel: '非缓存输入',
    thinkingTokensLabel: '思考',
    responseTokensLabel: '回答',
    cacheHitRateBadge: '缓存命中率',

    timeRangeLabel: '汇总时间范围',
    periodSummary: '期间汇总',
    activeDays: '活跃天数',
    shareOfInput: '占输入总量',
    shareOfOutput: '占输出总量',
    incompleteBreakdown: '暂无完整明细',
    periodBasis: '累计总量来自 SQLite 精确用量。按设备本地自然日汇总时，仅纳入能与 transcript 的 planner 日期匹配的用量；无法匹配的用量不计入日期汇总。',
    noData: '暂无活动记录',
    close: '关闭',

    // Theme & Window
    switchLanguage: '切换语言',
  },
};

export type TranslationKey = keyof typeof translations['en'];
