# Antigravity Token Stats

[English](README.md) · **简体中文**

---

适用于 **Google Antigravity 2.0** 桌面端的本地 Token 用量看板。

原生集成到客户端界面中（**Settings → Usage Stats** 或快捷键 `Alt+T`）。数据直接解析本地 SQLite `gen_metadata`（Protobuf）与 transcript 日志，**不按字符估算**，真实精确。

### 特性

- **订阅额度与价值评估**：实时捕获周/月官方配额用量与重置倒计时，按 Google 官方 API 价格反推订阅总容量与回本倍数。
- **精准拆分**：Input、Cache Read、Thinking（思考模型消耗）、Response 独立统计。
- **活跃看板**：GitHub 风格日度活跃热力图，支持单日下钻明细与连续打卡天数。
- **免 TUN 进程代理**：吸收 `antigravity-proxy` 核心技术，支持桌面端与 IDE 端的透明 Winsock 代理劫持，无需管理员权限或全局 TUN 模式，自带出口 IP 限制诊断。
- **原生集成与无损回滚**：原生集成进 `app.asar`，自动出厂备份，支持随时一键无损还原（`npm run unpatch`）。
- **本地只读**：仅读取本机目录（`%USERPROFILE%\.gemini\antigravity`），零外发上报。

### 运行环境

- Windows
- Node.js **22.13+**（依赖内置 `node:sqlite`）
- [Google Antigravity 2.0](https://antigravity.google/)

### 项目结构

- `src/` — 共享核心：看板组件（`components/stats/`）、领域类型、统计/定价服务、自身双语文案，以及注入器↔UI 契约（`injection-contract.cjs`）
- `hosts/antigravity/` — 桌面端适配层：注入入口（`standalone.tsx`）、宿主界面汉化、桌面端脚本（ASAR 补丁器、loader、路径探测、真机验收）
- `hosts/antigravity-ide/` — 预留给 Antigravity IDE 版适配（复用/新建拆分见其 README）
- `scripts/` — 共享工具：数据聚合引擎（`aggregate-stats.cjs`）、测试套件、mock 数据生成

### 快速开始

#### 方式一：下载 Release 预编译包（推荐，无需本地构建）

1. 前往 [Releases 页面](https://github.com/1yayaye/antigravity-token-stats/releases) 下载最新的 `antigravity-token-stats-vX.Y.Z.zip`。
2. 解压到任意目录，双击运行 **`install.cmd`**（若客户端正在运行会提示协助关闭并自动完成注入）。
3. 安装完成后直接启动 Antigravity 客户端即可！
> **提示**：需要恢复官方原厂状态时，随时双击 **`uninstall.cmd`** 即可一键干净还原。

#### 方式二：从源码安装与开发

```bash
git clone https://github.com/1yayaye/antigravity-token-stats.git
cd antigravity-token-stats
npm run setup
```

开发者模式（利用软链接热重载，代码变更无需每次重解包压包 asar）：
```powershell
pwsh -File .\install.ps1 -Dev
```

安装完成后，直接打开 Antigravity 或使用桌面快捷方式，客户端会自动加载看板与汉化增强。

**呼出方式**：
1. 快捷键 **`Alt+T`**（macOS 为 `⌥T`）
2. 客户端左下角 **Settings → Usage Stats**
3. 注入成功时弹出的右上方 Toast

### 常用命令

| 命令 | 用途 |
| :--- | :--- |
| `npm run patch` | 为 Antigravity 打入原生 Stats 看板与汉化补丁 |
| `npm run unpatch` | 一键无损恢复官方出厂 app.asar 状态（或运行 `uninstall.cmd`） |
| `npm run package:release` | 构建 Release 发布压缩包 (ZIP，需 Node.js 22.13+) |
| `npm run launch` | 启动 Antigravity 2.0 |
| `npm run dev` | 网页端预览看板 (<http://localhost:5173>) |
| `npm run aggregate` | 终端直接打印汇总指标 |
| `npm run setup` | 运行 Windows 一键安装与打补丁流程 |
| `npm test` | 运行离线全套自动化回归测试 |
| `npm run proxy:status` | 查看桌面端与 IDE 端的代理安装与运行状态 |
| `npm run proxy:install` | 一键安装免 TUN 代理（`--target all/desktop/ide --port 7890`） |
| `npm run proxy:uninstall` | 一键无损卸载并清理代理文件 |
| `npm run proxy:test` | 测试代理连通性与 Google 接口握手延迟 |
| `npm run proxy:diagnose` | 扫描诊断日志中是否命中地区限制（Code 400） |
| `npm run mock:data` | 生成本地测试仿真数据（用于无 Antigravity 环境） |

### 测试与调试

关于在无 Antigravity 环境、CI/CD 持续集成、或跨机器调试的完整流程，请参阅：  
👉 **[跨环境测试与调试实操指南 (TESTING.md)](TESTING.md)**

### 免责声明

非 Google 官方项目，与 Google / DeepMind 无关。代码开源遵循 [MIT](LICENSE)。
