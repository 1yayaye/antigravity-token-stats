# Changelog

All notable changes to Antigravity Token Stats will be documented in this file.

## [1.5.0] - 2026-10-31

### Added
- **Modern Bento Grid Redesign**: Overhauled stats dashboard layout into an adaptive Bento Grid architecture:
  - **`QuotaHeroCard`**: Hero subscription card highlighting live ROI multiplier, net booked savings, and SVG circular progress rings for Gemini/Claude weekly quota and monthly volume. Remains hidden when online quota is unavailable to avoid phantom metrics.
  - **`TokenSummaryTile`**: Consolidated lifetime, input, output, and active day metrics paired with a 4-channel composition stacked bar (Cache Read, Raw Input, Thinking, Response).
  - **`DailyTrendCard`**: Interactive SVG daily trend area chart with dynamic nice-number gridlines responding to active time range filters (`today`, `1d`, `7d`, `30d`, `all`).
  - **`ProxyStatusCard`**: Compact proxy tile embedded directly within the Bento layout tracking Desktop & IDE socket redirection status.
- **DSH Status Bar Probing & Bridge**:
  - `probeHostPillStyle`: Automatically samples surrounding Antigravity UI typography, font size, and accent tokens for seamless pixel-matching.
  - Transparent hover bridge (`POPOVER_BRIDGE_PX`) and hide timer delay (`POPOVER_HIDE_DELAY_MS`) preventing flicker when moving between status pills and popover cards.
  - Render memoization preventing redundant re-renders during high-frequency telemetry polling.
- **Protobuf Quota Compatibility**: `parseRawBucket` supports the updated `remaining: { case: 'remainingFraction', value }` protobuf schema from the latest Antigravity client release.

### Changed
- **Streamlined Host Integration**: Retired floating toast notification and global `Alt+T` overlay shortcut; unified access exclusively through native **Settings → Usage Stats** tab with clean lifecycle mounting and unmounting.
- **Verification Suites**: Updated unit tests, device acceptance, and CDP verification suites (`test-token-breakdown.cjs`, `test-subscription-pricing.cjs`, `run-device-acceptance.cjs`, `verify-real-device.cjs`) to validate Bento components and Settings navigation.

## [1.4.0] - 2026-10-31

### Added
- **DeepSeek Harness (DSH) Status Bar & Telemetry**: Three-pill status bar embedded alongside the chat footer showing user interaction rounds, steps, text-only TPS, total tokens consumed, cache hit rate, and context window occupancy with a 256K auto-compaction threshold marker.
- **MinHook Transparent Socket Proxy (No TUN)**: Integrated transparent Winsock socket interception (`version.dll`) routing Google API traffic through SOCKS5/HTTP while bypassing loopback TLS connections, manageable via `ProxyStatusCard` and `npm run proxy:*` CLI commands.
- **Antigravity IDE Extension Host**: Adaptation for Antigravity IDE (`hosts/antigravity-ide/`) with independent webview bundle and telemetry aggregation.

### Changed
- **Host-based directory layout**: Desktop-specific code moved to `hosts/antigravity/` (injection entry `standalone.tsx`, host UI translation, ASAR patcher/loader, path probing, device acceptance scripts); `hosts/antigravity-ide/` host target; shared core in `src/`, shared tooling in `scripts/`.
- **Single-source injection contract (`src/injection-contract.cjs`)**: ASAR markers, window globals, IPC channel, event names, and style element id defined once across patcher, loader, bundle, and UI components.
- **Single-source desktop path probing (`hosts/antigravity/scripts/paths.cjs`)**: Install-directory, state-directory, and DevTools-port detection deduplicated across desktop tooling.
- **Inverted i18n coupling**: `LanguageContext` communicates via standard custom events without direct dependency on host translation engine.
- Documentation: project structure and proxy management documented in English and Chinese READMEs.

## [1.3.0] - 2026-10-26

