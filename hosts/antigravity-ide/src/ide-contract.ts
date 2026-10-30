/**
 * Extension <-> webview message contract for the Antigravity IDE stats view.
 * IDE-specific facts live here; the shared injection contract
 * (src/injection-contract.cjs) still owns the injector-agnostic facts the webview
 * consumes internally (window globals, stats-updated event name).
 * View/command ids must also appear in extension/package.json — JSON cannot
 * import this module, so the manifest carries the same literals by necessity.
 */
import type { AggregatedStats } from '../../../src/domain/stats.types';
import type { LiveQuotaSummary } from '../../../src/domain/pricing.types';

export const IDE_STATS_VIEW_ID = 'antigravity-ide-stats.view';
export const IDE_REFRESH_COMMAND = 'antigravity-ide-stats.refresh';
// Opens the Token Stats side bar (Alt+T, mirroring the desktop shortcut). The
// workbench container id is derived from the viewsContainers id in the manifest.
export const IDE_OPEN_STATS_COMMAND = 'antigravity-ide-stats.open';
export const IDE_PROXY_STATUS_COMMAND = 'antigravity-ide-stats.proxyStatus';
export const IDE_PROXY_INSTALL_COMMAND = 'antigravity-ide-stats.proxyInstall';
export const IDE_PROXY_UNINSTALL_COMMAND = 'antigravity-ide-stats.proxyUninstall';
export const IDE_WORKBENCH_VIEW_ID = 'workbench.view.extension.antigravity-ide-stats';

// Normalized theme kind pushed from the extension host: high-contrast themes
// are folded into dark/light before they cross the boundary.
export type ThemeKind = 'dark' | 'light';

export const EXT_TO_WEBVIEW = {
  STATS: 'antigravity-ide/stats',
  THEME: 'antigravity-ide/theme',
  QUOTA: 'antigravity-ide/quota',
} as const;

export const WEBVIEW_TO_EXT = {
  READY: 'antigravity-ide/ready',
  REQUEST_SYNC: 'antigravity-ide/request-sync',
} as const;

export type ExtensionToWebviewMessage =
  | { type: typeof EXT_TO_WEBVIEW.STATS; stats: AggregatedStats }
  | { type: typeof EXT_TO_WEBVIEW.THEME; themeKind: ThemeKind }
  // null means "no live quota available" (not logged in / endpoint error) and
  // hides the live quota card rather than showing stale numbers.
  | { type: typeof EXT_TO_WEBVIEW.QUOTA; quota: LiveQuotaSummary | null };

export type WebviewToExtensionMessage =
  | { type: typeof WEBVIEW_TO_EXT.READY }
  | { type: typeof WEBVIEW_TO_EXT.REQUEST_SYNC };
