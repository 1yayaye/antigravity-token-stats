# Antigravity Token Stats

**English** · [简体中文](README_CN.md)

---

A local, non-invasive token usage dashboard for **Google Antigravity 2.0** desktop client.

Seamlessly integrated into the UI (**Settings → Usage Stats**) via native app.asar integration. All metrics are parsed directly from native SQLite `gen_metadata` (Protobuf) and transcript event logs. **No rough character-based token heuristics**.

### Features

- **Subscription Quota & Value**: Live tracking of weekly/monthly quota usage, reset countdowns, and subscription capacity evaluated at official Google API rates.
- **Exact Breakdown**: Granular stats for Input, Cache Read, Thinking, and Output tokens.
- **Activity Heatmap**: GitHub-style daily calendar with single-day drilldown and streaks.
- **Transparent Proxy (No TUN)**: Integrated transparent Winsock socket proxy for Desktop and IDE. Directs traffic to local SOCKS5/HTTP without administrator rights or global TUN mode.
- **Native Integration & One-Command Rollback**: Programmatically patched into `app.asar` with automatic factory backup and clean rollback (`npm run unpatch`).
- **Local & Private**: Read-only access to `%USERPROFILE%\.gemini\antigravity`. Zero network telemetry.

### Requirements

- Windows
- Node.js **22.13+** (requires built-in `node:sqlite`)
- [Google Antigravity 2.0](https://antigravity.google/)

### Project Structure

- `src/` — shared core: dashboard components (`components/stats/`), domain types, stats/pricing services, self i18n, and the injector↔UI contract (`injection-contract.cjs`)
- `hosts/antigravity/` — desktop adapter layer: injection entry (`standalone.tsx`), host UI translation, and desktop scripts (ASAR patcher, loader, path probing, device acceptance)
- `hosts/antigravity-ide/` — reserved for the future Antigravity IDE adaptation (see its README for the reuse/new-implementation split)
- `scripts/` — shared tooling: data aggregation engine (`aggregate-stats.cjs`), test suites, mock data generation

### Quick Start

#### Option 1: Pre-compiled Release Package (Recommended, no build step)

1. Download the latest `antigravity-token-stats-vX.Y.Z.zip` from [Releases](https://github.com/1yayaye/antigravity-token-stats/releases).
2. Extract the archive and double-click **`install.cmd`** (if Antigravity is open, the installer will help close it safely and apply the patch).
3. Launch Antigravity client and enjoy!
> **Note**: To restore factory state at any time, simply double-click **`uninstall.cmd`**.

#### Option 2: From Source / Developer Mode

```bash
git clone https://github.com/1yayaye/antigravity-token-stats.git
cd antigravity-token-stats
npm run setup
```

Developer mode (uses symlink redirect so UI rebuilds reload instantly without repacking asar):
```powershell
pwsh -File .\install.ps1 -Dev
```

After installation, launch Antigravity directly or open it with your shortcut. The native dashboard and i18n enhancements will load automatically.

**Open Dashboard**:
1. In-app: **Settings → Usage Stats**

### Commands

| Command | Description |
| :--- | :--- |
| `npm run patch` | Patch Antigravity app.asar with native stats & i18n |
| `npm run unpatch` | Restore pristine factory app.asar (or run `uninstall.cmd`) |
| `npm run package:release` | Build a Release ZIP package (requires Node.js 22.13+) |
| `npm run launch` | Launch Antigravity 2.0 |
| `npm run dev` | Standalone browser preview (<http://localhost:5173>) |
| `npm run aggregate` | Print aggregated metrics in terminal |
| `npm run setup` | Run the Windows installer (build & patch) |
| `npm test` | Run complete offline regression test suites |
| `npm run proxy:status` | Check proxy status for Desktop and IDE |
| `npm run proxy:install` | Deploy transparent proxy (`--target all/desktop/ide --port 7890`) |
| `npm run proxy:uninstall` | Cleanly remove transparent proxy files |
| `npm run proxy:test` | Test proxy connection and Google API reachability |
| `npm run proxy:diagnose` | Scan logs for location restrictions (Code 400) |
| `npm run mock:data` | Generate local mock data for non-Antigravity environments |

### Testing & Debugging

For a complete guide on testing in environments without Antigravity installed, CI/CD, and real-device workflows, see:  
👉 **[Testing & Debugging Guide (TESTING.md)](TESTING.md)**

### Disclaimer

Unofficial third-party project. Not affiliated with Google or DeepMind. Licensed under [MIT](LICENSE).
