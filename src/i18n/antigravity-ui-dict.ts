/**
 * Antigravity 2.0 Desktop UI Translation Dictionary
 * Comprehensive bilingual mapping for Google Antigravity 2.0 Electron interface.
 *
 * Deliberately absent, i.e. stays English: product names (Antigravity, Google AI Pro/Ultra, Chrome,
 * Walkthrough), developer terms (Artifacts, Artifact, Diff, Code Diff, Tokens, Review, Turbo, Tab,
 * Fork, MCP, API, JavaScript, Tier), the Customizations tabs (Skills, Rules, MCP Servers, Plugins,
 * Hooks), and the thinking-effort ladder (Low / Medium / High / Extra High). Adding Chinese for these
 * is a regression; scripts/test-i18n-engine.cjs asserts they stay out of the map.
 */

export interface DynamicRule {
  pattern: RegExp;
  replace: string | ((substring: string, ...args: string[]) => string);
}

// Exact match dictionary (trimmed text -> Chinese)
export const UI_EXACT_MAP: Record<string, string> = {
  // === Navigation & Sidebar ===
  'New Conversation': '新建对话',
  'Conversation History': '对话历史',
  'Automations': '自动化',
  'Customizations': '自定义配置',
  'Projects': '项目',
  'Settings': '设置',
  'Display Options': '显示选项',
  'Create New Project': '新建项目',
  'Project options': '项目选项',
  'New Conversation in Project': '在项目中新建对话',
  'More options': '更多选项',
  'Pin conversation': '置顶对话',
  'Unpin conversation': '取消置顶',
  'Archive conversation': '归档对话',
  'Unarchive conversation': '取消归档',
  'Delete conversation': '删除对话',
  'Search conversations': '搜索对话',
  'Show All': '显示全部',
  'Not in Project': '未分类对话',
  'Pinned': '已置顶',
  'Recent': '最近对话',
  'Archived': '已归档',
  'No conversations': '暂无对话',
  'No projects': '暂无项目',
  'Sidebar': '侧边栏',

  // === Conversation Workspace & Input Box ===
  'Ask anything, @ to mention, / for actions': '输入任何内容，@ 引用，/ 触发快捷操作',
  'Ask anything, @ to mention': '输入任何内容，@ 引用',
  'Message subagent, @ to mention, / for actions': '发送指令给 Subagent，@ 引用，/ 触发快捷操作',
  'Message subagent, @ to mention': '发送指令给 Subagent，@ 引用',
  'Type a message...': '输入消息…',
  'Fast': '快速模式',
  'Reasoning': '深度思考',
  'Reasoning Effort': '思考强度',
  'Thinking Effort': '思考强度',
  'Off': '关闭',
  // Low / Medium / High / Extra High stay English: the effort ladder reads faster untranslated.
  'Model': '模型',
  'Select model': '选择模型',
  'Clear conversation': '清空对话',
  'Compact conversation': '压缩对话上下文',
  'Stop': '停止',
  'Run': '运行',
  'Send': '发送',
  'Regenerate': '重新生成',
  'Retry': '重试',
  // Tokens, Review, Turbo stay English (developer terms)
  'Thinking tokens': '思考 Token',
  'Context window': '上下文窗口',
  'Edit prompt': '编辑提示词',
  'Attach files': '附加文件',
  'Add attachment': '添加附件',
  'Voice input': '语音输入',
  'Every command requires approval.': '每个命令都需要手动批准。',
  'Ask before sensitive operations.': '在执行敏感操作前进行询问。',
  'Run all commands without restrictions.': '无限制直接执行所有命令。',

  // === Agent Actions, Tools & Status Indicators ===
  'Thinking...': '深度思考中…',
  'Running command': '执行命令',
  'Analyzing directory': '分析目录',
  'Searching the web': '搜索网络',
  'Checking git status': '检查 Git 状态',
  'Running tests': '运行测试',
  'Searching code': '搜索代码',
  'Reading file': '读取文件',
  'Editing file': '编辑文件',
  'Writing to file': '写入文件',
  'Invoking subagent': '调用 Subagent',
  'Directory analysis': '目录分析',
  'Web search': '网页搜索',
  'Git status check': 'Git 状态检查',
  'Test execution': '测试执行',
  'Code search': '代码检索',
  'View details': '查看详情',
  'Hide details': '隐藏详情',
  'Proceed': '继续执行',
  'Cancel': '取消',
  'Accept': '接受',
  'Reject': '拒绝',
  'Confirm': '确认',
  'Save': '保存',
  'Close': '关闭',
  'Delete': '删除',
  'Done': '完成',
  // 'Error' stays English (raw status string).
  'Failed': '失败',
  'Copy': '复制',
  'Copied': '已复制',
  'Copied!': '已复制！',
  'Copy code': '复制代码',
  'Open in editor': '在编辑器中打开',
  'Analyzed': '已分析',
  'Edited': '已编辑',
  'Load older messages': '加载更早的消息',
  'Artifact updated by agent': 'Artifact 已由智能体更新',
  'Conversation Log': '对话日志',
  'File': '文件',
  'View': '视图',
  'Window': '窗口',
  'Help': '帮助',

  // === Artifacts & Side Panels ===
  // 'Artifacts', 'Artifact', 'Code Diff', 'Walkthrough' stay English (core platform concepts).
  'Implementation Plan': '实现计划',
  'Files changed': '已更改文件',
  'Download': '下载到本地',
  'Copy to clipboard': '复制到剪贴板',
  'Preview': '预览',
  'Console': '控制台',
  'Terminal': '终端',
  'Problems': '问题',
  'Output': '输出',

  // === Settings Modal Navigation Tabs ===
  'General': '通用',
  'Application': '应用程序',
  'Appearance': '外观与视觉',
  'Models': '模型配置',
  'Conversations': '对话管理',
  'Shortcuts': '快捷键指南',
  'Provide Feedback': '提供反馈',
  'Account': '用户账户',
  'Usage Stats': '用量与统计',
  'Experimental': '实验性特性',

  // === Settings: Account & Preferences ===
  'Manage your plan, credentials, and general preferences.': '管理您的订阅计划、身份凭据与通用偏好设置。',
  'Enable Telemetry': '允许上报遥测数据',
  'When toggled on, Antigravity collects usage data to help Google enhance performance and features.': '开启后，Antigravity 将收集诊断与使用数据以帮助 Google 持续优化性能与体验。',
  'Marketing Emails': '接收官方资讯邮件',
  'Receive product updates, tips, and promotions from Google Antigravity via email.': '通过电子邮件接收来自 Google Antigravity 的产品更新、使用技巧和优惠信息。',
  'Your Plan:': '当前订阅：',
  // 'Google AI Pro' / 'Google AI Ultra' stay English (brand names).
  'You can upgrade to a Google AI Ultra plan to receive higher rate limits.': '升级至 Google AI Ultra 计划可获得更高的速率上限。',
  'Upgrade': '立即升级',
  'Sign Out': '退出当前登录',
  'Not Signed In': '未登录',
  'Sign in to use Antigravity!': '登录以使用 Antigravity！',
  'Sign In': '立即登录',
  'Email': '邮箱地址',
  'By using this app, you agree to its': '使用本应用程序即表示您同意其',
  'Terms of Service': '服务条款',
  'Privacy Policy': '隐私政策',

  // === Settings: Execution & Agent Behavior ===
  'Configure agent execution, queued message delivery, and permissions.': '配置智能体执行流程、排队消息发送机制及权限控制策略。',
  'Manage project folders, agent settings, and permissions.': '管理项目文件夹、智能体设置及权限。',
  'Agent settings and permissions for conversations outside of projects.': '管理项目外部对话的智能体设置与权限。',
  'Folders': '项目文件夹',
  '+ Add Folder': '+ 添加文件夹',
  'Add Folder': '添加文件夹',
  'Agent Settings': '智能体设置',
  'Inherit Global': '继承全局设置',
  'Inherits your Global Permissions when working in this project.': '在此项目中工作时继承您的全局安全权限。',
  'Local Permissions': '本地项目权限',
  'Also includes': '同时包含',
  'when working in this project.': '在此项目中工作时。',
  'when working': '工作时',
  'in these conversations': '在此类对话中。',
  'Learn more.': '了解更多。',
  'Learn more': '了解更多',
  'File Access Rules': '文件访问规则',
  'Configure allowed and denied paths for file reads and writes.': '配置允许和禁止读写的文件路径白名单。',
  'Terminal Commands': '终端命令规则',
  'Configure allowed terminal commands.': '配置允许执行的终端命令。',
  'MCP Tools': 'MCP 工具',
  'Configure external tools via Model Context Protocol.': '配置通过模型上下文协议 (MCP) 调用的外部工具。',
  'Execution': '智能体执行',
  'Queued Messages': '排队消息处理',
  'Configure when follow-up messages are sent.': '配置后续追加消息的发送与处理时机。',
  'Queue': '排队等待',
  'Send Immediately': '立即直接发送',
  'Keyboard shortcuts': '键盘快捷键',
  'Global Permissions': '全局安全权限',
  'Security Preset': '安全模式预设',
  'Controls the actions the agent can take.': '控制智能体可执行的操作。',
  'Requires manual review for all terminal commands and file accesses outside of the working folders.': '对所有终端命令及工作目录外的文件访问都需要手动审查。',
  'Full machine': '完全机器权限',
  'All terminal commands require review. The agent can read or write to any file in the machine.': '所有终端命令都需要审查。智能体可以读写本机上的任意文件。',
  'Disables all safety barriers for maximal iteration velocity.': '关闭所有安全防护栏以实现最大迭代效率。',
  'Custom': '自定义设置',
  'Manually customize individual settings.': '手动自定义各项配置。',
  'Learn more about': '深入了解',
  'Turbo mode': '极速运行模式',
  'Tool Permissions': '工具调用权限',
  'Modify permissions for file, terminal, and MCP tools.': '配置针对文件系统、终端命令行以及外部 MCP 工具的执行权限。',
  'Agent Behavior': '智能体自主行为',
  'Plan Review Policy': '计划审查策略',
  'Whether the agent asks you to review its documents.': '智能体是否请你审查其生成的文档。',
  'Always Ask': '总是主动询问',
  'Always Proceed': '总是直接执行',
  'Open': '打开',
  'Type': '输入指令',
  'and select': '并选择',
  'to have the agent generate a plan.': '以让智能体生成计划。',
  'Modified in': '所属工作区：',
  'Network Permissions': '网络访问权限',
  'Network Access Rules': '网络访问规则',
  'Configure allowed and denied URLs for reading.': '配置允许或拦截智能体读取访问的 URL 域名与白名单。',
  'Terminal & Tooling Permissions': '终端与工具箱权限',
  'Commands Outside Sandbox': '沙盒外命令执行',
  'Configure allowed commands outside the sandbox.': '配置允许在隔离沙盒外部直接执行的系统命令与可执行文件。',

  // === Settings: Browser Subagent ===
  'Browser': '浏览器',
  'Configure the browser subagent. It requires': '配置浏览器自主子代理。该功能依赖本地安装的',
  'Google Chrome': 'Google Chrome 浏览器',
  'to be installed.': '作为运行环境。',
  'The browser subagent can be invoked by typing /browser in the conversation input box.': '在对话输入框中键入 /browser 即可调用浏览器子代理进行自动化网页交互。',
  'Browser Javascript Execution Policy': '浏览器 JavaScript 脚本执行策略',
  'Controls whether the agent can run custom JavaScript to automate complex browser actions.': '控制智能体是否可以运行自定义 JS 脚本来实现深度网页自动化操作。',
  'Disabled': '禁用',
  'Block all browser JavaScript execution.': '阻止所有浏览器 JavaScript 执行。',
  'Prompt for approval before running browser scripts.': '在运行浏览器脚本前提示审批。',
  'Allow All': '允许全部',
  'Allow full browser script execution without prompting.': '允许完全执行浏览器脚本，无需提示。',
  'Request Review': '请求审查',
  'Browser Actuation Rules': '浏览器页面交互规则',
  'Configure allowed and denied URLs for browser actuation.': '配置允许或禁止智能体进行点击、输入等交互行为的目标网址。',

  // === Settings: Appearance & Themes ===
  'Configure the agent\'s visual theme and display preferences.': '配置智能体工作区的界面视觉主题与显示偏好。',
  'Theme': '界面主题',
  'Contrast': '显示对比度',
  'Default': '标准默认',
  'Strong': '高对比度',
  'Dark Theme': '深色模式',
  'Light Theme': '浅色模式',
  'System': '跟随系统设置',
  'Preset': '色彩预设',
  'Default Dark': '默认深色',
  'Edit': '编辑',
  'Background': '背景色',
  'Foreground': '前景色',
  'Accent': '强调色',
  'Chat Settings': '对话偏好设置',
  'Verbose Agent Chat': '智能体详细对话模式',
  'Display and preserve intermediate thinking steps.': '显示并保留智能体的中间思考过程与推理步骤。',
  'Conversation Width': '对话区域显示宽度',
  'Configure the maximum width of the conversation panel.': '配置对话面板的最大显示宽度。',
  'Narrow': '紧凑窄幅',
  'Wide': '宽屏显示',
  'Project 4K': 'Project 4K 视觉体验',
  'Choose the experience that fits how you work.': '选择符合您工作习惯的界面体验。',
  'Choose between the Default and Project 4K experience.': '在默认标准体验与 Project 4K 高级体验之间切换。',

  // === Settings: Editor Settings ===
  'Editor Settings': '编辑器设置',
  'Configure editor-specific behaviors and shortcuts.': '配置编辑器专属行为与快捷键偏好。',
  'Marketplace': '扩展市场',
  'Marketplace Item URL': '扩展项目基础 URL',
  'Changes the base URL on each extension page. You must restart Antigravity to use the new marketplace after changing this value.': '更改每个扩展详情页的基础 URL。修改此值后必须重启 Antigravity 方可生效。',
  'Marketplace Gallery URL': '扩展市场索引 URL',
  'Changes the base URL for marketplace search results. You must restart Antigravity to use the new marketplace after changing this value.': '更改扩展市场搜索结果的基础 URL。修改此值后必须重启 Antigravity 方可生效。',
  'Selection Actions': '选中文本操作栏',
  'Show Selection Actions': '显示选中文本快捷操作',
  'Show "Edit" and "Chat" buttons when selecting text in the editor.': '在编辑器中选中文本时显示「编辑」与「提问」快捷浮动按钮。',
  'To modify editor settings, open Settings within the editor window.': '如需修改编辑器完整设置，请在编辑器窗口中打开设置。',
  'Open Editor Settings': '打开编辑器设置',
  'Configure tab completion, suggestions, and navigation behavior.': '配置 Tab 键代码补全、建议与导航控制行为。',

  // === Settings: Jetski Chat ===
  'Jetski Chat': 'Jetski 聊天集成',
  'Configure a chat bot so you can use Jetski directly from Google Chat.': '配置聊天机器人以便直接从 Google Chat 中使用 Jetski。',
  'For help, visit': '如需获取帮助，请访问',
  'or join the': '或加入',
  'chat space': '聊天空间',
  'Setup': '配置向导',
  'Bot Name': '机器人名称',
  'Avatar URL': '头像图片 URL',
  'Setup Jetski Chat': '配置 Jetski 聊天机器人',

  // === Customizations & Plugins ===
  // Customizations tabs (Skills / Rules / MCP Servers / Plugins / Hooks) stay English.
  'Add Customization': '添加自定义配置',
  'Enable': '启用',
  'Disable': '停用',
  'Installed': '已安装',
  'The breakdown below shows token usage from customizations like rules, skills, and MCP. If a budget is exceeded, large rules are demoted to path pointers and large customizations are excluded automatically.': '下方明细显示了来自规则、技能和 MCP 等自定义配置的 Token 用量。若超出预算，较大的规则将降级为路径指针，较大的自定义配置将被自动排除。',
  'Other Customizations': '其他自定义配置',
  'tokens (': 'Token (',
  'tokens)': 'Token)',
  'Global': '全局',
  'Plugin:': '插件:',
  'Token Usage': 'Token 消耗统计',
  'Loading token usage...': '正在加载 Token 用量...',
  'Loading workspace customizations...': '正在加载工作区自定义配置...',
  'Configure default behaviors, skills, and MCP servers.': '配置默认智能体行为、技能 (Skills) 与 MCP 服务。',

  // === Settings: Project Danger Zone ===
  'Danger Zone': '危险操作区域',
  'Delete Project': '删除项目',
  'Permanently delete': '永久删除',
  'including': '包含',
  'Project': '当前项目',

  // === Settings: Application ===
  'Manage Antigravity app settings.': '管理 Antigravity 应用程序偏好设置。',
  'Prevent Sleep': '阻止系统休眠',
  'Prevent the computer from sleeping while the app is running.': '在应用程序运行时阻止计算机进入睡眠状态。',
  'Keep In Menu Bar': '常驻任务栏 / 菜单栏',
  'Keep the app accessible from the menu bar and running in the background when all windows are closed.': '在所有窗口关闭后保持应用在后台运行，并可通过托盘或菜单栏访问。',
  'Remote Control': '远程控制',
  'Enable Remote Control': '启用远程控制',
  'Work with local agents from another device.': '支持从其他设备访问并调度本地智能体。',
  'Notifications': '系统通知',
  'Notification Settings': '通知偏好设置',
  'To modify notification settings, open your operating system\'s system preferences.': '如需修改通知设置，请打开操作系统的系统偏好设置。',
  'Open System Preferences': '打开系统偏好设置',
  'Windows Subsystem for Linux': '适用于 Linux 的 Windows 子系统 (WSL)',
  'Run the app against a Linux environment. Connecting relaunches the app into the selected WSL distro.': '在 Linux 环境中运行本应用。连接后将使用选定的 WSL 发行版重启应用。',
  'Connect': '连接',
  'Version': '版本信息',
  'App version': '应用程序版本',
  'Advanced Settings': '高级设置',

  // === Settings: Feedback ===
  'Feedback Type': '反馈类型',
  'Bug Report': 'Bug 反馈',
  'Feature Request': '功能建议',
  'Auth and Billing': '认证与计费',
  'Remote Control Issue': '远程控制问题',
  'General Feedback': '通用反馈',
  'Description': '详细描述',
  'Please describe the issue in detail. The more actionable your feedback, the quicker our team can address your request. Some helpful information includes:': '请详细描述您遇到的问题。您的反馈越具体可操作，我们的团队就能越快响应处理。建议包含以下信息：',
  'Steps to reproduce the issue': '复现步骤',
  'Expected behavior': '预期表现',
  'Actual behavior': '实际表现',
  'Any error messages': '任何报错信息',
  'Any relevant information': '其他相关信息',
  'Steps to Reproduce': '详细复现步骤',
  'Attach a screenshot (optional)': '附带屏幕截图 (可选)',
  'Attach Antigravity server logs': '附带 Antigravity 服务运行日志',
  'Submit': '提交反馈',
  'Legal Help': '法律合规支持',
  'Visit': '访问',
  'to ask for content changes for legal reasons.': '以依法申请内容更正或删除。',

  // === Settings: Shortcuts ===
  'Keyboard shortcuts for quick navigation and control.': '用于快速导航和操作控制的键盘快捷键。',
  'Conversation': '对话操作',
  'Plan': '计划制定',
  'Recommended': '常用推荐',
  'Open Conversation Picker': '打开会话选择器',
  'Open File Search': '打开文件检索',
  'Focus Input': '聚焦输入框',
  'Navigation': '导航浏览',
  'File Picker': '文件选择器',
  'Select Previous Conversation': '选择上一个对话',
  'Select Next Conversation': '选择下一个对话',
  'Previous Pane Tab': '上一个面板标签页',
  'Next Pane Tab': '下一个面板标签页',
  'Open Settings': '打开设置',
  'Toggle Model Selector': '切换模型选择器',
  'Toggle Voice Recording': '开启/关闭语音录入',
  'Find in Pane': '在面板中查找',
  'Add to Chat/Quote': '添加至聊天/引用',
  'Archive This Conversation': '归档当前对话',
  'Layout Controls': '界面布局控制',
  'Toggle Sidebar': '展开/折叠侧边栏',
  'Toggle Auxiliary Pane': '展开/折叠辅助侧栏',
  'Toggle Maximize Auxiliary Pane': '最大化/还原辅助侧栏',
  'Toggle Overview Panel': '展开/折叠概览面板',
  'Toggle Terminal': '展开/折叠终端',

  // === Settings: Models & Quota ===
  'Models & Usage': '模型与用量',
  'Manage your model quota and credits.': '管理您的模型配额与抵扣积分。',
  'Model Credits': '模型额度积分',
  'Enable AI Credit Overages': '允许超额使用 AI 积分',
  'When toggled on, Antigravity will use your AI credits to fulfill model requests once you\'re out of model quota. Antigravity will always use your model quota first before using AI credits.': '开启后，当您的模型配额用尽时，Antigravity 将使用您的 AI 积分继续处理模型请求。Antigravity 将始终优先消耗模型配额，配额不足时才会消耗积分。',
  'Model Quota': '模型配额',

  // === Settings: Developer ===
  'Developer': '开发者选项',
  'Developer-only tools. These settings are stored locally in this browser and do not affect other users.': '开发者专属工具。这些设置仅保存在本地当前浏览器中，不会影响其他用户。',
  'Regroup Google3 Chats': '重新归类 Google3 对话',
  'Google3 chats will be regrouped into their workspaces in the sidebar.': 'Google3 对话将重新归类至侧边栏对应的工作区中。',
  'This migration may mess up your settings, chats, and sidebar.': '此迁移操作可能会影响您的设置项、历史对话以及侧边栏结构。',
  'Follow the guide at': '请遵循以下指引：',
  'to back up your data and run the migration.': '以提前备份您的个人数据并完成迁移。',

  // === Plugins / Customizations ===
  'Build With Google Plugins': 'Build With Google 插件',
  'Browse and enable plugins from the Build With Google catalog.': '浏览并启用来自 Build With Google 目录的功能插件。',
  'Customize': '个性化自定义'
};

