# Antigravity Token Stats

[English](#english) · [简体中文](#简体中文)

---

## 简体中文

适用于 **Google Antigravity 2.0** 桌面端的本地 Token 用量看板。

通过 Chrome DevTools 协议（CDP）直接热注入到客户端界面中（**Settings → Usage Stats** 或快捷键 `Alt+T`）。数据直接解析本地 SQLite `gen_metadata`（Protobuf）与 transcript 日志，**不按字符估算**，真实精确。

### 特性

- **精准拆分**：Input、Cache Read、Thinking（思考模型消耗）、Response 独立统计。
- **活跃看板**：GitHub 风格日度活跃热力图，支持单日下钻明细与连续打卡天数。
- **零侵入注入**：纯内存注入，不改动 `app.asar`，客户端升级不损坏。
- **本地只读**：仅读取本机目录（`%USERPROFILE%\.gemini\antigravity`），零外发上报。

### 运行环境

- Windows
- Node.js **22.13+**（依赖内置 `node:sqlite`）
- [Google Antigravity 2.0](https://antigravity.google/)

### 快速开始

```bash
git clone https://github.com/1yayaye/antigravity-token-stats.git
cd antigravity-token-stats && npm install
npm run build:bundle
npm run launch
```

> `npm run launch` 会启动客户端，并在界面就绪后自动注入看板与热监听。

**呼出方式**：
1. 快捷键 **`Alt+T`**（macOS 为 `⌥T`）
2. 客户端左下角 **Settings → Usage Stats**
3. 注入成功时弹出的右上方 Toast

### 常用命令

| 命令 | 用途 |
| :--- | :--- |
| `npm run launch` | 启动 Antigravity 并热注入（推荐日常使用） |
| `npm run inject:live` | 仅向当前已打开的客户端注入 |
| `npm run dev` | 网页端预览看板 (<http://localhost:5173>) |
| `npm run aggregate` | 终端直接打印汇总指标 |
| `npm run setup:shortcut` | 创建「Antigravity (with Stats)」桌面快捷方式 |
| `npm run unpatch` | 回滚早期版本修改过的 `app.asar` 补丁 |

### 免责声明

非 Google 官方项目，与 Google / DeepMind 无关。代码开源遵循 [MIT](LICENSE)。

---

## English

A local, non-invasive token usage dashboard for **Google Antigravity 2.0** desktop client.

Injects directly into the UI (**Settings → Usage Stats** or `Alt+T`) via Chrome DevTools Protocol (CDP). All metrics are parsed directly from native SQLite `gen_metadata` (Protobuf) and transcript event logs. **No rough character-based token heuristics**.

### Features

- **Exact Breakdown**: Granular stats for Input, Cache Read, Thinking, and Output tokens.
- **Activity Heatmap**: GitHub-style daily calendar with single-day drilldown and streaks.
- **Zero-Invasive Injection**: Runtime CDP injection without modifying `app.asar`.
- **Local & Private**: Read-only access to `%USERPROFILE%\.gemini\antigravity`. Zero network telemetry.

### Requirements

- Windows
- Node.js **22.13+** (requires built-in `node:sqlite`)
- [Google Antigravity 2.0](https://antigravity.google/)

### Quick Start

```bash
git clone https://github.com/1yayaye/antigravity-token-stats.git
cd antigravity-token-stats && npm install
npm run build:bundle
npm run launch
```

**Open Dashboard**:
1. Shortcut: **`Alt+T`** (macOS: `⌥T`)
2. In-app: **Settings → Usage Stats**
3. Click the notification toast on load

### Commands

| Command | Description |
| :--- | :--- |
| `npm run launch` | Start Antigravity & attach stats (recommended) |
| `npm run inject:live` | Inject into an already running client |
| `npm run dev` | Standalone browser preview (<http://localhost:5173>) |
| `npm run aggregate` | Print aggregated metrics in terminal |
| `npm run setup:shortcut` | Create desktop shortcut |
| `npm run unpatch` | Roll back legacy `app.asar` modifications |

### Disclaimer

Unofficial third-party project. Not affiliated with Google or DeepMind. Licensed under [MIT](LICENSE).
