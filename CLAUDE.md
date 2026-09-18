# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A token-usage stats dashboard for **Google Antigravity 2.0** (Electron desktop agent IDE), Windows-first. React 19 + TypeScript + Tailwind 3, injected non-invasively into the client's Settings → Usage Stats view (also reachable via `Alt+T` shortcut or toast click). All metrics are 100% ground truth parsed from the client's own SQLite databases and Protobuf blobs — **never estimate tokens from character/byte counts** (e.g. `chars / 3.5` is a banned pattern that was fully removed once already).

Read `CONTEXT.md` for the domain glossary (TokenMetric, TaskSummary, HeatmapCell, etc.) and `HANDOVER.md` for the full bilingual handover doc covering Antigravity internals and data paths.

## Commands

```bash
npm run dev             # Vite browser preview at http://localhost:5173
npm run build           # tsc -b + web build (dist/)
npm run build:bundle    # Single-file IIFE injection bundle (dist-bundle/antigravity-stats-bundle.js)

npm test                # Regression suite (test-all.cjs + test-persistent-cache.cjs)
npm run test:integration
npm run test:realtime   # Writes into the REAL conversation directory — check side effects first
node scripts/test-integration.cjs "--filter=Live CDP hot injection"  # Focused live test;
                        # pass the filter directly to node — npm mangles args through PowerShell

npm run aggregate       # Run the data aggregation and print key metrics
npm run benchmark       # Measure aggregation overhead

# Desktop injection (use only on a development Antigravity install)
npm run launch          # Start Antigravity and hot-inject
npm run inject:live     # Hot-inject into a running client (~1s, no restart)
npm run inject:watch    # Watch mode: auto reinject on bundle rebuild
npm run unpatch         # Roll back a historical ASAR patch (~1s)
npm run setup:shortcut  # Create the "Antigravity (with Stats)" desktop shortcut
```

UI iteration loop: `npm run build:bundle` → `npm run launch` or `npm run inject:live` (`inject:watch` for auto-reinject).

## Architecture

**Two build targets from one UI codebase:**
- `src/main.tsx` + `App.tsx` → web preview build (`vite.config.ts` → `dist/`), for browser-only development.
- `src/standalone.tsx` → injection bundle (`vite.bundle.config.ts` → `dist-bundle/`), an IIFE with **all CSS inlined** by the custom `inlineCssPlugin` (styles injected as `<style id="antigravity-stats-styles">`). The bundle must be fully self-contained: zero external HTTP requests, icons are inline SVG.

**Data flow (ground truth pipeline):**
1. `scripts/aggregate-stats.cjs` (Node, ~780 lines) reads `%USERPROFILE%\.gemini\antigravity\conversations\*.db` — SQLite table `gen_metadata` holds Protobuf-serialized Gemini API usage metrics. It decodes these BLOBs with a hand-written zero-dependency varint/protobuf decoder (see `HANDOVER.md` §2.2 for the wire format), cross-references `brain/<id>/.system_generated/logs/transcript.jsonl` event logs, and merges per-session. Uses `mtimeMs`-keyed caches for <5ms incremental rescans. Read-only access only.
2. The aggregate is exposed to the renderer as `window.__ANTIGRAVITY_STATS__`; `window.__ANTIGRAVITY_REQUEST_SYNC__()` triggers a resync.
3. React UI consumes `AggregatedStats` (typed in `src/domain/stats.types.ts`) via `src/services/stats-service.ts`. Components live in `src/components/stats/` (`StatsView.tsx` is the dashboard entry; heatmap, KPI banner, token breakdown, insights cards). i18n in `src/i18n/`.

**Injection layer (`scripts/inject-live.cjs`):** reads the CDP port from `%AppData%\Roaming\Antigravity\DevToolsActivePort`, connects over WebSocket to the Electron renderer, cleans up prior injection state (MutationObservers, React roots, DOM nodes) to avoid leaks/ghost DOM, then evaluates the bundle. `unpatch-antigravity.cjs` remains only for rolling back a historical ASAR patch — prefer CDP hot injection during development.

## Critical Rules

- **Ground truth only.** Any new metric must come from SQLite `gen_metadata` Protobuf or transcript events — never from text-size heuristics.
- **DOM race safety in `src/standalone.tsx`.** The Settings modal re-renders/unmounts as the user switches tabs; always re-verify DOM anchors with `parent.contains(anchor)` before and after async inserts.
- **Close CDP WebSockets** when scripts finish; leaked connections exhaust file descriptors on Windows.
- **Desktop verification standard:** a successful browser preview or bundle build does NOT prove injection works. Success = the Stats view actually renders in the desktop client, survives startup navigation, on both cold start and repeat launch, and appears under Settings → Usage Stats. If the client is unavailable, report desktop verification as incomplete — do not claim a verified fix from browser-only tests.
- **Never commit** transcripts, SQLite databases, `app.asar` backups, or machine-specific paths.
- Tests are plain Node assertion scripts in `scripts/test-*.cjs` — add focused checks there, no test framework. Changes to aggregation logic should also run the relevant integration/realtime suite.
- No Git repo: use imperative scoped messages (e.g. `fix: prefer transcript token totals`).
- Style: two-space indent, PascalCase components/types, camelCase functions. Keep Tailwind classes consistent with Antigravity's native CSS variables (`--background`, `--foreground`, `--card`, `.dark`).
