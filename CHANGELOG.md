# Changelog

All notable changes to Antigravity Token Stats will be documented in this file.

## [1.8.2] - 2026-11-17

### Added
- **Split-Pane Status Bar & Responsive Narrow-Pane Layout (`hosts/antigravity/src/standalone.tsx`, `hosts/antigravity/scripts/loader.cjs`, `src/components/statusbar/StatusBar.tsx`, `src/index.css`)**:
  - Upgraded `standalone.tsx` from a single status-bar root to a per-container `statusbarRoots` registry (`data-ag-statusbar="true"`), mounting independent `StatusBar` pills in every split-pane composer footer, pruning detached roots when panes close, throttling `requestDataSync` per session (`lastSyncRequestBySession`), and probing host pill styles per container.
  - Added `resolveSessionIdForContainer` to bind each split pane to its own `[data-cascade-id]` (avoiding inheriting the route URL session in empty `[data-pane-id]` panes when another pane already owns it), and scoped `checkGenerationState(container)` (including `button[data-testid="input-cancel-button"]`) to each pane/composer so streaming in one pane does not mark sibling panes as streaming.
  - Updated `loader.cjs` (`broadcastStats`) to retain session entries for every `[data-testid="conversation-view"][data-cascade-id]` visible in the renderer DOM across full-scan broadcasts.
  - Added `@container input-footer` responsive rules in `StatusBar.tsx` and `src/index.css`: at `max-width: 680px`, `.sb-pill-full-only` labels collapse to compact `tok/s` and cache `%` readouts; at `max-width: 560px`, secondary pills smoothly collapse so only the context ring remains visible without crowding the model picker.
- **Installer Upgrade State Sync & `--inspect-dir` CLI (`hosts/antigravity/installer/`)**:
  - Added `AsarPatcher.ReadStatusBarEnabled` (reading `dist/antigravity-stats/contract.json` `features.statusBar`, defaulting to `true` on legacy patches without `features`), `DesktopInstallInfo.StatusBarInstalled`, `EnvironmentDetector` population, and the `--inspect-dir <appOrResourcesDir>` CLI command outputting JSON component status.
  - Updated `MainForm.cs` with `SyncOptionalCheckboxesFromInstall()` to sync the **中文翻译包** and **状态栏小部件** checkboxes when selecting a patched directory or after install/uninstall (without overwriting user edits during pre-flight checks on the same directory), and added `小部件: 已启用/未启用` (`Widget: On/Off`) to `_lblInstallDetails`.

### Improved & Fixed
- **Regression & Integration Coverage (`scripts/test-audit-fixes.cjs`, `scripts/test-statusbar-components.cjs`, `scripts/test-optional-components.cjs`, `scripts/test-integration.cjs`)**:
  - Added split-pane status-bar isolation/pruning and `broadcastStats` multi-pane retention tests (`test-audit-fixes.cjs`), responsive compact/full pill span checks (`test-statusbar-components.cjs`), `ReadStatusBarEnabled`/`--inspect-dir`/`SyncOptionalCheckboxesFromInstall` assertions (`test-optional-components.cjs`), and end-to-end `--inspect-dir` lifecycle checks across unpatched, full-patch, opt-out re-patch, legacy `contract.json`, and unpatched states (`test-integration.cjs`).

### Release Notes (补充说明)
- **Scope**: Release asset `antigravity-token-stats-v1.8.2-setup.exe` targets **Antigravity Desktop only** (does not package or patch Antigravity IDE; IDE users continue using `npm run build:bundle:ide && npm run build:host:ide && npm run patch:ide`).
- **GUI Installer Behavior**: Fresh/unpatched installs still leave **本地进程代理**, **中文翻译包**, and **状态栏小部件** unchecked by default; when inspecting an already-patched directory, the GUI now syncs **中文翻译包** and **状态栏小部件** to reflect the currently installed state.

## [1.8.1] - 2026-11-16

