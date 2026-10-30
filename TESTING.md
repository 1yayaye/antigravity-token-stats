# Antigravity Token Stats — 跨环境测试与调试实操指南 (Testing & Debugging Guide)

> **文档面向对象**：任何在全新机器、CI/CD 持续集成、或**未安装 / 不熟悉 Google Antigravity** 的环境中接手、调试、测试本项目的开发者或 AI 智能体。  
> **核心原则**：零环境假设、全流程可复现、支持离线沙箱与真机环境无缝切换。

---

## 1. Antigravity 2.0 背景与核心知识 (Domain Knowledge)

如果你对 **Google Antigravity** 一无所知，请先了解以下基础事实：

1. **什么是 Antigravity？**  
   Google DeepMind 推出的智能体开发桌面 IDE（基于 Electron 框架构建）。它的底层架构包含 Electron 主进程、渲染窗口、以及用于管理会话状态的后端守护进程。
2. **本项目在其中的角色：**  
   `antigravity-token-stats` 是一套嵌入在 Antigravity 2.0 桌面端中的**无侵入、高精度（100% Ground Truth）、零外部请求**的 Token 消耗看板与汉化增强插件。
3. **数据是如何产生的？**  
   - 当用户在 Antigravity 中与 Gemini 等大模型对话时，Gemini API 返回的 Token 消耗被序列化为 **Protobuf 二进制 BLOB** 写入本地 SQLite 表。
   - 客户端同时记录结构化文本事件流至 **JSONL 日志**。
4. **关键文件与目录体系（Windows 默认规范）：**

| 逻辑路径 | 物理默认路径 (Windows) | 存储内容与用途 |
| :--- | :--- | :--- |
| **会话数据库** | `%USERPROFILE%\.gemini\antigravity\conversations\*.db` | SQLite 数据库。核心表 `gen_metadata`（含 Protobuf 二进制用量数据）、`steps`（事件与时间戳）。 |
| **事件流水日志** | `%USERPROFILE%\.gemini\antigravity\brain\<sessionId>\.system_generated\logs\transcript.jsonl` | JSON Lines 流水日志。记录用户输入、思考过程、工具调用（`tool_calls`）等。 |
| **客户端主程序** | `%LOCALAPPDATA%\Programs\antigravity\Antigravity.exe` | Electron 可执行文件。 |
| **客户端主资源包** | `%LOCALAPPDATA%\Programs\antigravity\resources\app.asar` | Electron ASAR 归档包。补丁注入目标，原厂备份为 `app.asar.backup`。 |
| **开发热重载指针** | `%LOCALAPPDATA%\AntiToken\dev-bundle.path` | 指向本地开发 bundle 的绝对路径。配置后启动客户端直接加载最新代码，无需反复打包 ASAR。 |
| **持久化增量缓存** | `%LOCALAPPDATA%\AntiToken\stats-cache.json` | 增量扫描缓存，毫秒级读取历史会话。 |

---

## 2. 跨机器与无 Antigravity 环境的痛点与机制设计

当你在其他机器、CI 或纯 Web 开发环境中调试时，最常遇到的问题是：**本机根本没有安装 Antigravity，或者 `%USERPROFILE%\.gemini\antigravity` 目录为空**。

本项目通过以下分层设计解决了这一痛点：

1. **环境变量覆盖**：可通过 `ANTIGRAVITY_DATA_DIR` 等环境变量重定向至任意自定义或测试目录。
2. **本地 Mock 仿真数据生成器**：内置 `npm run mock:data` 命令，可在 0.1 秒内生成符合真实 Protobuf 二进制协议与 JSONL 格式的完整测试数据。
3. **零数据优雅降级**：当未检测到任何会话数据时，数据层自动返回标准的 `EMPTY_STATS` 空基线，UI 和聚合逻辑绝不崩溃。
4. **沙箱集成测试**：ASAR 打包与解包测试在操作系统临时目录（`os.tmpdir()`）中运行，无需访问真实客户端路径。

---

## 3. 分层测试实操流程 (Step-by-Step Test Suites)

根据你的调试目的，选择对应的测试分层：

```
┌─────────────────────────────────────────────────────────────┐
│ 分层 1: 离线单元与回归测试 (npm test)                        │
│ 适用: 任何 Node.js 22+ 环境 (无需 Antigravity 客户端)         │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ 分层 2: 本地 Web 仿真调试 (npm run mock:data + npm run dev)  │
│ 适用: 前端 UI、组件、样式、交互排查 (浏览器即可，无需客户端) │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ 分层 3: ASAR 补丁与生命周期测试 (npm run test:integration)   │
│ 适用: 验证打包、注入点、出厂备份与无损回滚 (沙箱临时目录执行) │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ 分层 4: 桌面端真机端到端调试 (安装有 Antigravity 2.0 的环境) │
│ 适用: 生产发布验收、Electron 注入与 DevTools CDP 实时验证   │
└─────────────────────────────────────────────────────────────┘
```

