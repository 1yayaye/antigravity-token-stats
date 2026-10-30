# hosts/antigravity-ide — Antigravity IDE 适配层

以 VSCode 扩展形式为 Antigravity IDE（VSCode fork，内核 1.107.0）提供 Token Stats 侧边栏视图。
共享核心（`src/`）与聚合引擎（`scripts/aggregate-stats.cjs`）零改动复用。

## 结构

| 路径 | 职责 |
|---|---|
| `extension/package.json` | 扩展清单：活动栏视图容器 + WebviewView + `antigravity-ide-stats.refresh` / `antigravity-ide-stats.open` 命令、侧边栏标题刷新按钮、`Alt+T` 快捷键 |
| `extension/src/extension.ts` | 扩展宿主：require 仓库根 `scripts/aggregate-stats.cjs`（显式 `dataDir=~/.gemini/antigravity-ide`），`fs.watch` conversations/ 与 brain/，防抖节奏沿用 `hosts/antigravity/scripts/loader.cjs`（400ms 最小防抖、2s 全量扫描间隔、在途合并），经 `webview.postMessage` 推送统计、主题与实时配额 |
| `extension/src/status-bar.ts` | 状态栏项（桌面 chat context pill 的等价物）：`$(beaker) <tokens> (<pct>%)`，当前会话按 running → 最新 turn → watcher 最新 .db 兜底选取；>55% 警告 / >85% 错误背景；点击（`Alt+T`）打开 Token Stats 侧边栏；tooltip 对齐桌面 popover 信息集 |
| `extension/src/quota-service.ts` | 实时配额服务（纯 Node，可独立探测）：读 IDE `state.vscdb` 的 OAuth token（protobuf 解码）→ 过期前 120s 单飞刷新 → 携桌面 UA 头直调 `retrieveUserQuotaSummary` → 复用共享 `parseQuotaSummaryResponse`；60s 节流，403/无登录优雅返回 null |
| `extension/out/` | 编译产物（esbuild 打包，见 `scripts/build-extension-ide.cjs`；类型检查由根 tsconfig 承担） |
| `extension/media/` | 构建产物 `antigravity-stats-ide-bundle.js`（勿手改）+ 活动栏图标 |
| `src/ide-contract.ts` | IDE 特有的 extension↔webview 消息契约（不进共享契约；视图/命令 id 同时存在于清单 JSON，属 VSCode 限制） |
| `src/webview/standalone.tsx` | Webview 入口：收到消息后设置 `window.__ANTIGRAVITY_STATS__` / `window.__ANTIGRAVITY_LIVE_QUOTA__` 并派发 `antigravity:stats-updated`，共享 `StatsView` / `SubscriptionQuotaCard` 经既有取数路径自动渲染 |
| `scripts/probe-quota.cjs` | 配额探测/回归工具：esbuild 打包 quota-service 后调用 `fetchLiveQuota(true)`，stdout 输出 weeklyGemini + capturedAt（退出码 0=拿到数据） |

主题：扩展宿主读 `window.activeColorTheme.kind`（高对比度归并为 dark/light）下发；webview 在
`documentElement` 设置 `data-vscode-theme-kind` 并同步 `dark`/`light` class，`detectAntigravityTheme`
据此自动切换。

## 实时配额通道

桌面端从渲染进程 React Fiber 上的 `cloudCodeService` 取实时配额，IDE webview 拿不到。IDE 扩展宿主
改走云端直连：用 IDE 自己的登录 token（`AppData/Roaming/Antigravity IDE/User/globalStorage/
state.vscdb` → `antigravityUnifiedStateSync.oauthToken`，base64 protobuf，IDE 运行中可并发只读），
过期前 120 秒单飞刷新，然后以 Antigravity 桌面端相同的 UA 头（缺失会 403 SUBSCRIPTION_REQUIRED）
POST `retrieveUserQuotaSummary`。60 秒内存节流（失败同样计入，避免请求风暴）；无登录或 403/错误时
返回 null，webview 侧优雅隐藏实时配额卡片。token 值绝不写入日志。探测/回归：

```
node hosts/antigravity-ide/scripts/probe-quota.cjs
```

## 命令

- `npm run build:bundle:ide` — 以 `HOST_TARGET=antigravity-ide` 构建共享 UI 到 `extension/media/`。
- `npm run build:extension:ide` — 编译扩展宿主到 `extension/out/`。
- `npm run dev:ide` — 依次执行上述两步，并以 `--extensionDevelopmentPath` 启动开发宿主。
  IDE 安装路径因机器而异，须先设置环境变量 `ANTIGRAVITY_IDE_CMD` 指向启动器，例如
  `set ANTIGRAVITY_IDE_CMD=D:/Programs/Antigravity IDE/bin/antigravity-ide.cmd`。首次运行需在
  IDE 中 F5 或直接打开侧边栏 Token Stats 视图；数据落在 `~/.gemini/antigravity-ide/`。
  设置 `ANTIGRAVITY_IDE_CDP_PORT`（如 9222）会给 IDE 追加 `--remote-debugging-port=<port>`，
  便于 CDP 验收脚本连接；不设置时启动行为不变。
- `Alt+T`（或点击状态栏 `$(beaker)` 项）打开 Token Stats 侧边栏，对齐桌面端快捷键。

第一版本地加载（Extension Development Host），不做 VSIX 打包；不做宿主界面汉化与 workbench
文件补丁。

## 约定

- IDE 专属代码只放本目录，不进入 `src/` 共享层；host 依赖 shared，不允许 shared import host。
- 注入器与共享 UI 之间的接口事实一律引用 `src/injection-contract.cjs` 常量，不重复字符串字面量。
- 验收标准与桌面端一致：`npm run build`、`npm test` 通过，且在真实 IDE 中 Stats 视图实际渲染
  （冷启动 + 二次启动 + 侧边栏入口）。
