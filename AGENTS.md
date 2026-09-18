# Repository Guidelines

## Project Structure & Module Organization

This Windows-first React 19 + TypeScript app lives mainly in `src/`: UI components, domain types, localization, and data services. Node operational scripts and tests are in `scripts/`; Vite outputs go to `dist/` and `dist-bundle/`. Read `CONTEXT.md` and `CLAUDE.md` for domain details.

## Build, Test, and Development Commands

- `npm run dev` starts the Vite development server at `http://localhost:5173`.
- `npm run build` runs TypeScript project checks and the production web build.
- `npm run build:bundle` creates `dist-bundle/antigravity-stats-bundle.js` for desktop injection.
- `npm test` runs `scripts/test-all.cjs` and `scripts/test-persistent-cache.cjs`.
- `npm run test:integration` and `npm run test:realtime` exercise integration and live-sync behavior.
- `npm run aggregate` prints metrics; `npm run benchmark` measures aggregation overhead.
- `npm run unpatch` only rolls back a historical ASAR patch; development uses `npm run inject:live` or `npm run launch`.
- For UI iteration, run `npm run build:bundle`, then `npm run launch` or `npm run inject:live`; use `npm run inject:watch` for automatic reinjection.

## Coding Style & Naming Conventions

Use two spaces. Use `PascalCase` for React components and types, `camelCase` for functions and variables, and existing directory naming. Keep Tailwind classes and Antigravity CSS variables consistent. Run `npm run build` before submitting.

## Testing Guidelines

Tests are lightweight Node assertion scripts. Add focused checks in `scripts/test-*.cjs`, name cases descriptively, and run `npm test`; aggregation changes should also run the relevant realtime or integration command.

## Commit & Pull Request Guidelines

Use imperative scoped messages such as `fix: prefer transcript token totals`. PRs should describe behavior, list validation, include UI screenshots, and mention patch or rollback impact.

## Security & Configuration Tips

Aggregation reads `%USERPROFILE%\\.gemini\\antigravity\\` read-only. Never commit transcripts, SQLite databases, `app.asar` backups, or machine-specific paths. Use `npm run unpatch` only to roll back an explicitly authorized ASAR patch; CDP testing does not require it.

## Antigravity Debugging

Session databases are under `%USERPROFILE%\\.gemini\\antigravity\\conversations`; transcripts are under `brain/<id>/.system_generated/logs`. Open Electron DevTools with `Ctrl+Shift+I` or `F12`, then filter `[TokenStats]` or `[CDP]`. Useful checks: `window.__ANTIGRAVITY_REQUEST_SYNC__()` and `window.__ANTIGRAVITY_STATS__`.

Prefer CDP hot injection: it reads `DevToolsActivePort` and avoids ASAR repacking. `npm run unpatch` rolls back a historical ASAR patch. Metrics must come from SQLite `gen_metadata` or transcripts, never character/byte heuristics. Keep the bundle self-contained with inlined CSS, close CDP WebSockets, and recheck DOM anchors in `src/standalone.tsx` after async renders.

## Desktop Injection Acceptance

- Frontend, bundle, or launcher changes must also verify the desktop `Antigravity (with Stats)` entry point. A successful Vite preview or bundle build alone does not prove injection works.
- A reachable CDP port or an initial page target is not application readiness. Wait for the loaded main UI before injecting; navigation can destroy an early injection.
- Report injection success only after the requested Stats view actually renders. Check that it survives startup navigation, and verify both cold startup and repeat launch, plus Settings -> Usage Stats.
- Reuse the desktop shortcut's actual Node executable, arguments, and working directory when reproducing launcher failures. Do not replace a valid shortcut to mask an injection bug.
- Use `node scripts/test-integration.cjs "--filter=Live CDP hot injection"` for focused live verification; pass the filter directly to Node to avoid PowerShell/npm argument forwarding differences. Inspect test side effects before running the full suite: it also invokes `unpatch`; realtime tests write into the real conversation directory.
- Keep CDP connections bounded and closed. If the client is unavailable or restarting it could interrupt user work, report desktop verification as incomplete and request the specific access needed; do not claim a verified desktop fix from browser-only tests.