### Added
- **Native ASAR Integration (`loader.cjs` & `patch-antigravity.cjs`)**: Replaced external CDP launch daemon with an in-process Electron loader hooked directly into `dist/main.js` and `dist/preload.js`. Eliminates window navigation race conditions and ghost DOM.
- **Factory Backup & Safe Rollback**: Automatically saves pristine `app.asar.backup` and `.unpacked` with one-command factory restoration via `npm run unpatch`.
- **Chat Input Context Usage Pill & Widget**: Real-time context token occupancy tracking, Prompt Cache hit rate meter, 256k auto-compaction warning, and `/compact` suggestions.
- **Antigravity 2.0 UI Chinese Localization**: Non-invasive DOM tree localization observer and bilingual dictionary for desktop UI.
- **Standalone Release Packaging (`package-release.cjs`)**: Self-contained ZIP archive bundle with double-clickable `install.cmd` and `uninstall.cmd`.
- **Automated GitHub Release Workflow (`.github/workflows/release.yml`)**: Continuous integration and release packaging on `v*` tags.
- **Comprehensive Real-Device Acceptance Suite (`scripts/run-device-acceptance.cjs`)**: 11-phase end-to-end CDP automated validation against live running Antigravity.
- **Direct Shortcut Execution**: Desktop shortcut points directly to `Antigravity.exe` without intermediary Node processes.
- **Developer Redirect Mode**: `loader.cjs` dynamically loads bundles from `%LOCALAPPDATA%\AntiToken\dev-bundle.path` when present.

## [1.2.0] - 2026-10-14

### Added
- **Subscription Quota & Value Card (`SubscriptionQuotaCard`)**: Weekly and monthly quota tracking and capacity valuation based on official Google API pricing.
- **Runtime Quota Auto-Capture**: Automatically captures live quota remaining fractions and reset countdowns directly from Antigravity's host `cloudCodeService.retrieveUserQuotaSummary`.
- **Official API Pricing Engine (`pricing-service.ts`)**: Evaluates token consumption with exact Google rates ($0.75 / 1M uncached input, $0.075 / 1M cache read with 90% discount, $3.75 / 1M thinking & output).
- **Subscription Capacity Back-Calculation**: Reverses weekly capacity (`consumed / usedFraction`) and monthly value from actual consumption.
- **Subscription Tier Selector**: Switch between Pro ($19.99/mo), Ultra 5x ($99.99/mo), Ultra 20x ($199.99/mo), Free, and Custom plans with live ROI multiplier computation and localStorage persistence.
- **Claude / 3P Weekly Pool**: Real-time display of Claude/third-party model weekly quota and reset timer.
- **Automated Pricing & Real-Device Tests**: Regression suites in `scripts/test-subscription-pricing.cjs` and real-device CDP verification in `scripts/verify-real-device.cjs`.

## [1.1.1] - 2026-09-28

### Added
- Windows installer scripts that install dependencies, build the injection bundle, and create the desktop shortcut.
- `npm run setup` as the command-line installer entry point.

## [1.1.0] - 2026-09-18

First public GitHub snapshot. CDP hot injection is the supported install path.

### Changed
- Removed the ASAR patch installer (`npm run patch`). Historical patches still roll back with `npm run unpatch`.
- Removed the background sync daemon (PID file, WMI relaunch, log rotation). `npm run launch` now starts Antigravity and spawns `inject:watch`.
- Removed the fake desktop chrome from the Vite preview. `npm run dev` renders the stats dashboard directly.
- Activity heatmap is daily-only (weekly / cumulative views and spline overlays are gone).
- Token breakdown is a table instead of dual-ring charts.
- Dropped unused `clsx`, `tailwind-merge`, and `@phosphor-icons/react`. Icons stay as inline SVG.

### Added
- Public `README.md`, MIT license, and Windows CI (`build` → `build:bundle` → `npm test`).

### Notes
- Agent-only docs (`AGENTS.md`, `CLAUDE.md`, `CONTEXT.md`, `HANDOVER.md`) stay on the local machine and are not published.

## [1.0.1] - 2026-09-07

### 🐛 Critical Bug Fixes

