# Changelog

All notable changes to Antigravity Token Stats will be documented in this file.

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