### Added
- **Installer Optional Components: Chinese Translation Pack & Status Bar Widget (`hosts/antigravity/installer/`, `src/i18n/`, `hosts/antigravity/src/i18n/zh-pack.ts`)**:
  - Two new installer checkboxes, **中文翻译包** and **状态栏小部件**, both **unchecked by default** in the installer GUI (same opt-in pattern as the local process proxy); CLI routes (`npm run patch` and `AntiTokenSetup.exe --patch-dir`) keep everything **on by default** with `--no-zh-pack` / `--no-status-bar` opt-outs, preserving the GUI/CLI asymmetry established in v1.7.0.
  - The Chinese translation pack is built as an independent injection bundle (`dist-bundle/antigravity-stats-zh-pack.js`, contract `ZH_PACK_FILE` / `WINDOW_ZH_PACK`): the host UI dictionary and stats-panel zh strings are excluded from the main bundle. When absent, `LanguageContext` (`hasZhStatsSupport()`), `AntigravityUITranslator`, and `StatusBar` clamp the active UI language to pure English (even under `zh-CN`) and hide the language toggle.
  - `loader.cjs` executes the zh-pack before the main bundle when present and relays `contract.json` `features` through `window.__ANTIGRAVITY_STATS_FEATURES__`; `standalone.tsx` gates status-bar mounting on it (missing global = all features on).
  - `contract.json` generation (JS patcher, C# installer, `prepare-assets.cjs`) derives from `contract.FEATURES`; `AsarPatcher.cs` preserves existing `features` entries when toggling `statusBar`.
- **512K Model Context Limits & Extended Session Metrics (`aggregate-stats.cjs`, `telemetry-format.ts`, `hosts/antigravity/src/quota.ts`, `standalone.tsx`)**:
  - Added `resolveContextLimit` and `resolveModelContextLimit` with 512K baseline support for Gemini 4 Argon / Carbon / Hydrogen / Orchestrator / Worker models, live `modelContextLimits` extraction from `userStatus.cascadeModelConfigData.clientModelConfigs`, longest-prefix boundary matching, composer model pill detection before the first turn, and dynamic threshold labels in `ContextUsagePopover`.
  - Exposed `samplesCount` and `lastRequestTps` in `SessionSummary` and `extractSessionPerformanceMetrics`.
- **Antigravity IDE Native Workbench Integration (`hosts/antigravity-ide/`)**:
  - Replaced the VS Code sidebar extension (`hosts/antigravity-ide/extension/`, `ide-contract.ts`, `build:extension:ide`) with native workbench injection (`patch-ide.cjs`, `loader.cjs`, `build:host:ide`, `dev-ide.cjs`) rendering three bottom status-bar pills (`session`, `tokens`, `context`) with upward popovers (368px, `.monaco-workbench` portal, `Esc`/outside/blur dismissal), out-of-process `#jetski-frame` chat route tracking (including iframe remount rebinding), and Chromium `resolveProxy` system proxy inheritance for the Go backend.

### Improved & Fixed
- **Strict Quota Parsing & Dictionary-Driven Titles (`pricing-service.ts`, `QuotaHeroCard.tsx`, `translations.ts`)**:
  - `parseRawBucket` and `parseQuotaSummaryResponse` now reject missing, non-finite, out-of-range, wrong-type, or non-`remainingFraction` oneof quota readings instead of fabricating 100%, guard invalid `resetTime` values, and keep valid duplicate pool readings intact.
  - Replaced the remaining hardcoded `lang === 'zh'` quota card fallbacks in `QuotaHeroCard.tsx` with pure dictionary keys (`weeklyQuota`, `monthlyCapacityTitle`, `quotaRingsRegionLabel`).
- **CI & Regression Coverage (`.github/workflows/ci.yml`, `scripts/test-*.cjs`, `hosts/antigravity-ide/tests/`)**:
  - Updated CI to run `npm run build:host:ide`, added `scripts/test-optional-components.cjs` (including no-zh-pack `zh-CN` pure-English render checks), updated `test-i18n-engine.cjs` / `test-statusbar-components.cjs` / `test-context-widget.cjs` / `test-subscription-pricing.cjs` / `test-integration.cjs`, and added IDE test suites (`npm run test:ide`).

### Release Notes (补充说明)
- **Scope**: Release asset `antigravity-token-stats-v1.8.1-setup.exe` targets **Antigravity Desktop only** (does not package or patch Antigravity IDE; IDE users continue using `npm run build:bundle:ide && npm run build:host:ide && npm run patch:ide`).
- **GUI Installer Defaults**: In `AntiTokenSetup.exe` GUI, **本地进程代理 (Proxy)**, **中文翻译包 (Zh-pack)**, and **状态栏小部件 (Status Bar)** are all **unchecked by default** — check the ones you want before clicking **Install / Update Patch**. CLI installs (`npm run patch` / `AntiTokenSetup.exe --patch-dir`) keep all optional components enabled by default unless `--no-proxy`, `--no-zh-pack`, or `--no-status-bar` is passed.

## [1.8.0] - 2026-11-14

### Added
- **Multi-Pool Dual Radial Rings & Exact Model Pricing (`QuotaHeroCard.tsx`, `pricing-service.ts`, `aggregate-stats.cjs`)**:
  - Redesigned `QuotaHeroCard` into dual 60px gradient radial rings paired with pool-level capacity breakdowns across **Gemini**, **Claude & GPT**, and the new **Argon** pool (merged into Gemini automatically on Ultra tiers).
  - Updated `aggregate-stats.cjs` (`PERSIST_CACHE_VERSION = 11`) with exact per-model official API pricing (Gemini 4 Carbon/Argon/Hydrogen, Gemini 3.6–3.8 Flash, Gemini 3.1 Pro with 200K long-context tiering, Claude Opus/Sonnet 4.6 & 5.5, GPT-OSS 120B) and pool classification.
  - Aligned the 4-week ring progress denominator/numerator with `cappedMonthlyCostUsd` (excluding uncapped legacy pools from capacity %) while keeping full `monthlyCostUsd` for ROI valuation.
- **Automatic Account Tier Detection (`hosts/antigravity/src/quota.ts`, `hosts/antigravity-ide/extension/src/quota-service.ts`, `useQuotaMetrics.ts`)**:
  - Automatically detects Pro / Ultra / Free subscription tiers from `authService.getUserStatus` / `cloudCodeService.loadCodeAssist` on desktop and cached `userStatus` protobuf / `loadCodeAssist` on IDE, switching tier metrics without manual configuration.
- **Expanded Antigravity 2.0 UI Localization (`antigravity-ui-dict.ts`, `antigravity-ui-i18n.ts`)**:
  - Massively expanded the bilingual UI dictionary (+1,000 lines) for newer Antigravity settings, model selectors, and workspace panels.
  - Refactored `translateSubtreeInner` to hold `isTranslating` across the entire `handleMutations` batch and narrowed `hasRemovedText` re-translation to direct `TEXT_NODE` children.

### Improved & Fixed
- **Host Settings Tab Restoration (`hosts/antigravity/src/standalone.tsx`)**:
  - Fixed switching away from **Settings → Usage Stats** back to host tabs (`Models`, `Editor`, etc.) by restoring `style.display` on sibling panels inside `panelsContainer`, backed by a new DOM regression test in `scripts/test-audit-fixes.cjs`.
- **4-Channel Token Summary & Status Bar Polish (`TokenSummaryTile.tsx`, `StatusBar.tsx`, `ContextUsagePopover.tsx`, `src/index.css`)**:
  - Aligned the 4th composition channel to display net `Response` tokens as the primary metric and `Output` total in `subDetail`.
  - Added status-bar token count settle animation and context ring color/pulse thresholds (warning >= 70%, danger >= 85%), and standardized the context popover denominator fallback.
  - Cleaned up unused `.bento-card` CSS selectors and temporary scratch preview/probe files.

## [1.7.0] - 2026-11-13

### Reissued - 2026-11-13
- **Installer GUI Proxy Opt-In**: Local process proxy configuration is unchecked by default. Detecting a local or previously installed proxy does not enable it or override the user's selection. Leaving it unchecked skips proxy installation; it does not remove an existing proxy. CLI proxy defaults are unchanged; use `--no-proxy` to skip proxy installation there.
- **PR #1 Follow-Up**: The supported installation routes no longer depend on the retired PowerShell scripts, and the desktop loader supports `WebContentsView` / `BaseWindow` since v1.6.0. Thanks to [@Uziel660](https://github.com/Uziel660) for reporting these issues and proposing fixes in [PR #1](https://github.com/1yayaye/antigravity-token-stats/pull/1).
- **Same-Version Reissue**: The v1.7.0 installer asset is replaced without increasing the version. Existing v1.7.0 installations will not receive another update notification; download the revised installer manually if needed.

### Added
- **Desktop Update Checker (`update-checker.cjs`)**: Automatic, non-blocking check against GitHub Releases for Antigravity Desktop. Prompts users with native dialogs in Chinese or English to download updates when a newer release is published.
- **Unified Installer & Native Uninstallation Architecture**:
  - Removed all legacy root `.cmd` / `.ps1` scripts (`install.cmd`, `install.ps1`, `uninstall.cmd`, `uninstall.ps1`).
  - Standardized on a single `.exe` installer (`AntiTokenSetup.exe`) for end-users, featuring an integrated **"卸载 / 还原出厂" (Uninstall / Restore Factory)** button.
  - Standardized on pure npm commands for developers (`npm run setup`, `npm run launch`, `npm run unpatch`).
- **Isolated Live Quota Pipeline (`hosts/antigravity/src/quota.ts`, `src/components/stats/useQuotaMetrics.ts`)**:
  - Decoupled high-frequency quota telemetry polling from conversational database reads.
  - Implemented coalesced RPC fetching with TTL caching, error resilience, and independent state management.

### Improved & Fixed
- **Daily Trend Readability (`DailyTrendCard.tsx`)**: Enforced a minimum 7-day display window across all time filters for consistent visual density and trend clarity.
- **Session Cache & Persistence Optimization (`aggregate-stats.cjs`)**:
  - SQLite WAL-only invalidation avoids expensive full-table re-scans when conversations haven't changed.
  - Trimmed live broadcast payloads to active sessions while preserving historical metrics.
- **IDE Extension Security & Reliability**:
  - Added CSPRNG-generated nonces for webview Content Security Policy.
  - Added request timeout guards for OAuth token refreshes and quota RPC requests.
  - Enhanced session file watcher to properly capture `.db-wal` and `.db-shm` file updates.
- **Cleaned Vendor Binaries**: Removed tracked pre-compiled proxy binaries and templates from git history, keeping proxy distribution strictly through the root `vendor/` directory and `.gitignore`.

## [1.6.1] - 2026-11-12

### Fixed
- **Desktop CSS Isolation & Host Token Inheritance (`vite.bundle.config.ts`, `src/index.css`, `src/preview-theme.css`)**:
  - Moved `#root` / `#root.light` baseline CSS variables out of shared `src/index.css` into `src/preview-theme.css` (imported only in web preview and IDE webview), eliminating `#root` style hijacking on Antigravity Desktop.
  - Added PostCSS `isolateDesktopCss` in `vite.bundle.config.ts` for the desktop target: drops duplicate `@keyframes pulse` / `spin`, scopes all utility selectors to `:where(.antigravity-stats-container, .antigravity-statusbar-container)` inside `@layer components`, and moves `.stats-view` resets into `@layer base` so host `@layer utilities` always takes precedence.
  - Inherited host CSS tokens (`--primary`, `--secondary`, `--card-border`, `--border`, `--muted`, `--foreground`, `--font-mono`, and `font-sans: inherit`) across Bento cards, status-bar popovers, Settings nav item, and `ProxyStatusCard`.
  - Updated `StatsView` and desktop `MutationObserver` to watch `data-vscode-theme-kind` alongside `class`, `style`, and `data-theme`, and removed duplicate outer container theme wrappers in `standalone.tsx`.
- **Hot Re-Injection Listener & Timer Cleanup (`hosts/antigravity/src/standalone.tsx`)**:
  - Replaced single-shot `window.__ANTIGRAVITY_STATS_LISTENER__` boolean guard with replaceable handler references and shared `window.__ANTIGRAVITY_PILL_HEARTBEAT__` / `window.__ANTIGRAVITY_SCAN_TIMER__` cleanup on re-injection, preventing stale-closure `Minified React error #321` crashes in the status bar.
- **Verification (`scripts/test-theme.cjs`, `scripts/test-all.cjs`)**:
  - Added PostCSS guardrails verifying desktop bundle CSS has zero `#root` or unscoped selectors and keeps scoped utilities inside `@layer components`, plus hot re-injection cleanup assertions.

## [1.6.0] - 2026-11-12

### Added
- **Standalone Zero-Dependency Windows Installer (`AntiTokenSetup.exe`)**: Native C# WinForms (`.NET Framework 4.8`) single-file installer (`hosts/antigravity/installer/`) with embedded bundle, loader, contract, and proxy assets — no Node.js or ZIP extraction required.
  - Auto-detects Antigravity Desktop installations (running process, Windows Uninstall registry, standard paths) and UAC elevation needs.
  - Auto-detects local IPv4/IPv6 SOCKS5 & HTTP proxy ports with owning process identification and live `CONNECT` tunnel testing.
  - Supports full GUI wizard as well as headless CLI flags (`--patch-dir`, `--unpatch-dir`, `--verify-asar`, `--detect-proxies`, `--test-proxy`).
- **Compact `sessionRows` & Per-Session Spend (`aggregate-stats.cjs`)**: Tracks per-conversation token totals, USD cost, turns, calls, top model, and last-active timestamp while keeping `sessions` trimmed to running/24h/newest conversations for flat broadcast payloads.

### Fixed & Improved
- **Antigravity 2.31.2+ `WebContentsView` Support (`loader.cjs`)**: Injects cleanly into `WebContentsView` inside `BaseWindow` in addition to `BrowserWindow`, caches the bundle in memory keyed by file identity, and preserves pinned on-demand historical sessions (>24h) across full-scan broadcasts so the status bar never flickers to zero.
- **ASAR Backup & Rollback Hardening (`patch-antigravity.cjs`, `unpatch-antigravity.cjs`, `AsarPatcher.cs`)**:
  - Refreshes `app.asar.backup` only after source extraction, hook injection, repacking, and marker verification succeed — preventing a corrupted `app.asar` from overwriting a valid backup.
  - Prevents unpatch/restore from downgrading an already-unpatched newer official `app.asar` with an older backup.
  - Handles Windows `MAX_PATH` (>260 char) paths cleanly during `.unpacked` directory backups and restores.
- **Stream-Safe Proxy Tunnel Probe (`EnvironmentDetector.cs`)**: Properly handles fragmented SOCKS5 `CONNECT` replies and HTTP `CONNECT` status lines.
- **UI & Theme Polish**: Refined Bento tiles, glassmorphism popovers, status-bar pill tokens, memoized `LanguageContext` / tile components, and `test-heatmap.cjs` date anchoring.

## [1.5.0] - 2026-10-31

### Added
- **Modern Bento Grid Redesign**: Overhauled stats dashboard layout into an adaptive Bento Grid architecture:
  - **`QuotaHeroCard`**: Hero subscription card highlighting live ROI multiplier, net booked savings, and SVG circular progress rings for Gemini/Claude weekly quota and monthly volume. Remains hidden when online quota is unavailable to avoid phantom metrics.
  - **`TokenSummaryTile`**: Consolidated lifetime, input, output, and active day metrics paired with a 4-channel composition stacked bar (Cache Read, Raw Input, Thinking, Response).
  - **`DailyTrendCard`**: Interactive SVG daily trend area chart with dynamic nice-number gridlines responding to active time range filters (`today`, `1d`, `7d`, `30d`, `all`).
  - **`ProxyStatusCard`**: Compact proxy tile embedded directly within the Bento layout tracking Desktop & IDE socket redirection status.
- **Status Bar Probing & Bridge**:
  - `probeHostPillStyle`: Automatically samples surrounding Antigravity UI typography, font size, and accent tokens for seamless pixel-matching.
  - Transparent hover bridge (`POPOVER_BRIDGE_PX`) and hide timer delay (`POPOVER_HIDE_DELAY_MS`) preventing flicker when moving between status pills and popover cards.
  - Render memoization preventing redundant re-renders during high-frequency telemetry polling.
- **Protobuf Quota Compatibility**: `parseRawBucket` supports the updated `remaining: { case: 'remainingFraction', value }` protobuf schema from the latest Antigravity client release.

### Changed
- **Streamlined Host Integration**: Retired floating toast notification and global `Alt+T` overlay shortcut; unified access exclusively through native **Settings → Usage Stats** tab with clean lifecycle mounting and unmounting.
- **Verification Suites**: Updated unit tests, device acceptance, and CDP verification suites (`test-token-breakdown.cjs`, `test-subscription-pricing.cjs`, `run-device-acceptance.cjs`, `verify-real-device.cjs`) to validate Bento components and Settings navigation.

## [1.4.0] - 2026-10-31

### Added
- **Session Telemetry Status Bar & Popovers**: Three-pill status bar embedded alongside the chat footer showing user interaction rounds, steps, text-only TPS, total tokens consumed, cache hit rate, and context window occupancy with a 256K auto-compaction threshold marker.
- **Local Process Proxy**: Integrated local Winsock socket proxy forwarding (`version.dll`) routing Google API traffic through SOCKS5/HTTP while bypassing loopback TLS connections, manageable via `ProxyStatusCard` and `npm run proxy:*` CLI commands.
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
