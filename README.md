# Antigravity Token Stats

Unofficial, non-invasive token-usage dashboard for **Google Antigravity 2.0**.

为 Google Antigravity 2.0 桌面客户端提供的非官方 Token 用量看板。通过 Chrome DevTools Protocol 热注入到客户端的 **Settings → Usage Stats**，也可以用 `Alt+T` 或右上角 Toast 打开。所有数字都来自客户端自己的 SQLite `gen_metadata` Protobuf 和 transcript 事件，**从不按字符/字节估算 Token**。

> 本项目与 Google / DeepMind 无关，不是官方插件。

## 功能

- 终生 Token、单会话峰值、最长任务跨度、连续活跃天数
- GitHub 风格的日粒度活跃热力图，可点开单日明细
- Input / Cache Read / Thinking / Response 精确拆分
- Fast Mode 比例、最常用推理档位、Skills 使用量
- 中 / 英界面
- 时间范围：今天、近 2 天、7 天、30 天、全部
- 桌面热注入，不改 `app.asar`（历史补丁可用 `npm run unpatch` 回滚）

## 环境要求

- Windows（当前以 Windows 为第一目标）
- [Node.js](https://nodejs.org/) **22.13+**（聚合器使用 `node:sqlite`）
- 已安装 [Google Antigravity 2.0](https://antigravity.google/)

## 快速开始

```bash
git clone https://github.com/<your-username>/antigravity-token-stats.git
cd antigravity-token-stats
npm install
npm run build:bundle
npm run launch
```

`launch` 会启动 Antigravity（若尚未运行），等主界面就绪后注入看板，并拉起 watch 进程做后续热更新。

已经在跑 Antigravity 时，也可以只注入：

```bash
npm run inject:live
```

打开看板：

1. 左下角 **Settings → Usage Stats**
2. 快捷键 **`Alt+T`**（macOS 上为 `⌥T`）
3. 点击右上角弹出的 Toast

浏览器预览（不注入桌面端，读取本机 Antigravity 数据）：

```bash
npm run dev
```

然后打开 <http://localhost:5173>。

## 常用命令

| 命令 | 作用 |
| :--- | :--- |
| `npm run dev` | Vite 浏览器预览 |
| `npm run build` | TypeScript 检查 + Web 构建 |
| `npm run build:bundle` | 产出注入用单文件 `dist-bundle/antigravity-stats-bundle.js` |
| `npm test` | 回归测试（需先 `build:bundle`） |
| `npm run aggregate` | 在终端打印聚合指标 |
| `npm run launch` | 启动 Antigravity 并热注入 |
| `npm run inject:live` | 注入正在运行的客户端 |
| `npm run inject:watch` | 监听数据变化并自动重注入 |
| `npm run setup:shortcut` | 创建「Antigravity (with Stats)」桌面快捷方式 |
| `npm run unpatch` | 回滚历史 ASAR 补丁 |

## 数据从哪来

聚合脚本 `scripts/aggregate-stats.cjs` **只读**本机目录：

```
%USERPROFILE%\.gemini\antigravity\
  conversations\*.db          SQLite，表 gen_metadata 存 Gemini 用量 Protobuf
  brain\<id>\...\transcript.jsonl
```

指标必须来自这两处真实记录。禁止 `chars / 3.5` 这类启发式。增量扫描用 `mtimeMs` 缓存，重复扫描通常 < 5ms。

注入层读取 `%AppData%\Roaming\Antigravity\DevToolsActivePort`，经 WebSocket 连到 Electron 渲染进程，清理旧的 React root / Observer 后再执行 bundle。脚本结束时关闭 CDP 连接。

## 项目结构

```
src/                  React 看板（Web 预览与注入共用）
  components/stats/   KPI、热力图、明细表、洞察卡片
  standalone.tsx      桌面注入入口（Settings 页、快捷键、Toast）
  main.tsx            浏览器预览入口
scripts/              聚合、注入、启动、测试
dist-bundle/          构建产物，不要提交
```

更完整的内部说明见 [HANDOVER.md](HANDOVER.md)、领域词汇见 [CONTEXT.md](CONTEXT.md)。

## 测试

```bash
npm run build:bundle
npm test
```

- `npm run test:integration` 会调用 `unpatch`，并可能连真实客户端。跑之前看清副作用。
- `npm run test:realtime` **会写入真实 conversation 目录**，不要随便跑。
- 桌面注入是否成功，不能只看 Vite 预览或 bundle 是否构建成功。标准是：Stats 视图出现在 Antigravity 窗口里，冷启动和再次启动都还在，Settings → Usage Stats 也能打开。

## 安全与隐私

本仓库**不会**、也**不应该**包含：

- 会话 transcript、SQLite 数据库
- `app.asar` / 备份
- `.scratch/` 解包产物
- 本机路径、`.env`、日志

聚合器对 Antigravity 数据目录是只读的。不要把 `%USERPROFILE%\.gemini\antigravity\` 里的文件提交上来。

## 免责声明

这是第三方实验项目，不是 Google 产品。它通过远程调试协议把脚本注入到本机已安装的 Antigravity。Antigravity 大版本更新可能让 DOM 锚点或数据格式失效。使用前请自行评估风险；历史 ASAR 补丁请用 `npm run unpatch` 还原。

## License

[MIT](LICENSE)