---

### 分层 1：离线自动化单元与回归测试 (无需客户端)

本测试层完全运行在 Node.js 内存与沙箱环境中，包含 25+ 项核心回归测试，执行耗时通常 `< 3 秒`。

```powershell
# 运行全套离线自动化测试
npm test
```

#### 该命令涵盖的核心检查项：
1. **纯 JS Protobuf 解码器校验**：使用合成的 `ModelUsageStats` 二进制序列（Tag 1.4: 1.4.2 input, 1.4.3 output, 1.4.5 cache, 1.4.9 thinking, 1.4.10 response），验证 Varint 解码无误。
2. **零字符除法估算审查**：静态扫描代码库，确保彻底杜绝历史残留的 `chars / 3.5` 或 `bytes / 3.8` 估算逻辑。
3. **数据结构与时间筛选**：验证 `today`, `1d`, `7d`, `30d`, `all` 过滤器的边界与跨天计算。
4. **四象限 Token 容错**：覆盖除零保护、冷缓存（0 命中）、零思考（非思考模型）等边界情况。
5. **主题与样式隔离**：验证 CSS 样式只在看板作用域生效，不污染外部宿主。
6. **双语 i18n 字典完整性**：验证所有键值在中英文下均有对应项，测试动态正则替换。
7. **持久化缓存**：测试重启后增量恢复、单个 transcript 失效增量补齐、损坏 JSON 自动容错。
8. **官方定价与配额倒计时**：基于 Gemini 官方费率反推订阅总容量与回本倍数。

---

### 分层 2：本地 Web 端界面与数据仿真调试 (无需客户端)

如果你需要调整前端界面、修改看板组件或排查样式，无需打入 Electron 补丁，直接在本地浏览器中调试：

#### 步骤 1：生成本地仿真测试数据
```powershell
npm run mock:data
```
> **说明**：该脚本会在项目根目录下生成 `./mock-data` 文件夹，其中包含 2 个典型会话的 SQLite 数据库（含真实的 Gemini 3.8 Flash 与 Gemini 2.5 Pro 二进制 Protobuf 记录）以及对应带有工具调用的 `transcript.jsonl` 日志。

#### 步骤 2：启动 Vite 本地开发服务器
```powershell
npm run dev
```

#### 步骤 3：在浏览器中观察与调试
- 打开浏览器访问：`http://localhost:5173`
- Vite 开发服务器通过内置中间件自动将 `/api/stats` 映射至聚合脚本；聚合脚本检测到不存在系统默认数据目录时，会**自动加载 `./mock-data`**。
- 你将在浏览器中看到包含真实数据看板的所有交互细节：
  - 核心 KPI 卡片（Lifetime Tokens、Peak Tokens、打卡天数）
  - 日度活跃度热力图（可点击单日下钻明细）
  - Input / Cache Read / Thinking / Response 四象限拆解
  - 订阅额度价值评估与官方费率计算
  - 支持中英文即时切换与暗黑模式切换

---

### 分层 3：ASAR 补丁沙箱测试 (无需真实客户端)

验证补丁脚本在解包、注入、打包、以及回滚时的安全可靠性：

```powershell
node scripts/test-integration.cjs
```

#### 验证流程（全自动）：
1. 在操作系统临时目录动态构建干净的 Mock `app.asar` 与 `node_modules`。
2. 执行原生补丁注入流程，校验入口注入点（`__ANTIGRAVITY_STATS_INJECTION__`）与 Preload IPC Bridge。
3. 校验解包目录（`.unpacked`）及二进制文件的完整保留。
4. 校验补丁幂等性（重复打补丁不损坏文件）。
5. 执行 `unpatch` 回滚流程，校验是否 100% 恢复至原始出厂状态，并清理临时热更新重定向文件。

---

### 分层 4：真机原生环境端到端调试 (安装有 Antigravity 2.0 时)

当你在具备 Antigravity 2.0 客户端的环境中进行最终发布前验收时，按以下标准流程操作：

#### 步骤 1：编译最新的 Standalone 单文件 Bundle
```powershell
npm run build:bundle
```
产物输出在 `dist-bundle/antigravity-stats-bundle.js`（内联 Tailwind CSS，零外部依赖）。

#### 步骤 2：关闭 Antigravity 客户端
> [!IMPORTANT]
> 执行打补丁前**必须完全退出 Antigravity 客户端**，否则 Windows 会因为可执行程序占用 `app.asar` 而抛出 `EBUSY: resource busy or locked` 错误。

#### 步骤 3：打入原生补丁并创建快捷方式
```powershell
npm run patch
npm run setup:shortcut
```
该命令会自动将原厂 `app.asar` 备份为 `app.asar.backup`。

