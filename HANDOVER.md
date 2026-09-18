# Antigravity Token Stats — 跨模型项目交接文档 (Handover Document)

> **文档目的**：本文档旨在供后续接手的非 Antigravity 模型（如 Claude 3.7 / GPT-4o / Cursor AI 等）快速全面了解本项目。阅读本文档后，可**零上下文损耗、零猜测**地直接在 Windows + Antigravity 2.0 环境中进行开发、实时调试与测试。

---

## 1. 项目全景与当前内容 (Project Overview & Current State)

### 1.1 项目定位
- **项目名称**: `antigravity-token-stats`
- **核心目标**: 为 **Google Antigravity 2.0** 桌面客户端打造一套**高美学、无侵入、零估算（100% Ground Truth）**的 Token 用量与 Agent 行为统计看板。
- **运行载体**: 嵌入于 Antigravity 2.0 桌面端（基于 Electron），通过热注入或补丁无侵入挂载在客户端 `Settings -> Usage Stats` 标签页，或通过全局快捷键 `Alt+T` / 悬浮 Toast 唤起独立毛玻璃弹窗。

### 1.2 技术栈与核心架构
| 分层 | 技术选型 | 作用与关键设计 |
| :--- | :--- | :--- |
| **前端展现层** | React 19 + TypeScript + Tailwind CSS 3 | 遵循桌面原生深色高品味设计规范，匹配 Antigravity 2.0 原生 CSS 变量（`--background`, `--foreground`, `--card`, `.dark` 等）。 |
| **打包系统** | Vite 6 + 自定义 `inlineCssPlugin` | 产出单文件 IIFE Bundle (`dist-bundle/antigravity-stats-bundle.js`)，CSS 自动以内联 `<style data-version="...">` 注入，**零外部文件依赖**。 |
| **数据采集层** | Node.js 原生 `node:sqlite` + 纯 JS Protobuf 解码器 | **完全移除了所有字符估算（如 `/ 3.5`, `/ 3.8`）**。直接解析 SQLite 中 Google Gemini API 返回的 `gen_metadata` 序列化 Protobuf BLOB，提取精确的 Input, Output, Thinking, Cache Read, Response Tokens。 |
| **注入与调试层** | Chrome DevTools Protocol (CDP) WebSocket 通信 | 通过读取本地 `DevToolsActivePort` 端口直接连接 Electron 渲染进程，无需重启即可在 1 秒内完成热注入 (`inject-live.cjs`) 与热重载。 |
| **注入回滚** | `unpatch-antigravity.cjs` | 仅用于回滚历史 ASAR 补丁；日常开发使用 CDP 热注入。 |

### 1.3 核心数据模型与真实数据指标 (Ground Truth)
数据聚合模块通过 `scripts/aggregate-stats.cjs` 实现，基于 3 阶段无重叠架构（SQLite 元数据去重 -> Transcript 日志匹配 -> Session 合并）：
- **终生 Token (Lifetime Tokens)**: Input + Cache Read + Output 的真实累加，不做估算。
- **Prompt Cache 命中率**: 来自 Gemini 原生 Context Caching 的 cache-read / input 比例。
- **Thinking / Response 区分**: 精确分离模型内部链式思考（`thinking_output_tokens`）与实际输出内容（`response_output_tokens`）。
- **Agent Skills vs Tool Primitives**: 明确区分自定义高阶 Agent Skills（如 `tdd`, `design-taste-frontend`）与底层工具原语调用（如 `run_command`, `view_file`）。
- **增量缓存性能**: 基于文件与 WAL 文件的 `mtimeMs` 建立内存级 `dbCache`，重复增量扫描延迟 **< 5ms**。

### 1.4 当前项目健康度与修复状态 (截至 2026-09-07/08)
- ✅ **19 项自动化回归测试全部通过** (`npm test`)，覆盖：
  - Protobuf 编解码单元测试与 Varint 边界校验
  - 启发式估算代码（`/ 3.5`, `/ 3.8`）彻底清除审查
  - 会话级去重（`sessionMetrics` Map）防止 SQLite 与 Transcript 双重累加
  - Settings 模态窗口异步渲染防竞态与 DOM 保护
  - WebSocket 连接防泄漏与 CDP 心跳断开清理
  - 数据目录缺失优雅降级（不崩溃）