// Sentence-case view so variants like "New conversation" still translate.
const UI_EXACT_MAP_LOWER: Record<string, string> = Object.fromEntries(
  Object.entries(UI_EXACT_MAP).map(([en, zh]) => [en.toLowerCase(), zh])
);

export function lookupTranslation(trimmed: string): string | undefined {
  // Object.hasOwn avoids returning inherited members (constructor, toString, __proto__, ...).
  if (Object.hasOwn(UI_EXACT_MAP, trimmed)) return UI_EXACT_MAP[trimmed];
  const lower = trimmed.toLowerCase();
  return Object.hasOwn(UI_EXACT_MAP_LOWER, lower) ? UI_EXACT_MAP_LOWER[lower] : undefined;
}

// Dynamic RegExp rules for numbers, elapsed times, and variable strings
export const UI_DYNAMIC_RULES: DynamicRule[] = [
  // Thought for 12.3s / Thought for 4 seconds
  {
    pattern: /^Thought for (\d+(?:\.\d+)?)\s*(?:s|secs?|seconds?)$/i,
    replace: '已思考 $1 秒'
  },
  // Thought for 1m 20s
  {
    pattern: /^Thought for (\d+)\s*(?:m|mins?|minutes?)\s*(\d+)\s*(?:s|secs?|seconds?)$/i,
    replace: '已思考 $1 分 $2 秒'
  },
  // Thought for 2m / Thought for 3 minutes
  {
    pattern: /^Thought for (\d+(?:\.\d+)?)\s*(?:m|mins?|minutes?)$/i,
    replace: '已思考 $1 分钟'
  },
  // Thought for 1h / Thought for 2 hours
  {
    pattern: /^Thought for (\d+(?:\.\d+)?)\s*(?:h|hrs?|hours?)$/i,
    replace: '已思考 $1 小时'
  },
  // Worked for 12.3s / Worked for 45s
  {
    pattern: /^Worked for (\d+(?:\.\d+)?)\s*(?:s|secs?|seconds?)$/i,
    replace: '已工作 $1 秒'
  },
  // Worked for 1m 20s
  {
    pattern: /^Worked for (\d+)\s*(?:m|mins?|minutes?)\s*(\d+)\s*(?:s|secs?|seconds?)$/i,
    replace: '已工作 $1 分 $2 秒'
  },
  // Worked for 1m / Worked for 12m
  {
    pattern: /^Worked for (\d+(?:\.\d+)?)\s*(?:m|mins?|minutes?)$/i,
    replace: '已工作 $1 分钟'
  },
  // Worked for 1h / Worked for 2 hours
  {
    pattern: /^Worked for (\d+(?:\.\d+)?)\s*(?:h|hrs?|hours?)$/i,
    replace: '已工作 $1 小时'
  },
  // Show 1 breakdown / Show 7 breakdowns
  {
    pattern: /^Show (\d+)\s*breakdowns?$/i,
    replace: '展开查看 $1 项明细'
  },
  // Hide 1 breakdown / Hide 7 breakdowns
  {
    pattern: /^Hide (\d+)\s*breakdowns?$/i,
    replace: '收起 $1 项明细'
  },
  // 5m ago / 2h ago / 3d ago
  {
    pattern: /^(\d+)\s*m\s*ago$/i,
    replace: '$1 分钟前'
  },
  {
    pattern: /^(\d+)\s*h\s*ago$/i,
    replace: '$1 小时前'
  },
  {
    pattern: /^(\d+)\s*d\s*ago$/i,
    replace: '$1 天前'
  },
  // Relative time compact labels: 22h, 1d, 3d, 7d, 1mo, 1y (strictly lowercase to avoid colliding with 1M, 2D, 3D)
  {
    pattern: /^(\d+)(m|h|d|mo|y)$/,
    replace: (_match, num, unit) => {
      if (unit === 'm') return `${num} 分钟`;
      if (unit === 'h') return `${num} 小时`;
      if (unit === 'd') return `${num} 天`;
      if (unit === 'mo') return `${num} 个月`;
      if (unit === 'y') return `${num} 年`;
      return `${num}${unit}`;
    }
  },
  // Danger zone project deletion description
  {
    pattern: /^Permanently delete (.+?) including (\d+) active conversations? and (\d+) archived conversations?\.?$/i,
    replace: '永久删除 $1，包含 $2 个活动对话与 $3 个归档对话。'
  },
  // Conversation count badges in danger zone
  {
    pattern: /^(\d+)\s*active conversations?\s*and\s*(\d+)\s*archived conversations?$/i,
    replace: '$1 个活动对话与 $2 个归档对话'
  },
  {
    pattern: /^(\d+)\s*active conversations?$/i,
    replace: '$1 个活动对话'
  },
  {
    pattern: /^(\d+)\s*archived conversations?$/i,
    replace: '$1 个归档对话'
  },
  // Send feedback as email
  {
    pattern: /^Send feedback as\s+(.+)$/i,
    replace: '以此身份发送反馈：$1'
  },
  // Files count: 3 files / 1 file
  {
    pattern: /^(\d+)\s*files?$/i,
    replace: '$1 个文件'
  },
  // 9 files changed / 9 files changed +839 -7
  {
    pattern: /^(\d+)\s*files?\s*changed(?:\s+(\+\d+\s*-\d+.*))?$/i,
    replace: (_m, count, diff) => diff ? `${count} 个文件已修改 ${diff}` : `${count} 个文件已修改`
  },
  // Modified in ...
  {
    pattern: /^Modified in\s+(.+)$/i,
    replace: '属于 $1'
  }
];

// Elements and containers that MUST NEVER be translated
export const EXCLUSION_SELECTORS = [
  'pre',
  'code',
  '.prism',
  '.syntax-highlighter',
  '[data-syntax-highlighter]',
  '[data-message-content]',
  '.prose',
  '.markdown-body',
  'textarea',
  '[contenteditable="true"]',
  'input[type="text"]:focus',
  '.monaco-editor',
  '.xterm',
  '#antigravity-stats-settings-content', // Already handled by Stats i18n
  '#antigravity-stats-modal-content'     // Already handled by Stats i18n
];