#### 步骤 4：启动客户端并唤出看板
```powershell
npm run launch
```
唤出看板的三种方式：
- **快捷键**：按键盘 **`Alt+T`**（Mac 上为 `⌥T`）。
- **设置菜单**：点击客户端左下角 **Settings (设置)** -> 进入新增的 **Usage Stats** 导航页。
- **右上角 Toast**：启动时自动弹出的轻量毛玻璃通知。

#### 步骤 5：使用 DevTools 进行控制台排查
在 Antigravity 客户端窗口中按 **`Ctrl+Shift+I`**（或 `F12`）打开 DevTools：
1. 在 **Console** 面板的过滤器中输入 `[TokenStats]`，可查阅生命周期与数据同步日志。
2. 可直接在控制台执行以下调试 API：
   ```javascript
   // 1. 打开统计模态窗口
   window.AntigravityStats.openModal();

   // 2. 触发即时增量扫描与重新同步
   window.__ANTIGRAVITY_REQUEST_SYNC__();

   // 3. 打印当前内存中的完整聚合数据对象
   console.log(window.__ANTIGRAVITY_STATS__);
   ```

#### 步骤 6：运行真机自动化 CDP 端到端校验
在客户端保持开启的状态下，新开一个终端执行：
```powershell
node hosts/antigravity/scripts/verify-real-device.cjs
```
该脚本通过只读 Chrome DevTools Protocol (CDP) 端口连接到客户端，自动断言注入锚点、DOM 节点渲染与配额卡片，验证后安全退出。

#### 步骤 7：一键回滚出厂状态
如需彻底还原官方客户端，确保客户端关闭后运行：
```powershell
npm run unpatch
```

---

## 4. 环境变量速查表 (Environment Variables)

在跨机器或自动化流程中，可通过以下环境变量覆盖默认行为：

| 环境变量名称 | 说明 | 默认值 (Windows) |
| :--- | :--- | :--- |
| `ANTIGRAVITY_DATA_DIR` | 覆盖用户会话数据根目录（包含 `conversations/` 和 `brain/`） | `%USERPROFILE%\.gemini\antigravity` |
| `ANTIGRAVITY_RESOURCES` | 覆盖 Antigravity 的 `resources` 文件夹路径（包含 `app.asar`） | `%LOCALAPPDATA%\Programs\antigravity\resources` |
| `ANTIGRAVITY_EXE` | 覆盖 `Antigravity.exe` 可执行文件绝对路径 | 自动检测标准安装路径 |
| `ANTIGRAVITY_STATS_CACHE_PATH` | 覆盖持久化统计缓存文件的存放位置 | `%LOCALAPPDATA%\AntiToken\stats-cache.json` |
| `ANTIGRAVITY_DISABLE_PERSIST_CACHE` | 设为 `1` 时完全禁用磁盘持久化缓存，强制每次冷扫描 | 开启缓存 (`0`) |
| `ANTIGRAVITY_GROUND_TRUTH_LIVE` | 设为 `1` 时在 `test-ground-truth.cjs` 中执行真实数据库数值校验 | `0` (仅运行单元逻辑) |

### 环境变量设置示例 (PowerShell 7):
```powershell
# 指定使用自定义或 mock 数据目录
$env:ANTIGRAVITY_DATA_DIR = "D:\MyMockData"

# 临时禁用持久化缓存以进行聚合性能基准测试
$env:ANTIGRAVITY_DISABLE_PERSIST_CACHE = "1"
npm run aggregate
```

---

## 5. 常见问题排查与 FAQ (Troubleshooting)

### Q1: 运行 `npm test` 时控制台提示 `ExperimentalWarning: SQLite is an experimental feature...`
- **原因**：本项目使用 Node.js 22 内置的原生 `node:sqlite` 模块，无需编译 node-gyp 原生 C++ 扩展，效率高且开箱即用。
- **应对**：此为 Node.js 官方标准实验特性提示，不影响功能，完全正常。

### Q2: 打补丁时报错 `EBUSY: resource busy or locked, rename '...app.asar'`
- **原因**：Antigravity 正在后台运行，Windows 文件锁导致无法重命名或写入 `app.asar`。
- **解决**：在任务管理器中结束所有 `Antigravity.exe` 进程，然后重新执行 `npm run patch`。

### Q3: 运行 `npm run dev` 页面显示空白或数据显示为 0
- **原因**：本机未安装 Antigravity，且未生成仿真数据。
- **解决**：在项目根目录下先运行 `npm run mock:data`，然后再执行 `npm run dev`。

### Q4: 开发者模式下修改了 React 代码，如何最快查看效果？
- **推荐工作流**：
  1. 执行 `npm run patch` 为客户端打上补丁。
  2. 补丁加载器已自动配置 `%LOCALAPPDATA%\AntiToken\dev-bundle.path` 指向项目的 `dist-bundle\antigravity-stats-bundle.js`。
  3. 后续只要执行 `npm run build:bundle` 编译，然后在 Antigravity 客户端按快捷键重新呼出或刷新窗口即可立即看到最新代码，**无需反复退出客户端打补丁**。