---

## 2. Antigravity 2.0 运行机制与核心目录体系

接手模型需要理解 Antigravity 2.0 是 Google DeepMind 打造的桌面智能体 IDE，核心运行环境基于 Electron。

### 2.1 关键文件与目录路径 (Windows 环境)
| 目录/文件路径 | 角色与存储内容 |
| :--- | :--- |
| `%LocalAppData%\Programs\antigravity\Antigravity.exe` | 客户端主可执行程序。 |
| `%LocalAppData%\Programs\antigravity\resources\app.asar` | Electron 主包；历史补丁如仍存在，可用 `npm run unpatch` 回滚。 |
| `%AppData%\Roaming\Antigravity\DevToolsActivePort` (或 Local) | 记录远程调试端口文件。第一行为端口号（如 `9222`），第二行为调试路径。 |
| `~/.gemini/antigravity/` (`C:\Users\<User>\.gemini\antigravity\`) | **用户全局会话与数据根目录**。 |
| `~/.gemini/antigravity/conversations/*.db` | SQLite 数据库，每个文件代表一个历史会话。包含表 `gen_metadata` (Protobuf 统计数据)、`turns`、`sessions` 等。 |
| `~/.gemini/antigravity/brain/<id>/.system_generated/logs/transcript.jsonl` | 各会话的详细事件流水，包含每一轮的 `USER_INPUT`、`PLANNER_RESPONSE`、工具调用与思考记录。 |
| `~/.gemini/antigravity/mcp/<serverName>/` | MCP 工具缓存与 Schema 定义。 |

### 2.2 SQLite 中的 `gen_metadata` Protobuf 协议反向工程
Google Gemini API 将模型调用指标以 Protobuf 二进制序列化后存放在 SQLite 表 `gen_metadata` 的 `data` 字段（BLOB）：
- **根消息 Tag 1** (Length-delimited):
  - **Tag 4** (Length-delimited, `ModelUsageStats`):
    - `Tag 2` (Varint): `input_tokens`
    - `Tag 3` (Varint): `output_tokens`
    - `Tag 5` (Varint): `cache_read_tokens`
    - `Tag 9` (Varint): `thinking_output_tokens`
    - `Tag 10` (Varint): `response_output_tokens`
  - **Tag 19** (Length-delimited, String): `model_name` (如 `gemini-3.8-flash`, `gemini-3.7-flash`)

本项目在 `scripts/aggregate-stats.cjs` 中编写了纯原生零依赖的 `decodeVarint` 与 `parseProtoFields`，直接反序列化该 BLOB，确保准确度与效率。

---

## 3. Antigravity 2.0 实时调试与热注入操作指南

开发此插件时，**强烈建议使用 CDP 热注入模式**，避免反复解包打包 `app.asar`。

### 3.1 极速启动与实时调试推荐工作流 (Pure CDP Hot-Injection)

```bash
# 步骤 1: 编译最新的 Standalone IIFE Bundle
npm run build:bundle

# 步骤 2: 启动 Antigravity 并自动热注入（如果已在运行，会自动连接并注入）
npm run launch

# 步骤 3: 也可以随时在控制台运行单次热注入（1 秒生效，无需重启客户端）
npm run inject:live

# 步骤 4: 启动文件监听与自动同步模式（开发调试 UI 时推荐）
npm run inject:watch
```

#### 运行原理与关键操作：
1. **自动端口探测**: `inject-live.cjs` 自动定位 `%AppData%\Roaming\Antigravity\DevToolsActivePort` 提取端口。
2. **WebSocket CDP 会话**: 连接到 Electron 主页面的 `webSocketDebuggerUrl`。
3. **清理旧实例**: 执行清理脚本注销先前的 `MutationObserver`、React Root 与 DOM 节点，避免内存泄漏与幽灵 DOM。
4. **注入与唤醒**: 将最新的 `window.__ANTIGRAVITY_STATS__` 和 bundle 代码灌入渲染进程，并触发 Glassmorphism Toast 或直接激活看板。

### 3.2 界面交互与控制台排查技巧
- **唤出看板**:
  - 方式 A: 打开左下角 **Settings (设置)** -> 点击新增的 **Usage Stats** 导航项。
  - 方式 B: 按全局快捷键 **`Alt+T`**（Mac 上为 `⌥T`），呼出居中独立模态弹窗。
  - 方式 C: 点击右上角弹出的毛玻璃 Toast 提醒。
- **呼出 Electron DevTools**:
  - 在 Antigravity 窗口中按 **`Ctrl+Shift+I`** (或 `F12`)。
  - 在 **Console** 过滤器中输入 `[TokenStats]` 或 `[CDP]`，可看到详细的注入与渲染日志。
  - 控制台全局 API 测试：
    ```javascript
    // 打开独立弹窗
    window.AntigravityStats.openModal();
    // 触发手动数据同步
    window.__ANTIGRAVITY_REQUEST_SYNC__();
    // 查看当前注入的统计数据
    console.log(window.__ANTIGRAVITY_STATS__);
    ```

### 3.3 历史 ASAR 补丁回滚
如果机器上仍残留旧的 ASAR 补丁，可执行：
```bash
# 如遇异常或 Antigravity 官方大版本更新，执行安全回滚
npm run unpatch
```

---

## 4. 常用命令速查表 (Cheat Sheet)

```bash
# === 构建与测试 ===
npm test                # 运行全套 19 项自动化回归测试 (<2 秒)
npm run build:bundle    # 构建生产用注入 bundle (dist-bundle/antigravity-stats-bundle.js)
npm run dev             # 启动本地 Vite 浏览器预览模式 (http://localhost:5173)
npm run build           # 编译 TypeScript 并构建 Web 预览版本

# === 调试与运行 ===
npm run launch          # 智能启动 Antigravity 2.0 并热注入
npm run inject:live     # 向正在运行的 Antigravity 热注入最新 bundle
npm run inject:watch    # Watch 模式：监听会话数据变化与热更新
npm run aggregate       # 验证数据聚合计算并在控制台打印关键指标

# === 历史补丁回滚 ===
npm run unpatch         # 还原历史 ASAR 补丁
npm run setup:shortcut  # 生成带 Token Stats 的桌面快捷方式
```

---

## 5. 接手模型后续操作与注意事项 (Next Steps & Gotchas)

### 5.1 核心文件组织与修改边界
- **业务逻辑与数据聚合**: `scripts/aggregate-stats.cjs`（负责 SQLite 读取与 Protobuf 解析，严禁引入字符除法估算）。
- **渲染容器与桌面宿主通信**: `src/standalone.tsx`（负责 DOM Mutation 监听、Settings 模态框注入、快捷键、Toast）。
- **看板 UI 组件**: `src/components/stats/`：
  - `StatsView.tsx`: 仪表盘主入口。
  - `KpiBanner.tsx`: 顶部核心 KPI 卡片。
  - `TokenActivityHeatmap.tsx`: Daily GitHub 风格活跃度热力图矩阵。
  - `TokenBreakdownCard.tsx`: Input, Thinking, Response, Cache 命中表格。
  - `ActivityInsightsCard.tsx`: Fast Mode 比例、Agent Skills 使用量等。
- **打包配置**: `vite.bundle.config.ts`（必须保证 `inlineCssPlugin` 能够将 Tailwind 样式内联进 bundle）。

### 5.2 避坑要点 (Critical Gotchas)
1. **绝不使用估算启发式算法**: 曾经存在的 `chars / 3.5` 或 `bytes / 3.8` 已被全部废黜，后续任何新增指标必须从 SQLite Protobuf 或 Transcript 事件中提取真实值。
2. **React 异步 DOM 变动与竞态**: Settings 模态框可能会随用户点击不同 Tab 发生 React 卸载与重渲染。在 `src/standalone.tsx` 中插入 DOM 时，必须始终通过 `parent.contains(anchorElement)` 进行前后双重校验。
3. **Windows 路径与进程退出**: Windows 命令行调用 CDP 时使用正斜杠或妥善转义。启动脚本和注入脚本必须确保在完成时关闭 WebSocket 连接，避免文件描述符（FD）耗尽。
4. **单文件 Bundle 约束**: 注入桌面端的脚本必须自包含（Zero external HTTP requests），图标使用内联 SVG。
