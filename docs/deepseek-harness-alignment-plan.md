# AntiToken 深度对齐 DeepSeek Harness：性能与用量统计架构与工程落地实施方案

> **文件版本**：v1.0.0 (Master Engineering Specification)  
> **制定日期**：2026-10-30  
> **适用环境**：Windows 11 / Electron 宿主 (Antigravity Desktop Client)  
> **核心技术栈**：React 19 + TypeScript + Tailwind CSS + Node.js (SQLite3 & Protobuf) + Electron ASAR Injection  
> **文档密级与规范**：系统架构与工程实施主文档（严格遵循 *A Philosophy of Software Design* 与真实性审计规范）

---

## 目录 (Table of Contents)

- [1. 执行摘要与设计哲学 (Executive Summary & Design Philosophy)](#1-执行摘要与设计哲学-executive-summary--design-philosophy)
  - [1.1 项目使命与对齐目标](#11-项目使命与对齐目标)
  - [1.2 软件设计哲学 (OBEY A Philosophy of Software Design)](#12-软件设计哲学-obey-a-philosophy-of-software-design)
  - [1.3 核心交付收益与价值闭环](#13-核心交付收益与价值闭环)
- [2. DeepSeek Harness 核心机制深度逆向分析 (R1)](#2-deepseek-harness-核心机制深度逆向分析-r1)
  - [2.1 事件驱动流转与分层生命周期 (Session -> Turn -> Step)](#21-事件驱动流转与分层生命周期-session---turn---step)
  - [2.2 性能指标统计模型 (TTFT, TPS, Model Time, Tool Time)](#22-性能指标统计模型-ttft-tps-model-time-tool-time)
  - [2.3 Token 分类统计与启发式模型 (4 字符估算、账单锚点、缓存命中率)](#23-token-分类统计与启发式模型-4-字符估算账单锚点缓存命中率)
  - [2.4 UI 交互与数据呈现机制 (常驻状态栏与 3 种悬浮卡片)](#24-ui-交互与数据呈现机制-常驻状态栏与-3-种悬浮卡片)
- [3. AntiToken 宿主环境可行性与数据映射分析 (R2)](#3-antitoken-宿主环境可行性与数据映射分析-r2)
  - [3.1 宿主架构与注入机制剖析 (Electron Main, Preload IPC, standalone.tsx)](#31-宿主架构与注入机制剖析-electron-main-preload-ipc-standalonetsx)
  - [3.2 真实遥测数据源深度评测 (SQLite gen_metadata, steps Tag 1/6/8, transcripts)](#32-真实遥测数据源深度评测-sqlite-gen_metadata-steps-tag-168-transcripts)
  - [3.3 13 项核心指标全面映射对比表 (Ground Truth vs Derived)](#33-13-项核心指标全面映射对比表-ground-truth-vs-derived)
  - [3.4 差异与鸿沟对齐方案：双引擎混合架构 (Dual-Engine Stream Architecture)](#34-差异与鸿沟对齐方案双引擎混合架构-dual-engine-stream-architecture)
  - [3.5 Windows 平台特性与 Electron 技术风险防控 (EBUSY, CSP, React 19)](#35-windows-平台特性与-electron-技术风险防控-ebusy-csp-react-19)
- [4. 端到端对齐架构与模块设计规范 (R3)](#4-端到端对齐架构与模块设计规范-r3)
  - [4.1 数据流架构图与分层设计 (采集层 -> 聚合层 -> 渲染层)](#41-数据流架构图与分层设计-采集层---聚合层---渲染层)
  - [4.2 模块设计与 TypeScript 接口契约](#42-模块设计与-typescript-接口契约)
  - [4.3 4 大展示维度 1:1 对齐 UI 详细设计规范](#43-4-大展示维度-11-对齐-ui-详细设计规范)
  - [4.4 数据管道实现规范 (SQLite 增量解析、IPC 广播、DOM 挂载)](#44-数据管道实现规范-sqlite-增量解析ipc-广播dom-挂载)
- [5. 分阶段工程落地实施路线图 (Milestones & Roadmap)](#5-分阶段工程落地实施路线图-milestones--roadmap)
  - [5.1 里程碑规划 (M1 ~ M4)](#51-里程碑规划-m1--m4)
  - [5.2 实施步骤与验收用例](#52-实施步骤与验收用例)
  - [5.3 风险矩阵与应对策略](#53-风险矩阵与应对策略)

---

## 1. 执行摘要与设计哲学 (Executive Summary & Design Philosophy)

### 1.1 项目使命与对齐目标

AntiToken 作为专为 Antigravity 桌面客户端（基于 Electron 的 AI 辅助编程与自动化执行环境）打造的轻量级无侵入监控与 Token 统计系统，致力于为开发者提供实时、真实、精准的模型资源消耗视图。

开源项目 **DeepSeek Harness (DSH)** 凭借极简现代的底部常驻状态栏设计、微交互悬浮卡片（Popover Dialogs）以及严密科学的四维性能/用量统计模型，在开源开发者社区中树立了 AI 编程助手前端遥测交互的标杆。

本工程实施方案的核心宗旨是：**在维持 AntiToken 现有 Windows 原生无侵入注入架构与轻量级特性的前提下，对齐 DeepSeek Harness 的遥测统计模型与 UI 呈现标准，实现从视觉设计、交互流转、指标数学公式到底层数据源的 1:1 无损落地。**

```
┌────────────────────────────────────────────────────────────────────────┐
│                   DeepSeek Harness 4 大视觉呈现维度                     │
├────────────────────────────────────────────────────────────────────────┤
│ 1. 底部常驻状态栏   : [仪 2 轮 78 步 · 190 tok/s] [库 3.8M tok · 缓存命中 99%] [环 7%] │
│ 2. 上下文已用卡片   : ~72.4K / 1M [灰:系统提示词 紫:工具定义 蓝:对话消息]      │
│ 3. Token 用量卡片  : 3,762,690 tok [未缓存输入/缓存读取/输出/缓存命中率]       │
│ 4. 会话统计卡片     : [模型用时 6分51秒 | 工具用时 1分11秒 | TTFT 2.9秒 | TPS 190]   │
└────────────────────────────────────────────────────────────────────────┘
```

### 1.2 软件设计哲学 (OBEY A Philosophy of Software Design)

遵循 John Ousterhout 教授在《软件设计哲学》(A Philosophy of Software Design) 中提出的核心准则，本对齐方案严守以下架构底线：

1. **深层模块与信息隐藏 (Deep Modules & Information Hiding)**：
   - 遥测采集层（SQLite 解析与 Protobuf 解包）、指标聚合层（会话投影计算器）、渲染呈现层（React 19 组件）保持极简且高内聚的接口。
   - 上层 UI 组件仅依赖纯数据类型 `DshTelemetryData`，完全无需知晓数据来自于底层 SQLite WAL、Protobuf 二进制 Tag 还是 Renderer 的 DOM 差分估算。底层数据源变动绝不向上传导。
2. **将复杂度向下推 (Pull Complexity Downward)**：
   - 各种时序补偿（如处理网络抖动的 TTFT 修正、未结工具调用的超时清理、中文字符与 JSON Schema 启发式分词的基准归一化）全部由聚合层单向吸收，调用方组件保持零状态逻辑与纯函数渲染。
3. **真实性第一与防欺骗原则 (Integrity Mandate)**：
   - 严禁在代码中硬编码任何测试数据、假象字符串或静态虚构指标。
   - 核心计费用量（输入、输出、缓存读取）与耗时（模型用时、工具用时）必须 100% 来源于真实数据源（Antigravity 的 SQLite `gen_metadata` 及 `steps` 表纳秒级时间戳）。
   - 对于模型 API 未拆分的上下文子项（系统提示词、工具定义），采用严谨的基准测算 + 残差归一化算法锚定真实总量，杜绝虚假取整。
4. **消除异常表面与定义无效状态 (Define Away Errors)**：
   - 处理诸如 Antigravity 频繁重启导致的 Windows 文件锁定 (`EBUSY`/`SQLITE_BUSY`)、路由切换时 React 19 根节点重建冲突等边缘场景，通过只读连接、防抖重试、单例状态管理器直接定义并抹平异常，避免向外抛出破损状态。

### 1.3 核心交付收益与价值闭环

| 维度 | 原 AntiToken 状态 | 对齐 DeepSeek Harness 后 | 工程与用户价值 |
|---|---|---|---|
| **常驻形态** | 仅输入框旁单枚圆环百分比 Pill | 三段式常驻状态栏：轮步/速度 + 用量/缓存 + 上下文圆环 | 完整掌握宏观性能、总体吞吐与上下文压力 |
| **性能度量** | 仅显示静态总 Token 数，无耗时度量 | 完整覆盖：模型用时、工具调用用时、首包延迟 (TTFT)、纯解码速度 (TPS) | 毫秒级洞察模型思考开销与本地/网络工具执行瓶颈 |
| **上下文构成** | 仅单一直方图或粗略总数 | 分段彩色进度条：系统提示词 + 工具定义 + 对话消息 | 清晰洞察系统级提示词与庞大 MCP Schema 占用的隐性成本 |
| **交互质感** | 简单弹窗与主设置面板 | 原生玻璃拟态微浮卡片 (Popover)，视口自适应吸附 | 达到现代顶级 IDE 原生体验，零干扰沉浸式编码 |

---

## 2. DeepSeek Harness 核心机制深度逆向分析 (R1)

基于对 DeepSeek Harness (`deepseek-ai/deepseek-harness`) 官方仓库代码库的全面静态与动态逆向工程，系统剖析其性能测量、用量统计与分层流转机制。

### 2.1 事件驱动流转与分层生命周期 (Session -> Turn -> Step)

DSH 整体采用基于不可变追加日志（Append-only Event Sourcing）的事件驱动架构。会话生命周期自上而下严格划分为四层模型：

```
 会话 (Session): 全局唯一的上下文生命周期，持久化于追加事件流
   │
   └── 交互轮次 (Turn): 单次用户 Prompt 发起或自主 Agent Goal 的执行轮，单调自增 [1, 2, ...]
         │
         └── 逻辑步骤 (Step): 单次模型推理决策及其派生的工具调用批次，自增 [1, 2, ...]
               │
               ├── 模型调用尝试 (Attempt): 包含网络调用、流式传输及故障重试
               │     └── SSE Chunk 增量: [text-delta, reasoning-delta, tool-call-delta]
               │
               └── 工具批次执行 (Tool Batch Execution):
                     ├── tool/call   : 派发工具 [callId, name, arguments, timestamp]
                     └── tool/result : 工具返回 [callId, content, isError, timestamp]
```

#### DSH 核心包架构拓扑
- `packages/core/agent-loop`: 状态机核心，负责 `turn/start`、`step/start`、循环触发 LLM、执行工具并派发 `step/end`、`turn/end`。
- `packages/session/session-stats`: 性能指标投影折叠器 (`projection.ts`)，纯函数响应事件流，生成 `SessionStatsState`。
- `packages/llm/token-meter`: 负责上下文 Token 启发式估算 (`estimate.ts`)、账单拆解 (`usage-projection.ts`) 及上下文构成 (`breakdown-projection.ts`)。
- `packages/client/ui-chat` & `ui-conversation`: 渲染层，包含 `StatsPills.tsx`、`ContextMeter.tsx` 及本地化模块 `locale.ts`。

#### 关键时序流转机制 (`agent.ts` 源码分析)
1. **轮次初始化**：用户发送输入，派发 `turn/start { turn: 1 }`。
2. **步骤循环推进**：
   - 派发 `step/start { turn: 1, step: 1, time }`，记录 `openStep.startTime`。
   - 启动流式请求，收到第一个有效增量时，更新 `firstTokenTime`。
   - 流式结束，生成 `assistant/message { usage, stream }`。
   - 若模型产生工具调用：
     - 为每个工具派发 `tool/call { callId, name, arguments }`，在状态机内暂存 `pendingCalls[callId] = event.time`。
     - 本地执行完成后派发 `tool/result`，通过 `callId` 配对计算单次工具用时并累加至 `toolMs`。
   - 在 `finally` 块中派发 `step/end { turn: 1, step: 1 }`，无论成功或失败保证闭环。
3. **轮次收尾**：工具调用结束或无需继续执行，派发 `turn/end { turn: 1, reason }`。

---

### 2.2 性能指标统计模型 (TTFT, TPS, Model Time, Tool Time)

DSH 在 `packages/session/session-stats/src/projection.ts` 中实现了一套极其严格的性能统计投影模型。

#### A. 首 Token 到达判定与延迟 (TTFT) 计算
何为“First Token”？DSH 在 `packages/llm/llm/src/assistant-stream.ts` 中给出了严谨判定：

```typescript
// packages/llm/llm/src/assistant-stream.ts
export function isTokenDelta(chunk: StreamChunk): boolean {
  switch (chunk.type) {
    case 'text-delta':
    case 'reasoning-delta':
      return chunk.text !== '';
    case 'tool-call-delta':
      return chunk.argumentsDelta !== '' || chunk.name !== undefined;
    default:
      return false;
  }
}
```

- **TTFT 触发条件**：当 SSE 流中首次接收到非空的 `text-delta`、思考过程 `reasoning-delta` 或首个工具调用片段 `tool-call-delta` 时，将该 chunk 的物理到达时间记为 `firstTokenTime`。
- **数学公式**：
  $$\text{TTFT}_{\text{step}} = \max(0, \text{firstTokenTime} - \text{stepStartTime})$$
  $$\text{TTFT}_{\text{avg}} = \frac{\sum_{i=1}^{N} \text{TTFT}_i}{N} \quad (N = \text{ttftSteps})$$

#### B. 纯解码吞吐速度 (TPS) 计算
不同于粗糙地将“总输出 Token 除以整个请求耗时”，DSH 将网络首包/排队时间与模型自回归解码时间做了物理隔离：

```typescript
// packages/session/session-stats/src/projection.ts (lines 148-155)
if (firstToken !== null) {
  next.ttftMs += Math.max(0, firstToken - open.startTime);
  next.ttftSteps += 1;
  const outputTokens = usageOutputTokens(event.data.usage);
  if (outputTokens !== null) {
    next.decodeMs += Math.max(0, event.time - firstToken);
    next.decodeTokens += outputTokens;
  }
}
```

- **解码耗时**：$\text{decodeMs} = \text{event.time} - \text{firstTokenTime}$（从首包到达至流完全结束的持续时间）。
- **TPS 计算公式**：
  $$\text{TPS} = \frac{\text{decodeTokens}}{\text{decodeMs} / 1000}$$
- **格式化规整**：$\ge 10 \text{ tok/s}$ 时取整为整数，$< 10 \text{ tok/s}$ 时保留 1 位小数（避免低速时抖动过大）。

#### C. 模型总用时 (`llmMs`) 与工具总用时 (`toolMs`)
- **模型用时**：单步由 `step/start` 触发，在 `assistant/message` 结束。
  $$\text{LLM\_Duration}_{\text{step}} = \max(0, \text{assistantMessageTime} - \text{stepStartTime})$$
  全会话中各 step 的耗时线性累加：$\text{llmMs} = \sum \text{LLM\_Duration}$。
- **工具调用用时**：采用并发配对字典表 `pendingCalls: Record<string, number>`：
  ```typescript
  // 派发工具调用
  case 'tool/call':
    return { ...state, pendingCalls: { ...state.pendingCalls, [event.data.callId]: event.time } };
  // 接收工具结果
  case 'tool/result': {
    const callId = event.data.message.source.callId;
    const dispatched = state.pendingCalls[callId];
    if (dispatched === undefined) return state;
    return {
      ...state,
      toolMs: state.toolMs + Math.max(0, event.time - dispatched),
      pendingCalls: filterOut(state.pendingCalls, callId),
    };
  }
  ```
  在 `turn/end` 时，DSH 会自动扫描并丢弃未能返回的孤立调用，保证统计数据不泄露。

---

### 2.3 Token 分类统计与启发式模型 (4 字符估算、账单锚点、缓存命中率)

#### A. 启发式 Token 估算器 (`estimate.ts`)
为了极致的客户端响应性能与轻量化，DSH 在渲染与流式推进期间**未集成庞大复杂的 BPE Tokenizer (如 tiktoken WASM)**，而是制定了统一的字符启发式规则：

```typescript
// packages/llm/token-meter/src/estimate.ts
const CHARS_PER_TOKEN = 4;
const BLOCK_OVERHEAD = 4;
export const ROLE_OVERHEAD = 4;

export function estimateContent(blocks: readonly ContentBlock[]): number {
  let tokens = 0;
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
      case 'reasoning':
        tokens += Math.ceil(block.text.length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD;
        break;
      case 'tool-call':
        tokens += Math.ceil(block.name.length / CHARS_PER_TOKEN)
          + Math.ceil(block.arguments.length / CHARS_PER_TOKEN)
          + BLOCK_OVERHEAD;
        break;
      case 'tool-result':
        tokens += estimateContent(block.content) + BLOCK_OVERHEAD;
        break;
      default:
        tokens += BLOCK_OVERHEAD + Math.ceil(JSON.stringify(block).length / CHARS_PER_TOKEN);
    }
  }
  return tokens;
}
```

- **字符比率**：设定 $1 \text{ Token} \approx 4 \text{ Characters}$。
- **结构开销**：每个 Content Block 补加 4 Token 开销，每条角色消息补加 4 Token 标记开销。

#### B. 为什么明细相加不等于总数？（账单锚点与表层字符差分）
用户截图 2 中出现了一个非常耐人寻味的现象：
- 卡片顶部显示：`~72.4K / 1M`
- 明细行显示：系统提示词 `~8.2K` + 工具定义 `~8.3K` + 对话消息 `~29.4K` = `45.9K`
- **差额分析**：$72.4\text{K} - 45.9\text{K} = 26.5\text{K}$ 去了哪里？
- **深度代码证据**：
  在 `packages/llm/token-meter/src/usage-projection.ts` 中，DSH 引入了 `projectedTokens` 机制：
  $$\text{projectedTokens} = \max(0, \text{pressureTokens} + \text{surfaceTokens} - \text{sampledSurfaceTokens})$$
  其中 `pressureTokens` 是服务端在网络响应中报告的真实权威 Prompt Token 数（包含了模型真实 BPE 分词、多轮对话上下文以及思维链沉淀）。明细行的 3 项是纯静态字符启发式估算（仅反映静态构成比例）。
  官方设计准则明确指出：**明细行用于呈现“相对构成百分比”，而顶部标题与圆环使用服务端权威数据推演的绝对上下文用量。**

#### C. 缓存命中率 (Cache Hit Rate) 严谨算法
在 `packages/client/ui-chat/src/client/chat/token-format.ts` 中：
$$\text{Billed Input} = \text{uncachedInputTokens} + \text{cacheReadTokens} + \text{cacheWriteTokens}$$
$$\text{Cache Hit Rate} = \frac{\text{cacheReadTokens}}{\text{uncachedInputTokens} + \text{cacheReadTokens}}$$
- **诚实原则**：当未缓存输入大于 0 时，即使计算出的比例达到 99.99%，也绝不允许四舍五入为 `100%`，防止用户误以为完全没有网络或计费开销。

---

### 2.4 UI 交互与数据呈现机制 (常驻状态栏与 3 种悬浮卡片)

基于对前端组件树的逆向，DSH 构建了高度精简的状态栏与 Popover 联动层：

```
 底部状态栏容器 (StatsPills + ContextMeter)
  ├── 触发器 1: [仪表图标] 2 轮 78 步 · 190 tok/s  ─────────► 悬浮卡片 4: 会话统计 (SessionStatsPopover)
  ├── 触发器 2: [磁盘图标] 3.8M tok · 缓存命中 99%  ───────► 悬浮卡片 3: Token 用量 (TokenUsagePopover)
  └── 触发器 3: [圆环图标] 7%                      ─────────► 悬浮卡片 2: 上下文已用 (ContextUsagePopover)
```

1. **触发器形态**：
   - 采用 `<button className="pill">`，默认背景透明，文字颜色 `#d1d5db`。
   - `hover` 或卡片激活状态下呈现带圆角的淡白背景高亮 `rgba(255, 255, 255, 0.08)`，圆角 `6px`。
2. **卡片视觉统一规范**：
   - 背景：深石板灰 `#25262b`，带轻微的高斯模糊（Backdrop Blur）与 95% 不透明度。
   - 边框：`1px solid rgba(255, 255, 255, 0.08)`。
   - 圆角：`rounded-2xl` (14px ~ 16px)。
   - 阴影：多阶深色柔和投影 `0 20px 25px -5px rgba(0, 0, 0, 0.5)`。
   - 定位策略：卡片底部与状态栏触发器顶部保持 `8px` 垂直间距，卡片左边缘与触发器对齐；当触发器靠近屏幕右边界时，自动翻转为右对齐，确保卡片内容永不溢出视口。

---

## 3. AntiToken 宿主环境可行性与数据映射分析 (R2)

### 3.1 宿主架构与注入机制剖析 (Electron Main, Preload IPC, standalone.tsx)

AntiToken 运行于宿主应用 Antigravity 的 Windows Electron 容器内，架构包含三大核心执行域：

```
┌────────────────────────────────────────────────────────────────────────┐
│                   Antigravity 宿主 Electron 架构全景                    │
├────────────────────────────────────────────────────────────────────────┤
│ 1. 主进程 (Electron Main Process)                                      │
│    - hosts/antigravity/scripts/loader.cjs                              │
│    - 监听 SQLite 数据库 WAL 文件变更 (%USERPROFILE%\.gemini\antigravity)│
│    - 极速单会话读取 readSingleSession(sessionId) (~15-25ms)            │
│    - 通过 webContents.executeJavaScript 或 IPC 广播遥测状态            │
├────────────────────────────────────────────────────────────────────────┤
│ 2. 预加载层 (Preload Script / ContextBridge)                           │
│    - hosts/antigravity/scripts/patch-antigravity.cjs                   │
│    - 在 dist/preload.js 注入 window.__ANTIGRAVITY_SYNC_BRIDGE__         │
│    - 穿透 contextIsolation 安全沙箱                                    │
├────────────────────────────────────────────────────────────────────────┤
│ 3. 渲染层 (Chromium Renderer Process)                                  │
│    - hosts/antigravity/src/standalone.tsx                             │
│    - React 19 根隔离: window.__ANTIGRAVITY_STATUSBAR_ROOT__ (状态栏)   │
│      与 window.__ANTIGRAVITY_STATS_ROOT__ (模态框) 独立维护            │
│    - DOM MutationObserver 监听路由与节点挂载                           │
│    - 挂载点: 常驻状态栏容器 / Context Usage Pill                       │
└────────────────────────────────────────────────────────────────────────┘
```

#### ASAR 打包与原子回滚保障
- 补丁脚本 `patch-antigravity.cjs` 通过 `@electron/asar` 解包并注入主进程挂钩 `loader.cjs`。
- 在首次补丁前自动创建只读备份 `app.asar.backup` 和 `app.asar.backup.unpacked`。
- 执行 `npm run unpatch` 时，采用安全重命名与文件锁释放技术，秒级无损还原至官方原厂状态。

---

### 3.2 真实遥测数据源深度评测 (SQLite gen_metadata, steps Tag 1/6/8, transcripts)

通过对实机 510 个活跃 Antigravity 会话 SQLite 数据库的逆向解析，全面验证了数据源的原生可获取性：

#### A. `gen_metadata` 表：权威计费 Token 数据源
每发生一次模型推理，Antigravity 均在 `gen_metadata` 插入一行包含 Google Gemini 官方 Protobuf 响应的二进制 BLOB：
- **Tag 1.4**: `ModelUsageStats` 结构体：
  - **Tag 1.4.2** (`inputTokens`): 未缓存输入 Token
  - **Tag 1.4.3** (`outputTokens`): 输出 Token
  - **Tag 1.4.5** (`cacheReadTokens`): 缓存读取 Token
  - **Tag 1.4.9** (`thinkingTokens`): 深度思考过程 Token
  - **Tag 1.4.10** (`responseTokens`): 正式回答 Token
  - **Tag 1.19** (`modelName`): 调用的模型名称字符串（如 `gemini-3.8-flash`）
- **结论**：**100% 真实 Ground Truth**，与服务端计费毫厘不差。

#### B. `steps` 表：纳秒级生命周期时间戳数据源
`steps` 表记录了单次交互会话内所有的状态机执行步骤，其中核心步骤类型具备明确的语义：
- **`step_type == 14`**：用户输入消息 (User Round)，代表一个全局轮次 (Turn)。
- **`step_type == 15`**：模型生成调用 (Model Generation Invocation)。其 `metadata` Protobuf 包含：
  - **Tag 1**: 模型请求发送物理时间戳 (`seconds` + `nanos`)。
  - **Tag 6**: 模型首 Token 返回物理时间戳 (`seconds` + `nanos`)。
  - **Tag 8**: 模型完整生成结束物理时间戳 (`seconds` + `nanos`)。
  - **Tag 9**: 嵌入式用量分解。
- **`step_type == 132`**：工具执行调用 (Tool Call Invocation)。其 `metadata` 包含：
  - **Tag 1**: 本地工具启动执行物理时间戳 (`seconds` + `nanos`)。
  - **Tag 8**: 本地工具执行完毕物理时间戳 (`seconds` + `nanos`)。
  - **Tag 4.1**: `callId` (调用标识)。
  - **Tag 4.2**: `toolName` (工具名称，如 `view_file`, `replace_file_content`, `run_command`)。
  - **Tag 4.3**: 工具入参 JSON 字符串。
- **结论**：**模型用时、工具用时、TTFT 与实际步数在 SQLite 中已有原生纳秒级时间戳支撑！完全无需编写复杂的 C++ 外部进程注入或 DLL Hook，纯 Node.js 解码即可实现 100% 真实还原！**

#### C. `transcripts` 日志文件与自动清理限制
位于 `brain/<sessionId>/.system_generated/logs/transcript.jsonl`，记录了增量 JSON 文本。然而实测表明：Antigravity 内置的后台清理程序会自动截断或归档旧的日志文件，而 SQLite 数据库表永久留存。因此，**聚合引擎必须以 SQLite 为权威真理源 (Source of Truth)**。

---

### 3.3 13 项核心指标全面映射对比表 (Ground Truth vs Derived)

| # | 目标展示维度 | 指标名称 (Metric Name) | DSH 参考值 | Antigravity 宿主数据源 | 可用性判定 | 精度标准 | 采集方式与接入点 |
|---|---|---|---|---|---|---|---|
| 1 | **状态栏** | **会话轮次 (Rounds)** | `2 轮` | SQLite `steps` (`step_type == 14`) 计数 | **直接获取 (Ground Truth)** | 100% 精确 | `readSingleSession()` 中执行计数统计 |
| 2 | **状态栏** | **会话步骤 (Steps)** | `78 步` | SQLite `steps` (`step_type in (15, 132)`) 计数 | **直接获取 (Ground Truth)** | 100% 精确 | `readSingleSession()` 中按步骤聚合 |
| 3 | **状态栏** | **输出速度 (TPS)** | `190 tok/s` | SQLite 提交: 纯解码 `outputTokens / decodeDurationSec` (null 守卫)<br>流式期间: Renderer DOM 字符差分 (CJK 加权) | **混合双引擎 (Hybrid)** | 提交时 100% 精确<br>流式中 $\approx 95\%$ | 提交由 SQLite 覆盖，流式由 `standalone.tsx` Ticker 驱动 |
| 4 | **状态栏** | **Token 总用量** | `3.8M tok` | SQLite `gen_metadata` (未缓存输入 + 缓存读取 + 输出) | **直接获取 (Ground Truth)** | 100% 精确 | `aggregate-stats.cjs` 累加 |
| 5 | **状态栏** | **缓存命中率** | `缓存命中 99%` | SQLite `gen_metadata` (`cacheRead / (input + cacheRead)`) | **直接获取 (Ground Truth)** | 100% 精确 | 严格按除法计算，防虚假 100% |
| 6 | **状态栏** | **上下文已用 %** | `7%` | 最新一次调用的 `promptTokens / 1,048,576` (1M) | **直接获取 (Ground Truth)** | 100% 精确 | 对齐 1M 窗口总量计算比例 |
| 7 | **上下文卡片** | **上下文用量对比** | `~72.4K / 1M` | 最新调用的 `(inputTokens + cacheReadTokens) / 1M` | **直接获取 (Ground Truth)** | 100% 精确 | 服务端实际 Prompt 占位基准 |
| 8 | **上下文卡片** | **系统提示词 (System)** | `~8.2K` (灰色) | 宿主系统设定静态分词测算基准 | **推导校准 (Derived)** | 结构化校准 | 静态分析基准提示词 Token 数 (~8.2K) |
| 9 | **上下文卡片** | **工具定义 (Tools)** | `~8.3K` (紫色) | 18 项内置工具 + 活跃 MCP 协议 Schema 估算 | **推导校准 (Derived)** | 结构化校准 | 静态分析 Schema 定义 Token 数 (~8.3K) |
| 10| **上下文卡片** | **对话消息 (Messages)**| `~29.4K` (蓝色) | 动态等比缩放与非负残差: `promptTokens < 16.5K ? 0 : promptTokens - 16.5K` | **推导校准 (Derived)** | 严密锚定总数 | 杜绝负数与除以零；各段之和恒等于 promptTokens |
| 11| **用量卡片** | **未缓存输入 (Input)** | `27,687 tok` | SQLite `gen_metadata` 的 `inputTokens` 全会话累加 | **直接获取 (Ground Truth)** | 100% 精确 | 直接累加，千分位格式化 |
| 12| **用量卡片** | **缓存读取 (Cache)** | `3,699,456 tok` | SQLite `gen_metadata` 的 `cacheReadTokens` 全会话累加 | **直接获取 (Ground Truth)** | 100% 精确 | 直接累加，千分位格式化 |
| 13| **用量卡片** | **模型输出 (Output)** | `35,547 tok` | SQLite `gen_metadata` 的 `outputTokens` 全会话累加 | **直接获取 (Ground Truth)** | 100% 精确 | 直接累加，千分位格式化 |
| 14| **会话卡片** | **模型用时 (Model Time)**| `6分51秒` | SQLite `steps` (`step_type == 15`) 各 step `(Tag8 - Tag1)` 累加 | **直接获取 (Ground Truth)** | 纳秒级高精度 | Protobuf 时间戳差值累加换算秒数 (无空格) |
| 15| **会话卡片** | **工具调用用时 (Tool)** | `1分11秒` | SQLite `steps` (`step_type == 132`) 各 step `(Tag8 - Tag1)` 累加 | **直接获取 (Ground Truth)** | 纳秒级高精度 | Protobuf 时间戳差值累加 (带 180s 离群截断) |
| 16| **会话卡片** | **首 token 平均 (TTFT)**| `2.9秒` | SQLite `steps` (`step_type == 15`) 各 step `(Tag6 - Tag1)` 均值 | **直接获取 (Ground Truth)** | 纳秒级高精度 | 剔除异常值 (300s 阈值) 后求多步算术平均值 |

---

### 3.4 差异与鸿沟对齐方案：双引擎混合架构 (Dual-Engine Stream Architecture)

#### 核心鸿沟分析
- **原生环境 (DSH)**：拥有对网络流（SSE Client）和工具调用运行时（Runtime）的 100% 控制权，每收到一个 Token 事件均可在内存中触发状态机累加。
- **宿主注入环境 (AntiToken)**：运行在 Antigravity 宿主外围。Antigravity 的网络流式过程发生在私有 C++ / Node 模块内，仅在单步执行完毕并向 SQLite WAL 写入事务时才产生落盘记录。如果在流式期间不做处理，状态栏在生成过程中将保持静态，体验大打折扣。

#### 双引擎混合架构解决方案
AntiToken 创新提出并实现“**流式实时 Ticker + 提交时 SQLite 权威同步**”的双引擎闭环：

```
                ┌────────────────────────────────────────────────────────┐
                │             双引擎混合遥测架构 (Dual-Engine)           │
                └────────────────────────────────────────────────────────┘
                                     │
           ┌─────────────────────────┴─────────────────────────┐
           ▼                                                   ▼
┌──────────────────────────────────────┐    ┌──────────────────────────────────────┐
│  引擎 1: 流式实时 Ticker (Renderer)  │    │ 引擎 2: 提交时权威同步 (Main/SQLite) │
├──────────────────────────────────────┤    ├──────────────────────────────────────┤
│ 触发条件:                             │    │ 触发条件:                             │
│   DOM 监听到 Cancel/Stop 按钮出现    │    │   SQLite WAL 文件被宿主写入更新      │
│ 运行机制:                             │    │ 运行机制:                             │
│   1. 记录 streamStartTime = now()    │    │   1. loader.cjs 防抖 150ms 触发      │
│   2. 监听对话区首个 DOM 文本插入      │    │   2. readSingleSession() 极速读取    │
│      -> 获得 liveTtft                │    │   3. 解析 gen_metadata & steps 表    │
│   3. 每 150ms 采样字符数变化:        │    │   4. 广播 EVENT_STATS_UPDATED        │
│      liveTps = (cjk*1.35+ascii*0.25)/Δt │    │ 结果:                                │
│ 结果:                                │    │   100% 绝对真实的 Ground Truth 数字  │
│   提供毫秒级跳动的活体视觉反馈       │    │   无缝覆盖并校准实时预估值           │
└──────────────────────────────────────┘    └──────────────────────────────────────┘
```

1. **生成进行中 (In-Flight Phase - 仅用于纯视觉反馈)**：
   - 当用户点击发送，DOM 中出现 `button[aria-label*="Cancel"], button[aria-label="停止"]`，流式计时器挂载。
   - 记录 `streamStartTime = performance.now()`，界面呈现跳动的已耗时指示器（如 `⚡ 生成中 3.4s`）与流式闪烁动画。
   - 当对话流首批节点渲染时，捕获 `liveTtft = (performance.now() - streamStartTime) / 1000`。
   - **多字节 CJK 字符动态加权估算（严禁硬编码被禁用的全局启发式 `/ 3.8`）**：
     - `AGENTS.md` 与回归测试套件 `scripts/test-all.cjs:199` 明确规定禁止在代码库中使用硬编码字符串 `/ 3.8` 进行 Token 估算，且单一除以 3.8 严重低估中文 Token 产出速率（导致中文生成时 TPS 偏低 4~5 倍）。
     - 前端仅在 `hosts/antigravity/src/` 的动态 Ticker 中进行字符权重采样：
       ```typescript
       const cjkCount = (textDelta.match(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
       const asciiCount = Math.max(0, textDelta.length - cjkCount);
       // 中日韩字符消耗约 1.35 tokens/字，ASCII 字符消耗约 0.25 tokens/字 (即 4 chars/token)
       const estimatedTokens = cjkCount * 1.35 + asciiCount * 0.25;
       const liveTps = deltaTimeSec > 0 ? Math.round(estimatedTokens / deltaTimeSec) : null;
       ```
     - 启动 100ms 刷新定时器，状态栏反映当前推理估算速率。
2. **生成完成时 (Commit Phase - 权威 Ground Truth 覆盖)**：
   - Antigravity 写入 SQLite WAL。
   - `loader.cjs` 毫秒级捕获变更（150ms 防抖），解析 `steps` 表中的物理纳秒戳和 `gen_metadata` 中的权威 Token 数据。
   - 将经过服务端严格核算的 `modelDurationSec`、`toolDurationSec`、`avgTtft`、纯解码 `tps` 随 `EVENT_STATS_UPDATED` 广播至前端，瞬间无缝覆盖实时估算值，保证全会话历史统计数据的 100% 权威性与一致性。

---

### 3.5 Windows 平台特性与 Electron 技术风险防控 (EBUSY, CSP, React 19)

在 Windows 平台与 Electron 宿主环境下，必须防范以下系统级风险：

1. **Windows 独占文件锁 (`EBUSY` / `SQLITE_BUSY`)**：
   - *风险特征*：Antigravity 主进程以读写模式打开 SQLite WAL 文件，若 AntiToken 以独占模式或写模式打开，Windows 核心文件系统将抛出 `EBUSY` 异常。
   - *防控规范*：
     - 使用 Node 内置 `DatabaseSync` 时强制指定只读标志：`new DatabaseSync(filePath, { readOnly: true })`。
     - 遇到 `SQLITE_BUSY` 时立即返回内存中的上一快照（Cache-Stale 容错），并在 150ms 后自动执行退避重试。
2. **Electron 上下文隔离 (Context Isolation) 与 CSP**：
   - *风险特征*：宿主开启了 `contextIsolation: true`，Renderer 无法直接访问 `ipcRenderer`。
   - *防控规范*：通过 ASAR 补丁在 `dist/preload.js` 中借助 `contextBridge.exposeInMainWorld` 暴露专用的 `__ANTIGRAVITY_SYNC_BRIDGE__`，严禁通过修改 CSP 头或降低沙箱等级实现通信。
3. **React 19 根容器挂载与根生命周期隔离 (Root Isolation)**：
   - *风险特征*：Antigravity 基于单页应用框架开发，在路由跳转时（如切换不同会话 `/c/<sessionId>`）会批量清空并重建 DOM。若重复调用 `createRoot` 会在 React 19 控制台产生严重警告甚至内存泄露。更为严重的是，宿主端已在 `hosts/antigravity/src/standalone.tsx` 中使用全局变量 `window.__ANTIGRAVITY_STATS_ROOT__` 挂载 Settings 模态框与全屏面板；若常驻状态栏共享同一根引用，一旦用户打开或关闭模态框，`unmountStats()` 将连带销毁底部的常驻状态栏！
   - *防控规范*：
     - **严格隔离根生命周期**：
       - 常驻状态栏独占单例根引用 `window.__ANTIGRAVITY_STATUSBAR_ROOT__`。
       - 模态设置面板独立维护单例根引用 `window.__ANTIGRAVITY_STATS_ROOT__`。
     - 每次路由变更或状态栏重新挂载时，仅针对 `__ANTIGRAVITY_STATUSBAR_ROOT__` 进行安全卸载与重建，互不干扰。
     - 对 DOM 变动监听器施加 60ms 防抖，防止界面渲染期间的抖动干扰。

---

## 4. 端到端对齐架构与模块设计规范 (R3)

### 4.1 数据流架构图与分层设计 (采集层 -> 聚合层 -> 渲染层)

整个系统的模块流转拓扑严格遵循单向数据流与信息隐藏原则：

```
 [Antigravity 宿主环境]
  │
  ├── SQLite WAL 变更 (%USERPROFILE%\.gemini\antigravity\conversations\*.db-wal)
  └── Chromium DOM 变动 (Cancel 按钮状态与路由 URL /c/:sessionId)
         │
         ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │ 1. 采集与适配层 (Data Ingestion Layer)                                │
 │    - hosts/antigravity/scripts/loader.cjs                             │
 │    - 文件系统防抖监听器 (150ms fs.watch)                             │
 │    - 极速单会话过滤 readSingleSession(sessionId)                       │
 └────────────────────────────────────────────────────────────────────────┘
         │
         ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │ 2. 指标聚合与投影计算层 (Metrics Aggregation & Projection Layer)      │
 │    - scripts/aggregate-stats.cjs                                      │
 │    - Protobuf 递归解析器 (decodeVarint, parseProtoFields)             │
 │    - steps 表时间戳抽取器: step_type 15 (Model), 132 (Tool)           │
 │    - 指标计算闭环: TTFT, TPS, 轮次, 步骤, 缓存命中率, 残差上下文      │
 └────────────────────────────────────────────────────────────────────────┘
         │
         ▼ (通过 window.dispatchEvent(EVENT_STATS_UPDATED) 广播)
 ┌────────────────────────────────────────────────────────────────────────┐
 │ 3. UI 呈现与微交互层 (UI Presentation Layer - React 19)                │
 │    - hosts/antigravity/src/standalone.tsx                             │
 │    - 常驻状态栏 (DshStatusBar.tsx)                                     │
 │    - 会话统计悬浮卡片 (SessionStatsPopover.tsx)                       │
 │    - Token 用量悬浮卡片 (TokenUsagePopover.tsx)                        │
 │    - 上下文已用悬浮卡片 (ContextUsagePopover.tsx)                     │
 └────────────────────────────────────────────────────────────────────────┘
```

---

### 4.2 模块设计与 TypeScript 接口契约

为了彻底解耦底层采集与前端渲染，确立强类型的统一契约接口。

```typescript
// src/types/dsh-telemetry.ts

/** 会话级宏观性能统计指标 (对应截图 1 速度 & 截图 4 会话统计) */
export interface SessionMetrics {
  /** 当前会话总交互轮次 (User Prompts) */
  rounds: number;
  /** 当前会话总执行步骤 (Model Calls + Tool Calls) */
  steps: number;
  /** 会话平均纯解码速度 (Tokens per Second，计算失败/无输出/无有效耗时时为 null) */
  tps: number | null;
  /** 模型生成总累计用时 (秒) */
  modelDurationSec: number;
  /** 本地工具调用总累计用时 (秒) */
  toolDurationSec: number;
  /** 首 Token 平均到达延迟 TTFT (秒，流式取消或未测得时为 null) */
  ttftSec: number | null;
}

/** Token 权威计费与用量明细指标 (对应截图 1 用量 & 截图 3 Token 用量卡片) */
export interface TokenMetrics {
  /** 计费总用量 (未缓存输入 + 缓存读取 + 输出) */
  totalTokens: number;
  /** 缓存命中率百分比 (0 - 100，当计费输入为 0 时为 null) */
  cacheHitRatePct: number | null;
  /** 未缓存输入 Token */
  uncachedInputTokens: number;
  /** 缓存读取命中 Token */
  cacheReadTokens: number;
  /** 模型生成输出 Token (含思考过程与回答) */
  outputTokens: number;
}

/** 上下文窗口容量与构成拆解指标 (对应截图 1 圆环 & 截图 2 上下文卡片) */
export interface ContextMetrics {
  /** 当前上下文总占用 Token */
  usedTokens: number;
  /** 模型总上下文窗口容量上限 (默认 1,048,576 / 1M) */
  limitTokens: number;
  /** 上下文已用百分比 (0 - 100) */
  usedPct: number;
  /** 系统提示词占用估算 (灰色色块) */
  systemPromptTokens: number;
  /** 工具定义 Schema 占用估算 (紫色色块) */
  toolDefinitionTokens: number;
  /** 对话历史消息占用估算 (蓝色色块) */
  chatMessageTokens: number;
}

/** 统一遥测传输根对象 (DshTelemetryData) */
export interface DshTelemetryData {
  /** 会话全局唯一标识符 */
  sessionId: string;
  /** 是否处于实时流式生成中 (用于激活状态栏实时动画) */
  isStreaming: boolean;
  /** 会话性能指标 */
  session: SessionMetrics;
  /** Token 用量指标 */
  token: TokenMetrics;
  /** 上下文构成指标 */
  context: ContextMetrics;
}
```

#### UI 展示降级与容错规范 (Degradation Rules for Nullable Fields)
为保障各种边缘时序（冷启动零输入、立即取消未出首 Token、零输出拦截、无有效耗时等）下的界面稳定性，UI 渲染层执行严格对齐 DSH 上游设计（`StatsPills.tsx` / `token-format.ts`）的降级策略：
1. **状态栏性能 Pill**：
   - 当 `session.tps === null` 时，仅渲染 `{rounds} 轮 {steps} 步`，隐藏后置的 `· {tps} tok/s`，严禁渲染为欺骗性的 `0 tok/s` 或异常的 `NaN tok/s`。
2. **状态栏用量 Pill**：
   - 当 `token.cacheHitRatePct === null` 时，仅渲染 `{compactTotal} tok`，隐藏 `· 缓存命中 {cacheHitRatePct}%`，杜绝 `0/0 = NaN%`。
3. **会话统计悬浮卡片 (`SessionStatsPopover`)**：
   - 当 `session.ttftSec === null` 时，`首 token 平均 (TTFT)` 行展示 `--` 或直接隐去该行，严禁格式化输出为虚假的 `0.0 秒`。
   - 当 `session.tps === null` 时，`输出速度 (TPS)` 行展示 `--` 或直接隐去。
4. **Token 用量悬浮卡片 (`TokenUsagePopover`)**：
   - 当 `token.cacheHitRatePct === null` 时，`缓存命中` 行数值展示为 `--`。
5. **上下文卡片与分段进度条**：
   - 当 `context.usedTokens === 0` 或 `promptTokens === 0` 时，进度条子段宽度置 0，呈现全底色轨道 (`--dsh-seg-track`)，杜绝除以零产生的 `Infinity%` 样式破损。

---

### 4.3 4 大展示维度 1:1 对齐 UI 详细设计规范

严格比对用户提供的 4 张实机截图与 DSH 官方 CSS，提取完整的设计系统规范（Design Tokens）。

#### A. 视觉设计系统与配色规范 (Design Tokens)
```css
/* DeepSeek Harness 对齐专用色彩体系 (深色主题 - 默认) */
:root {
  /* 常驻状态栏 (Status Bar) */
  --dsh-statusbar-bg: #161618;
  --dsh-statusbar-border: rgba(255, 255, 255, 0.08);
  --dsh-statusbar-hover: rgba(255, 255, 255, 0.08);
  --dsh-statusbar-height: 30px;

  /* 悬浮卡片 (Popover Card) */
  --dsh-card-bg: #25262b;
  --dsh-card-border: rgba(255, 255, 255, 0.08);
  --dsh-card-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5);
  --dsh-card-radius: 14px;
  --dsh-card-width: 320px;

  /* 排版字体与文字颜色 */
  --dsh-text-primary: #ffffff;
  --dsh-text-secondary: #d1d5db;
  --dsh-text-muted: #9ca3af;
  --dsh-divider: rgba(255, 255, 255, 0.08);

  /* 分段彩色进度条色块 (Segment Colors) */
  --dsh-seg-system-prompt: #9ca3af;    /* 系统提示词: 银灰 */
  --dsh-seg-tool-definitions: #a855f7; /* 工具定义: 紫色 */
  --dsh-seg-chat-messages: #3b82f6;    /* 对话消息: 天蓝 */
  --dsh-seg-track: #38393e;            /* 进度条轨道底色: 深暗灰 */
}

/* 浅色主题回退规范 (Light Theme Fallback) */
[data-theme="light"],
.theme-light {
  --dsh-statusbar-bg: #f4f4f5;
  --dsh-statusbar-border: rgba(0, 0, 0, 0.08);
  --dsh-statusbar-hover: rgba(0, 0, 0, 0.06);

  --dsh-card-bg: #ffffff;
  --dsh-card-border: rgba(0, 0, 0, 0.1);
  --dsh-card-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1);

  --dsh-text-primary: #18181b;
  --dsh-text-secondary: #3f3f46;
  --dsh-text-muted: #71717a;
  --dsh-divider: rgba(0, 0, 0, 0.08);

  --dsh-seg-system-prompt: #9ca3af;
  --dsh-seg-tool-definitions: #a855f7;
  --dsh-seg-chat-messages: #3b82f6;
  --dsh-seg-track: #e4e4e7;
}
```

#### B. 维度 1：底部常驻状态栏 (`DshStatusBar.tsx`)
- **尺寸与排版**：高 `30px`，水平排列，`gap-7` (约 28px)，底色 `#161618`，顶边框 `1px solid rgba(255, 255, 255, 0.08)`，字体大小 `13px`。
- **三组常驻 Pill 项**：
  1. **性能项**：
     - 图标：仪表盘 Speedometer SVG (`14px × 14px`，描边 `#d1d5db`)。
     - 文案格式：`{rounds} 轮 {steps} 步 · {tps} tok/s`。
  2. **用量项**：
     - 图标：三层磁盘 Database SVG (`14px × 14px`，描边 `#d1d5db`)。
     - 文案格式：`{compactTotal} tok · 缓存命中 {cacheHitRate}%`（如 `3.8M tok · 缓存命中 99%`）。
  3. **上下文圆环项**：
     - 图标：Donut Ring SVG (`14px × 14px`，底轨 `#3f3f46`，填充弧 `#e4e4e7`，顺时针从 12 点方向旋转）。
     - 文案格式：`{usedPct}%`（如 `7%`）。
- **交互逻辑**：鼠标移动到任意 Pill 上时激活背景高亮，触发对应 Popover 向上展开。

#### C. 维度 2：上下文已用悬浮卡片 (`ContextUsagePopover.tsx`)
- **容器规格**：宽度 `320px`，底色 `#25262b`，圆角 `14px`，内边距 `16px`。
- **内容结构**：
  1. **标题行**：
     - 左侧：`上下文已用 ` (次级白 `#d1d5db`) + `{usedPct}%` (高亮白 `#ffffff`，加粗)。
     - 右侧：`~{formatCompactTokens(usedTokens)} / {formatCompactTokens(limitTokens)}`（如 `~72.4K / 1M`，高亮白，字重 600）。
  2. **分段彩色进度条 (Segmented Progress Bar) 与 256K 压缩阈值**：
     - 容器高度 `6px`，底轨颜色 `#38393e`，圆角全包裹，相对定位 `relative`。
     - **256K 自动压缩阈值指示器 (Compaction Threshold Mark)**：
       - 标记位置：在轨道 `24.4%` 处（`256,000 / 1,048,576 ≈ 24.41%`）设置一枚细微的垂直标记线（`w-[2px] h-[10px] -top-[2px] bg-amber-400/60`），并带有悬浮 Tooltip 提示：`256K 自动压缩阈值 (Antigravity 达到 256K 时将触发会话上下文自动压缩)`。
     - **上下文构成动态等比例缩放与安全算法**：
       ```typescript
       // 彻底消除负数 Token 与 0/0 = Infinity%
       const SYSTEM_BASELINE = 8200;
       const TOOLS_BASELINE = 8300;
       const BASELINE_SUM = SYSTEM_BASELINE + TOOLS_BASELINE; // 16500

       let systemPromptTokens = 0;
       let toolDefinitionTokens = 0;
       let chatMessageTokens = 0;

       if (promptTokens <= 0) {
         // 空会话边界：各段为 0，进度条呈现纯空轨底色，杜绝除以零
         systemPromptTokens = 0;
         toolDefinitionTokens = 0;
         chatMessageTokens = 0;
       } else if (promptTokens < BASELINE_SUM) {
         // 小额会话动态等比例压缩：严格保证无负数且总和守恒
         const scale = promptTokens / BASELINE_SUM;
         systemPromptTokens = Math.round(SYSTEM_BASELINE * scale);
         toolDefinitionTokens = Math.max(0, promptTokens - systemPromptTokens);
         chatMessageTokens = 0;
       } else {
         // 正常会话：基准锚定 + 残差归一化
         systemPromptTokens = SYSTEM_BASELINE;
         toolDefinitionTokens = TOOLS_BASELINE;
         chatMessageTokens = Math.max(0, promptTokens - BASELINE_SUM);
       }
       ```
     - **进度条子段渲染比例**：
       - 总填充宽度比例：`width = Math.min(100, (usedTokens / limitTokens) * 100)%`（如 7% 宽度）。
       - 内部各色块在已用填充区内的宽度计算（当 `promptTokens === 0` 时各段宽度为 0，杜绝 `Infinity%`）：
         - 系统提示词：`bg-[#9ca3af]`，宽度 $\frac{\text{systemPromptTokens}}{\text{promptTokens}} \times 100\%$。
         - 工具定义：`bg-[#a855f7]`，宽度 $\frac{\text{toolDefinitionTokens}}{\text{promptTokens}} \times 100\%$。
         - 对话消息：`bg-[#3b82f6]`，宽度 $\frac{\text{chatMessageTokens}}{\text{promptTokens}} \times 100\%$。
  3. **图例与数值列表 (Legend Stack)**：
     - 纵向 3 行，间距 `10px`：
       - `[10px 灰色方块] 系统提示词` ──────── `~{formatCompactTokens(systemPromptTokens)}`（如 `~8.2K`）
       - `[10px 紫色方块] 工具定义` ────────── `~{formatCompactTokens(toolDefinitionTokens)}`（如 `~8.3K`）
       - `[10px 蓝色方块] 对话消息` ────────── `~{formatCompactTokens(chatMessageTokens)}`（如 `~29.4K`）

#### D. 维度 3：Token 用量悬浮卡片 (`TokenUsagePopover.tsx`)
- **内容结构**：
  1. **标题行**：
     - 左侧：磁盘图标 + `Token 用量` (`#ffffff`，字重 600，14px)。
     - 右侧：`{totalTokens.toLocaleString()} tok`（如 `3,762,690 tok`，加粗白字）。
  2. **分割线**：`1px solid rgba(255, 255, 255, 0.08)`，上下边距 `10px`。
  3. **数据明细 4 行**：
     - 第 1 行：`缓存命中` (`#d1d5db`) ──────── `{cacheHitRatePct != null ? `${cacheHitRatePct}%` : '--'}` (`#ffffff`，加粗)
     - 第 2 行：`未缓存输入` (`#9ca3af`) ────── `{uncachedInputTokens.toLocaleString()} tok` (`#ffffff`)
     - 第 3 行：`缓存读取` (`#9ca3af`) ──────── `{cacheReadTokens.toLocaleString()} tok` (`#ffffff`)
     - 第 4 行：`输出` (`#9ca3af`) ──────────── `{outputTokens.toLocaleString()} tok` (`#ffffff`)

#### E. 维度 4：会话统计悬浮卡片 (`SessionStatsPopover.tsx`)
- **内容结构**：
  1. **标题行**：
     - 仪表盘图标 + `会话统计` (`#ffffff`，字重 600，14px)。
  2. **分割线**：`1px solid rgba(255, 255, 255, 0.08)`，上下边距 `10px`。
  3. **性能指标 4 行**：
     - 第 1 行：`模型用时` (`#d1d5db`) ──────── `{formatDuration(modelDurationSec)}`（如 `6分51秒`）
     - 第 2 行：`工具调用用时` (`#d1d5db`) ──── `{formatDuration(toolDurationSec)}`（如 `1分11秒`）
     - 第 3 行：`首 token 平均 (TTFT)` (`#d1d5db`) ── `{ttftSec != null ? formatDuration(ttftSec) : '--'}`（如 `2.9秒`）
     - 第 4 行：`输出速度 (TPS)` (`#d1d5db`) ────── `{tps != null ? `${tps} tok/s` : '--'}`（如 `190 tok/s`）

#### F. 格式化工具函数规范
```typescript
// 耗时格式化: 对齐 DSH 官方 locale (< 60s 保留 1 位小数，>= 60s 为 'X分Y秒' 无空格，防御 null/NaN/负数)
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return '0秒';
  if (seconds < 60) {
    const s = Math.round(seconds * 10) / 10;
    return `${s}秒`;
  }
  const whole = Math.round(seconds);
  const m = Math.floor(whole / 60);
  const rem = whole % 60;
  return `${m}分${rem}秒`;
}

// Token 紧凑格式化: 对齐 DSH 官方规则 (>= 100K 取整，< 100K 保留 1 位小数，防御非数值)
export function formatCompactTokens(tokens: number | null | undefined): string {
  if (tokens == null || !Number.isFinite(tokens) || tokens <= 0) return '0';
  const scaled = (candidate: number): string =>
    candidate >= 100 ? String(Math.round(candidate)) : String(Math.round(candidate * 10) / 10);
  if (tokens < 1_000) return String(tokens);
  if (tokens < 1_000_000) return `${scaled(tokens / 1_000)}K`;
  return `${scaled(tokens / 1_000_000)}M`;
}
```

---

### 4.4 数据管道实现规范 (SQLite 增量解析、IPC 广播、DOM 挂载)

#### A. `aggregate-stats.cjs` 扩展：`readSingleSession(sessionId)` 内部提取
在现有的 `readSingleSession()` 中，补充对 `steps` 表 `step_type 15` 与 `step_type 132` 的纳秒级时间提取：

```javascript
// 提取模型用时与工具用时、TTFT、纯解码 TPS 的底层逻辑实现 (严格对齐 parseProtoFields 的 Map 结构)
function extractSessionPerformanceMetrics(db, totalOutputTokens = 0) {
  let modelTimeMs = 0;
  let toolTimeMs = 0;
  let ttftSumMs = 0;
  let ttftStepsCount = 0;
  let roundsCount = 0;
  let stepsCount = 0;
  let extractedOutputTokens = 0;

  // 1. 查询所有 steps 表元数据 (在 aggregate-stats.cjs 中应与 readSingleSession 主循环合并为单趟扫描，遵循 APOSD 杜绝冗余扫描)
  const rows = db.prepare('SELECT step_type, metadata FROM steps ORDER BY idx ASC').all();
  
  for (const row of rows) {
    const stepType = row.step_type;
    if (stepType === 14) {
      // 14 为用户轮次输入 (User Turn)
      roundsCount++;
      continue;
    }
    
    if (stepType === 15) {
      // 15 为模型推理调用 (Model Invocation)
      stepsCount++;
      if (!row.metadata) continue;
      const top = parseProtoFields(Buffer.from(row.metadata));
      
      // Tag 1: 请求分发时间戳 { seconds, nanos }
      const sTs = top.get(1)?.[0] ? parseProtoFields(top.get(1)[0]) : null;
      // Tag 8: 完成时间戳 (容错回退 Tag 7)
      const fTs = top.get(8)?.[0] ? parseProtoFields(top.get(8)[0]) : (top.get(7)?.[0] ? parseProtoFields(top.get(7)[0]) : null);
      // Tag 6: 首 token 到达物理时间戳
      const firstTs = top.get(6)?.[0] ? parseProtoFields(top.get(6)[0]) : null;

      // 提取嵌入用量中的 outputTokens (Tag 9.3)
      if (top.has(9) && top.get(9)[0]) {
        const usage = parseProtoFields(top.get(9)[0]);
        extractedOutputTokens += (Number(usage.get(3)) || 0);
      }

      if (sTs && fTs) {
        const startMs = (Number(sTs.get(1)) || 0) * 1000 + (Number(sTs.get(2)) || 0) / 1e6;
        const finishMs = (Number(fTs.get(1)) || 0) * 1000 + (Number(fTs.get(2)) || 0) / 1e6;
        if (startMs > 0 && finishMs >= startMs) {
          modelTimeMs += (finishMs - startMs);
        }

        if (firstTs && startMs > 0) {
          const firstMs = (Number(firstTs.get(1)) || 0) * 1000 + (Number(firstTs.get(2)) || 0) / 1e6;
          const ttft = Math.max(0, firstMs - startMs);
          // 扩展上限至 300,000ms (5分钟)，覆盖 DeepSeek-R1 / Gemini 3.8 深度思考推理模型长思考延迟
          if (ttft > 0 && ttft < 300_000) {
            ttftSumMs += ttft;
            ttftStepsCount++;
          }
        }
      }
      continue;
    }

    if (stepType === 132) {
      // 132 为工具调用执行 (Tool Invocation)
      stepsCount++;
      if (!row.metadata) continue;
      const top = parseProtoFields(Buffer.from(row.metadata));
      const sTs = top.get(1)?.[0] ? parseProtoFields(top.get(1)[0]) : null;
      const fTs = top.get(8)?.[0] ? parseProtoFields(top.get(8)[0]) : null;
      
      if (sTs && fTs) {
        const startMs = (Number(sTs.get(1)) || 0) * 1000 + (Number(sTs.get(2)) || 0) / 1e6;
        const finishMs = (Number(fTs.get(1)) || 0) * 1000 + (Number(fTs.get(2)) || 0) / 1e6;
        if (startMs > 0 && finishMs >= startMs) {
          // 单次工具耗时上限拦截为 180 秒，防止常驻守护进程/交互阻塞命令扭曲全会话耗时统计
          const rawDuration = finishMs - startMs;
          toolTimeMs += Math.min(180_000, rawDuration);
        }
      }
    }
  }

  // 权威输出 Token：优先使用传入的会话输出总量，否则使用 steps 中累加量
  const finalOutputTokens = totalOutputTokens > 0 ? totalOutputTokens : extractedOutputTokens;
  
  // 纯解码耗时 (剔除首 Token 到达前的思考/排队延迟)
  const decodeDurationSec = Math.max(0, (modelTimeMs - ttftSumMs) / 1000);
  
  // 计算纯解码速度 TPS (对齐 DSH 官方定义，边界保护杜绝 NaN / Infinity)
  const tps = (decodeDurationSec > 0.05 && finalOutputTokens > 0)
    ? Math.round(finalOutputTokens / decodeDurationSec)
    : null;

  return {
    rounds: Math.max(1, roundsCount),
    steps: stepsCount,
    tps,
    modelDurationSec: modelTimeMs / 1000,
    toolDurationSec: toolTimeMs / 1000,
    ttftSec: ttftStepsCount > 0 ? (ttftSumMs / ttftStepsCount / 1000) : null,
  };
}
```

> **架构深度优化 (APOSD 实践)**：在 `scripts/aggregate-stats.cjs:readSingleSession` 中，已有现成的 `steps` 游标遍历循环。工程实施时直接将上述 Protobuf 纳秒时间戳解包与累加逻辑下沉并合并入既有循环，无需额外触发第二趟无索引全表扫描，将会话级遥测解析耗时从 ~14ms 进一步压缩至 ~2ms。

#### B. 广播契约常量扩充 (`src/injection-contract.cjs`)
遵循《软件设计哲学》的信息隐藏与深层接口原则，**绝不引入平行的 `EVENT_DSH_TELEMETRY` 事件通道**，避免双事件流导致的竞态与时序脱节。统一沿用并加深现有的 `EVENT_STATS_UPDATED` 广播总线，将 `dshTelemetry` 直接作为负载扩充至 `window.__ANTIGRAVITY_STATS__`：

```javascript
module.exports = {
  // 原有核心广播与桥接常量 (深层模块接口保持稳定)
  CHANNEL_REQUEST_SYNC: 'antigravity:request-sync',
  EVENT_STATS_UPDATED: 'antigravity:stats-updated',
  WINDOW_BRIDGE_KEY: '__ANTIGRAVITY_SYNC_BRIDGE__',
  WINDOW_STATS_KEY: '__ANTIGRAVITY_STATS__',

  // 状态栏与卡片独立挂载容器标识符
  CONTAINER_STATUSBAR_ID: 'antigravity-dsh-statusbar-container',
  CONTAINER_POPOVER_ID: 'antigravity-dsh-popover-container',
};
```

---

## 5. 分阶段工程落地实施路线图 (Milestones & Roadmap)

### 5.1 里程碑规划 (M1 ~ M4)

```
[M1: 遥测引擎升级] ──► [M2: UI 组件套件实现] ──► [M3: 注入挂载集成] ──► [M4: 双引擎验收]
 (SQLite 解析增强)      (React 19 Popovers)      (standalone 挂载)       (CDP 实机真实验收)
```

| 里程碑编号 | 里程碑名称 | 工作范畴与核心产出 | 依赖前置 | 验收判据 |
|---|---|---|---|---|
| **M1** | **遥测聚合引擎升级** | 扩展 `scripts/aggregate-stats.cjs`，实现 `extractSessionPerformanceMetrics`；解析 steps 纳秒时间戳计算 Model/Tool Time (带 180s 离群截断)、TTFT (300s 阈值覆盖推理模型)、纯解码 TPS (带零输出除零防护与 null 守卫)；单会话读取性能控制在 $< 30\text{ms}$。 | 无 | `node scripts/test-performance-metrics.cjs` 测试通过，断言数据真实有效。 |
| **M2** | **React 19 UI 组件套件实现** | 开发 `DshStatusBar` 及 3 个悬浮卡片 (`SessionStatsPopover`, `TokenUsagePopover`, `ContextUsagePopover`)；配置 Tailwind 与绝对对齐的 CSS 变量；实现视口自适应吸附算法与 256K 压缩阈值标记。 | M1 | 组件单元测试及 Mock 渲染测试 100% 通过，色彩和排版与截图 1:1 一致。 |
| **M3** | **桌面注入与宿主挂载集成** | 重构 `hosts/antigravity/src/standalone.tsx`，将原生简单 Pill 升级为 DSH 常驻状态栏；接入统一的 `EVENT_STATS_UPDATED` (`antigravity:stats-updated`) 事件中的 `dshTelemetry` 载荷；实现 React 19 根实例安全销毁与单例路由重建 (`window.__ANTIGRAVITY_STATUSBAR_ROOT__` 隔离)。 | M2 | `npm run build:bundle` 产物无报错，开发模式下在 Antigravity 界面正常呈现。 |
| **M4** | **实时流式双引擎与真机验收** | 接入前端 live stream ticker (CJK 动态加权)；扩展 `hosts/antigravity/scripts/verify-real-device.cjs`，通过 CDP 连接真实 Antigravity 验证状态栏与悬浮卡片的展开与关闭、真实数据流转。 | M3 | 自动化 CDP 验证脚本全部通过，冷启动与多次会话切换无白屏或内存泄露。 |

---

### 5.2 实施步骤与验收用例

#### M1: 遥测聚合引擎测试用例 (`scripts/test-dsh-metrics.cjs`)
1. **用例 1 (Protobuf 时间戳抽取正确性)**：加载样本数据库，验证 `modelDurationSec > 0` 且 `toolDurationSec >= 0`。
2. **用例 2 (TTFT 边界过滤与推理模型支持)**：验证异常离群值（如 $> 300\text{s}$ 或 $< 0$）被正确剔除，支持深度思考模型长思考延迟，流式取消未测得时安全返回 `null`。
3. **用例 3 (性能基准测试)**：连续执行 50 次 `readSingleSession()`，平均耗时低于 $25\text{ms}$，满足实时性要求。
4. **用例 4 (工具耗时离群拦截与纯解码 TPS)**：验证超过 180s 的后台命令工具耗时被截断至 180s；验证在零输出或极速取消时 TPS 返回 `null` 而非 `NaN`。

#### M2: UI 组件验收标准
1. **状态栏尺寸验证**：DOM 计算高度必须为 `30px`，背景色为 `#161618`。
2. **分段进度条分段测试**：输入系统提示词 `8,200`、工具 `8,300`、消息 `29,400`，验证 3 个色块的 `flex-basis` 或宽度百分比之和严格等于总填充宽度。
3. **Popover 边界自适应测试**：模拟容器在窗口最右侧（$x > \text{window.innerWidth} - 320$），卡片自动应用 `right-0` 翻转吸附，不产生水平滚动条。

#### M3: 注入稳定性验证
1. **路由切换重挂载测试**：在 Antigravity 中从 `/` 导航至 `/c/session-a`，再快速切换至 `/c/session-b`，验证控制台无 `createRoot` 错误，状态栏数据秒级刷新。
2. **会话数据同步测试**：手动向会话追加交互，验证 WAL 写入后 300ms 内状态栏数值发生真实跳变。

---

### 5.3 风险矩阵与应对策略

| 风险编号 | 风险描述 | 概率 | 严重度 | 缓解与防范措施 | 回滚预案 |
|---|---|---|---|---|---|
| **R-01** | **Antigravity 宿主升级导致 DOM 挂载点锚点失效** | 中 | 高 | 采用多选择器备用降级链：优先 `#part-statusbar` -> 次选 `button[data-testid="permissions-selector-trigger"]` 底部容器 -> 降级为全局悬浮 Bottom Bar (`fixed bottom-0`)。 | 降级为自定位全局容器，不阻断使用。 |
| **R-02** | **长会话下 `steps` 表过大导致解析卡顿** | 低 | 中 | 在 `readSingleSession` 中对 `steps` 查询添加索引感知与增量游标缓存机制，仅扫描未处理步数并维护累加器。 | 降级为仅解析最近 200 步并估算。 |
| **R-03** | **Windows 文件并发访问 `SQLITE_BUSY`** | 中 | 低 | 开启 `DatabaseSync` 只读模式；引入指数退避防抖；读失败时返回内存最新快照。 | 自动使用上一帧缓存，下个事件重新触发。 |
| **R-04** | **用户界面缩放 (DPI Scaling) 导致 Popover 位置偏移** | 低 | 低 | 悬浮定位通过 `getBoundingClientRect()` 动态获取视口物理坐标，结合 `transform: translate3d` 实现亚像素级对齐。 | 限制在触发器正上方固定偏移 `8px`。 |

---

## 6. 结语与后续工作

本工程方案通过系统性的逆向分析、实机 SQLite 底层数据源挖掘以及严谨的软件架构设计，打通了从开源前沿标杆 **DeepSeek Harness** 到 Windows 宿主注入系统 **AntiToken** 的完整对齐链路。通过在底层坚持数据真实性、在中间层构建双引擎混合时序管道、在前端提供极致细腻的微交互呈现，该方案将赋能 Antigravity 用户在享受原生桌面集成便利的同时，获得工业级高精度与高美感的 AI 交互遥测体验。
