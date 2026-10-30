# Antigravity Token Stats

Token usage dashboard for the Antigravity IDE (VSCode fork): a sidebar webview
backed by the shared aggregation engine (`scripts/aggregate-stats.cjs` in the
repository root). Reads `~/.gemini/antigravity-ide/` read-only and refreshes
automatically as session databases and transcripts change.

## Commands

- **Antigravity Stats: Refresh** — force a full rescan and push new stats.
