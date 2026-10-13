# Antigravity Token Stats

[English](README.md) · **简体中文**

---

适用于 **Google Antigravity 2.0** 桌面端的本地 Token 用量看板。

通过 Chrome DevTools 协议（CDP）直接热注入到客户端界面中（**Settings → Usage Stats** 或快捷键 `Alt+T`）。数据直接解析本地 SQLite `gen_metadata`（Protobuf）与 transcript 日志，**不按字符估算**，真实精确。

### 特性

- **订阅额度与价值评估**：实时捕获周/月官方配额用量与重置倒计时，按 Google 官方 API 价格反推订阅总容量与回本倍数。
- **精准拆分**：Input、Cache Read、Thinking（思考模型消耗）、Response 独立统计。
- **活跃看板**：GitHub 风格日度活跃热力图，支持单日下钻明细与连续打卡天数。
- **零侵入注入**：纯内存注入，不改动 `app.asar`，客户端升级不损坏。
- **本地只读**：仅读取本机目录（`%USERPROFILE%\.gemini\antigravity`），零外发上报。

### 运行环境

- Windows
- Node.js **22.13+**（依赖内置 `node:sqlite`）
- [Google Antigravity 2.0](https://antigravity.google/)

### 快速开始

**Windows（推荐）：** 下载或克隆本项目后，双击 `install.cmd`。安装程序会检查 Node.js、安装依赖、构建注入包，并创建「Antigravity (with Stats)」快捷方式。

也可以在 PowerShell 中运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

命令行方式：

```bash
git clone https://github.com/1yayaye/antigravity-token-stats.git
cd antigravity-token-stats
npm run setup
```

安装完成后，使用新建的快捷方式打开 Antigravity，客户端会自动注入看板。

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
| `npm run setup` | 运行 Windows 安装流程（依赖、注入包、快捷方式） |
| `npm run unpatch` | 回滚早期版本修改过的 `app.asar` 补丁 |

### 免责声明

非 Google 官方项目，与 Google / DeepMind 无关。代码开源遵循 [MIT](LICENSE)。
