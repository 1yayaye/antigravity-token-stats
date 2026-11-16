# hosts/antigravity-ide — Antigravity IDE 适配层

在 IDE 底部状态栏提供上下文、额度、今日 Token 三个独立入口，点击后向上展开交互浮层。
界面采用 IDE 原生主题；统计仅汇总 `~/.gemini/antigravity-ide/`，不混入桌面端数据。
设计与数据口径见 [IDE 重构设计](../../docs/ide-redesign.md)。

## 构建、安装与启动

关闭目标 Antigravity IDE 后执行：

```powershell
npm run dev:ide
```

该命令依次构建 UI 和原生宿主、安装补丁，再直接启动发现的 `Antigravity IDE.exe`。
通过 `ANTIGRAVITY_IDE_DIR` 指定安装目录；也支持现有的 `ANTIGRAVITY_IDE_CMD` 路径发现方式。
目标 IDE 仍在运行时安装会停止，不会结束进程。

分步操作：

- `npm run build:bundle:ide`：构建工作台 UI 到 `dist/antigravity-stats-ide-bundle.js`。
- `npm run build:host:ide`：构建额度服务并复制 loader、聚合器和共享注入契约到同一 `dist/`。
- `npm run patch:ide`：安装已构建产物；指定安装目录时直接调用脚本更可靠
  （本机 npm/PowerShell 可能丢失 `--dir` 参数）：`node hosts/antigravity-ide/scripts/patch-ide.cjs --dir 'D:\Programs\Antigravity IDE'`。
- `npm run unpatch:ide`：恢复原始入口并移除本工具的五个运行资产；同样支持 `--dir`。
- `npm run test:ide`：运行 loader、组件和安装回滚的隔离测试。
- `npm run inspect:ide`：检查运行中的原生 IDE：三入口顺序、浮层适配、同入口开关、
  外部点击关闭、Esc 焦点返回、缩小视口适配，以及 `--state` / `--models` / `--screenshot` 诊断。

可选设置 `ANTIGRAVITY_IDE_CDP_PORT` 为 1–65535 的端口号，再运行 `dev:ide`，为本机验收启用 CDP。
未设置时不添加调试端口。启动器直接传递参数，不使用 shell 或扩展开发宿主。

## 登录与代理继承

原生 Go backend 只认环境变量与 `http.proxy` 设置；系统代理仅存于 WinINET 时，
backend 直连 Google 域名并超时，表现为重启 IDE 或电脑后模型加载失败。
宿主 loader 在 import 时注册首个 `ready` 监听（先于原生启动逻辑），在
环境变量与 `http.proxy` 均未配置时，通过 Chromium 的 `resolveProxy` 读取系统
对 OAuth 端点实际使用的代理并注入 `HTTP(S)_PROXY` 与本地 bypass 的 `NO_PROXY`。
任何显式配置、不可读设置、DIRECT 或 SOCKS 解析都会跳过继承，不猜测、不覆盖。

## 集成与回滚

安装器只接受 `resources/app/package.json` 中名称为 `Antigravity IDE`、入口为 `./out/main.js` 的 ESM 应用。
它在 `out/main.js` 前添加原生宿主的导入，将构建资产复制到 `out/antitoken/`；不改 preload、CSP、账户数据库或桌面端。
首次安装以排他方式创建 `out/main.js.antitoken-backup`，后续安装更新资产并保留该原始备份。

卸载恢复与备份完全相同的字节，仅删除已知运行资产，保留目录内其他文件和原始备份。
主入口既不匹配备份也不匹配本工具生成的补丁时，安装和卸载均停止，避免覆盖其他修改。
应用更新导致备份不匹配时也会停止，不会自动覆盖备份或重设数据。

## 数据与显示边界

- 当前会话取当前窗口可见原生聊天的路由信号（应用自身的 OnDidChangeUrl RPC，或 iframe src 路径）；多义或不可识别时显示未识别，不按最近会话推选。
- 上下文显示最近一次已记录请求的输入与缓存；生成期间保留最近采样。没有可信上限时显示 Token 数和“上限未确认”。
- 周额度显示服务端各额度池的剩余比例与重置时间。四周估算复用现有计算，区分外推、无有效样本和不可用状态；API 等值消耗不代表实测月度额度。
- 今日、近七天、近三十天按设备本地自然日汇总全部 IDE 会话。思考包含在输出内，不重复累加；缺失分项显示 `—`。
- 安装的额度服务使用 Electron `net.fetch`，复用宿主网络栈。独立诊断 `node hosts/antigravity-ide/scripts/probe-quota.cjs` 使用 Node fetch，不能据此证明 IDE 代理或原生登录正常；不会输出令牌值。
- 额度凭据来自 IDE 本地存储的 OAuth token。hub 模式的新版 IDE（认证由桌面端守护进程承载）本地只有登录状态哨兵，没有 token，此时额度诚实显示“不可用”，不代读桌面端数据。

## 真实验收记录（2026-11-15）

以下结果来自真实 `Antigravity IDE.exe`（v1.107.0 / Electron 39.2.3）冷启动与重复启动：

- 五个安装资产哈希与仓库构建一致；原始备份在重复安装间保持不变；卸载按字节恢复 `main.js` 并保留备份。
- 三个状态栏入口在 Tab Settings 右侧按序渲染；检查器验证各浮层适配、Token 三行、
  同入口开关、外部点击关闭、Esc 关闭与焦点返回、缩小视口（640×520）适配，全部通过。
- 浮层挂载点为 `.monaco-workbench`（z-index 2500）：聊天面板是跨进程 iframe，
  其合成面无视 body 直挂元素的 z-index，挂进工作台层叠上下文才能盖住它（真机对照验证）。
- 代理继承修复后模型加载恢复正常（错误横幅消失、可选模型出现），重复启动保持有效。
- 当前聊天路由识别经应用自身 RPC 协议端到端验证；会话数据仍只来自 IDE 数据根。
- 未验证：电脑重启后的场景、浮层超长内容滚动（当前无足够数据触发）、深浅主题切换。

## 结构与验收

| 路径 | 职责 |
|---|---|
| `src/webview/standalone.tsx`、`widgets.css` | 三个状态栏组件、互斥浮层、键盘交互和主题 |
| `src/host-state.ts` | 原生宿主与界面的状态类型 |
| `src/quota-service.ts` | IDE 登录态解析与服务端额度读取 |
| `scripts/loader.cjs` | 原生工作台注入、可见聊天识别、IDE 聚合与受限 IPC |
| `scripts/patch-ide.cjs` | 目标校验、安装与精确回滚 |
| `tests/` | 无真实账户数据的 loader、UI 与安装夹具测试 |
| `dist/` | 可重建的 UI 与原生宿主产物，不手工编辑 |

IDE 专属代码留在本目录，共享层不反向依赖宿主。跨注入边界的常量统一引用 `src/injection-contract.cjs`。
构建和夹具通过之后，仍需在真实 IDE 验证冷启动、重复启动、三个浮层、当前聊天切换和原生账户登录；构建成功不等于完成集成验收。
