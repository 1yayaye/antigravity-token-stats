# Antigravity Token Stats

**English** · [简体中文](README_CN.md)

---

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
