/**
 * Chinese translations for the shared stats UI, split out of translations.ts so the
 * desktop bundle can swap this module for the empty stub (vite.bundle.config.ts
 * resolve.alias) and ship the real strings inside the optional zh-pack instead.
 * The IDE bundle keeps this module inlined. LanguageContext merges it under the
 * `zh` key, so the object shape mirrors the `en` dictionary in translations.ts.
 */
export const zhTranslations: Record<string, string> = {
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
  monthlyQuotaShort: '4周容量',
  monthlyCapacityTitle: '4周折算总容量',
  quotaRingsRegionLabel: '多模型周配额与月容量视图',
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
  statusBarModeDetailed: '状态栏：详细',
  statusBarModeStandard: '状态栏：标准',
  statusBarModeCompact: '状态栏：简洁',
  statusBarModeToggleTitle: '切换输入框状态栏显示（详细三胶囊 / 标准精简三胶囊 / 简洁仅上下文圆环）',

  // Subscription & Quota
  subscriptionQuotaTitle: '订阅额度与官方 API 价值',
  liveQuotaDetected: '官方配额已实时同步',
  weeklyQuota: '本周配额已用',
  weeklyGeminiTitle: 'Gemini 系列',
  weeklyClaudeTitle: 'Claude & GPT',
  weeklyArgonTitle: 'Gemini 4 Argon',
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
  pricingFormulaNote: '价格按各模型官方 API 费率（每百万 Token）精确核算：Gemini Flash $0.75/$0.075/$3.75、Hydrogen $1.50/$0.075/$7.50、Carbon/Argon $2/$0.10/$10、Neon $3/$0.15/$15、3.1 Pro $2/$0.20/$12（≤200K）或 $4/$0.40/$18（>200K）、Claude 5.5 $2-$4/$0.10-$0.20/$10-$20、Claude 4.6 $3-$5/$0.30-$0.50/$15-$25、GPT-OSS 及未收录模型 $0',
  cnyEquivalent: '折合人民币',
  tierFree: '免费层',
  tierPro: 'Google AI Pro ($19.99/月)',
  tierUltra5x: 'Google AI Ultra 5x ($99.99/月)',
  tierUltra20x: 'Google AI Ultra 20x ($199.99/月)',
  tierAutoBadge: '自动识别',
  tierAutoTooltip: '已根据当前登录账户自动同步订阅级别',
  tierAutoUltraTooltip: '已识别为 Ultra 订阅，请按实际套餐手动选择 5x 或 20x',
  tierResetAuto: '恢复自动',
  tierResetAutoTooltip: '当前为手动切换，点击恢复自动识别的订阅级别',
  perMonth: '/月',
  netSavingsBooked: '净节省价值',

  // Local Process Proxy
  proxyTitle: '本地进程代理',
  proxyDesktopLabel: '桌面端 (Desktop)',
  proxyIdeLabel: 'IDE 扩展端',
  proxyInstalled: '已启用',
  proxyNotInstalled: '未启用',
  proxyPendingRestart: '待重启生效',
  proxyDllMissing: 'DLL 缺失',
  proxyConfigMissing: '配置缺失',
  proxyDirectMode: '直连模式',
  proxyRunning: '运行中',
  proxyIdle: '未运行',
  proxyLogLabel: '日志目录',
  proxyCopyLogPath: '复制',
  proxyCopied: '已复制',
  proxyOpenLogDir: '打开目录',
};
