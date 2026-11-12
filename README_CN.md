# Antigravity Token Stats

[English](README.md) · **简体中文**

---

适用于 **Google Antigravity 2.0** 桌面端的本地 Token 用量看板。

原生集成到客户端界面中（**Settings → Usage Stats**）。数据直接解析本地 SQLite `gen_metadata`（Protobuf）与 transcript 日志，**不按字符估算**，真实精确。

### 特性

- **订阅额度与价值评估**：实时捕获周/月官方配额用量与重置倒计时，按 Google 官方 API 价格反推订阅总容量与回本倍数。
- **精准拆分**：Input、Cache Read、Thinking（思考模型消耗）、Response 独立统计。
- **活跃看板**：GitHub 风格日度活跃热力图，支持单日下钻明细与连续打卡天数。
- **免 TUN 进程代理**：吸收 `antigravity-proxy` 核心技术，支持桌面端与 IDE 端的透明 Winsock 代理劫持，无需管理员权限或全局 TUN 模式，自带出口 IP 限制诊断。
- **原生集成与无损回滚**：原生集成进 `app.asar`，自动出厂备份，支持随时一键无损还原（`npm run unpatch`）。
- **本地只读**：仅读取本机目录（`%USERPROFILE%\.gemini\antigravity`），零外发上报。

### 运行环境

- Windows（使用 Release 独立 `.exe` 安装器**无需安装 Node.js**）
- [Google Antigravity 2.0](https://antigravity.google/)
- **仅从源码运行 / 构建时**：Node.js **22.13+**（依赖内置 `node:sqlite`）；构建 `.exe` 安装器还需 .NET SDK

### 项目结构

- `src/` — 共享核心：看板组件（`components/stats/`）、领域类型、统计/定价服务、自身双语文案，以及注入器↔UI 契约（`injection-contract.cjs`）
- `hosts/antigravity/` — 桌面端适配层：注入入口（`standalone.tsx`）、宿主界面汉化、桌面端脚本（ASAR 补丁器、loader、路径探测、真机验收）
- `hosts/antigravity-ide/` — Antigravity IDE 扩展宿主：侧边栏 webview 复用共享 UI，自带聚合/配额通道与 IDE 脚本（复用/新建拆分见其 README）
- `scripts/` — 共享工具：数据聚合引擎（`aggregate-stats.cjs`）、测试套件、mock 数据生成

### 快速开始

#### 方式一：下载独立 `.exe` 安装器（推荐，零依赖）

1. 前往 [Releases 页面](https://github.com/1yayaye/antigravity-token-stats/releases) 下载最新的 `antigravity-token-stats-vX.Y.Z-setup.exe`。
2. 直接双击运行 `antigravity-token-stats-vX.Y.Z-setup.exe`（**无需 Node.js，无需解压**）。安装器会自动探测 Antigravity 桌面端安装路径与本机运行中的代理端口（支持手动指定与连通性测试），若客户端正在运行会提示协助安全关闭并完成注入。
3. 点击 **安装 / 更新补丁**，完成后启动 Antigravity 客户端，进入 **Settings → Usage Stats** 即可使用！
> **提示**：需要卸载补丁并恢复官方原厂状态时，随时打开同一个 `.exe` 安装器，点击 **卸载 / 还原出厂** 即可一键干净卸载。

#### 更新提醒

桌面端会在首次主界面加载完成 10 秒后检查 GitHub Releases，之后每 6 小时检查一次。发现更高的正式版本且安装器已上传时，会显示 **下载更新 / 稍后** 弹窗。点击 **下载更新** 后，默认浏览器会下载对应的 `.exe`；运行安装器并点击 **安装 / 更新补丁** 即可升级。选择 **稍后**、关闭弹窗或按 Esc 后，下次启动可再次提醒。同一版本每次启动只提醒一次，弹窗按系统语言使用中文或英文。

已有用户需先手动升级一次带此功能的版本。更新检查不发送用量数据或会话内容。GitHub 不可达或请求被限流时，仅记录日志，在下一轮检查时重试。

发布者需提升 `package.json.version`，推送对应的 `vX.Y.Z` 标签，并在正式 Release 中附带 `antigravity-token-stats-vX.Y.Z-setup.exe`。发布工作流会拒绝与包版本不一致的标签；同版本重新构建不会触发更新提醒。

#### 方式二：从源码安装与开发（开发者）

```bash
git clone https://github.com/1yayaye/antigravity-token-stats.git
cd antigravity-token-stats
npm install
npm run setup   # 构建 bundle 并打入补丁（默认自动配置 dev-bundle 热重载指针）
npm run launch  # 启动 Antigravity 客户端
```

开发者模式下默认配置了开发热重载指针（`%LOCALAPPDATA%\AntiToken\dev-bundle.path`），后续修改源码后只需运行 `npm run build:bundle` 重新编译即可在客户端内即时生效，无需反复解包压包 asar。

**呼出方式**：
1. 客户端左下角 **Settings → Usage Stats**

### 常用命令

| 命令 | 用途 |
| :--- | :--- |
| `npm run setup` | 一键构建 bundle 并为 Antigravity 打入原生补丁（适合首次配置） |
| `npm run patch` | 为 Antigravity 打入原生 Stats 看板与汉化补丁 |
| `npm run unpatch` | 一键无损卸载补丁并恢复官方出厂 app.asar 状态（或在 .exe 界面点击「卸载 / 还原出厂」） |
| `npm run package:release` | 构建单文件 Release 安装器（`dist-release/antigravity-token-stats-vX.Y.Z-setup.exe`，需 Node.js 22.13+ 与 .NET SDK） |
| `npm run launch` | 启动 Antigravity 2.0 |
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