#### Data Accuracy
- **Fixed token double-counting bug** that inflated lifetime metrics by 2-3× when both SQLite and Transcript data sources existed
  - Rewrote aggregation with 3-phase architecture: SQLite metadata → Transcript tokens → Session-level merge
  - Added `sessionMetrics` Map to deduplicate by conversation ID
  - Transcript tokens now take precedence over database estimates

#### Injection Stability
- **Fixed injection marker deletion logic** that could corrupt `utils.js` on re-patching
  - Changed from `parts[2]` to `parts[parts.length - 1]` to handle variable marker counts
- **Added injection point validation** to prevent silent failures when Antigravity updates
  - Searches 3 `loadURL` pattern variants
  - Throws clear error message with searched patterns if all fail
- **Added post-patch verification step** that automatically rolls back on integrity failures
  - Extracts and validates repacked `app.asar`
  - Verifies injection marker, bundle, and aggregator presence
  - Reverts to `app.asar.backup` if verification fails

#### Resource Management
- **Fixed WebSocket leak in watch mode** (`inject:watch`)
  - Added `ws.close()` in `onerror` handler
  - Prevents file descriptor exhaustion during connection failures

#### Runtime Stability
- **Fixed DOM race condition** in Settings modal injection
  - Added `parent.contains(modelsBtn)` verification before and after button creation
  - Returns early with warning on React re-render detection

### ✨ New Features

#### Self-Diagnostic System
- **Added Antigravity data directory self-check**
  - Validates `~/.gemini/antigravity/` existence
  - Checks for at least one data source (conversations or brain)
  - Returns empty stats with friendly error messages instead of crashing
- **Added Antigravity version logging** in patch script
  - Reads target `package.json` and logs product name + version
  - Aids compatibility debugging

#### Data Freshness Monitoring
- **Added stale data detection** in Stats UI
  - Checks if `window.__ANTIGRAVITY_STATS__` is older than 10 minutes
  - Logs warning with data age and suggests re-injection
  - Gracefully degrades (still displays stale data)

#### Developer Experience
- **Added CSS version tagging** (`data-version="1.0.1"`)
  - Logs replaced style version in console
  - Simplifies multi-version debugging
- **Improved error filtering** in aggregate script
  - Distinguishes temporary SQLite locks from real errors
  - Logs non-recoverable errors with full details

### 🧪 Testing

- **Added comprehensive test suite** (`npm test`)
  - 15 automated regression tests
  - Validates all bug fixes and new features
  - Runs in <2 seconds
- **Added test report generation** (`BUGFIX_REPORT.md`)
  - Complete technical documentation of all fixes
  - Validation evidence and test results
  - Risk assessment and deployment checklist

### 📝 Documentation

- **Updated CLAUDE.md** with fix context
- **Created BUGFIX_REPORT.md** with technical analysis
- **Added test-all.cjs** for CI/CD integration

### 🔧 Developer Notes

**Modified Files**:
- `scripts/patch-antigravity.cjs` — Injection validation, verification, version logging
- `scripts/aggregate-stats.cjs` — 3-phase deduplication, self-checks, error filtering
- `scripts/inject-live.cjs` — WebSocket leak fix
- `src/standalone.tsx` — DOM race condition guards
- `src/services/stats-service.ts` — Data freshness detection
- `vite.bundle.config.ts` — CSS version tagging

**New Files**:
- `scripts/test-all.cjs` — Automated regression test suite
- `BUGFIX_REPORT.md` — Technical fix documentation
- `CHANGELOG.md` — This file

**Total Changes**: +212 lines, -65 lines across 6 files

---

## [1.0.0] - 2026-09-06

### 🎉 Initial Release

- Desktop injection plugin for Antigravity 2.0
- Token usage metrics and activity heatmaps
- React 19 + TypeScript + Tailwind CSS UI
- SQLite + JSONL transcript aggregation
- Live injection via Chrome DevTools Protocol
- Patch/unpatch with automatic backup
- 39-week GitHub-style activity calendar
- KPI cards, insights, and distribution breakdown
