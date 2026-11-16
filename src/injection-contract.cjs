/**
 * Injection contract between the injector and the injected UI:
 * - desktop today: loader.cjs running in the patched Electron main process
 *   (installed via patch-antigravity.cjs)
 * - future hosts (e.g. Antigravity IDE): their own injector reproducing this contract
 * - injected UI: the standalone bundle plus the shared stats components in src/
 *
 * Every marker, window global, IPC channel, event name and DOM id that crosses the
 * injector/UI boundary is defined here exactly once. Consumed from .cjs scripts via
 * require() and from TS via the adjacent injection-contract.d.cts declarations.
 */

module.exports = {
  // ASAR patch markers; presence of these strings is how patch state is detected.
  MARKER_MAIN_HOOK: '__ANTIGRAVITY_STATS_INJECTION__',
  MARKER_PRELOAD_BRIDGE: '__ANTIGRAVITY_STATS_PRELOAD_BRIDGE__',

  // window globals the injector sets up in the renderer. All are valid JS identifiers,
  // so generated code can interpolate them as window.${...}.
  WINDOW_STATS: '__ANTIGRAVITY_STATS__',
  WINDOW_REQUEST_SYNC: '__ANTIGRAVITY_REQUEST_SYNC__',
  WINDOW_SYNC_BRIDGE: '__ANTIGRAVITY_SYNC_BRIDGE__',
  WINDOW_LIVE_QUOTA: '__ANTIGRAVITY_LIVE_QUOTA__',
  WINDOW_API: 'AntigravityStats',

  // IPC channel (preload bridge) and the renderer-side CustomEvent mirroring it.
  // Intentionally the same string: the renderer can also request a sync without the bridge.
  IPC_REQUEST_SYNC: 'antigravity:request-sync',
  EVENT_REQUEST_SYNC: 'antigravity:request-sync',

  EVENT_STATS_UPDATED: 'antigravity:stats-updated',
  EVENT_QUOTA_UPDATED: 'antigravity:quota-updated',
  EVENT_LANGUAGE_CHANGED: 'antigravity:language-changed',

  // Native IDE host: restricted to its workbench main frame by the loader.
  MARKER_IDE_MAIN_HOOK: '__ANTIGRAVITY_IDE_STATS_INJECTION__',
  IPC_IDE_SYNC: 'vscode:antigravity-stats:ide-sync',
  WINDOW_IDE_STATE: '__ANTIGRAVITY_IDE_STATE__',
  WINDOW_IDE_ROUTE: '__ANTIGRAVITY_IDE_ACTIVE_ROUTE__',
  IDE_NATIVE_CHAT_RPC: {
    iframeId: 'jetski-frame',
    channel: 'agy-ext-extension-api',
    source: 'antigravity-iframe',
    path: '/gemini_coder.agent_ui_toolkit.iframe.ExtensionApi/OnDidChangeUrl',
  },
  CONTAINER_IDE_STATUSBAR_ID: 'antigravity-ide-stats-statusbar',
  CONTAINER_IDE_POPOVER_ID: 'antigravity-ide-stats-popover',

  // Optional Chinese translation pack: an independently injected IIFE that sets
  // window[WINDOW_ZH_PACK] before the main bundle runs (loader.cjs / installer).
  // Missing pack = English-only UI; see LanguageContext and antigravity-ui-i18n.
  WINDOW_ZH_PACK: '__ANTIGRAVITY_ZH_PACK__',
  ZH_PACK_FILE: 'antigravity-stats-zh-pack.js',

  // Feature flags the injector hands to the bundle. The loader always sets this
  // global (from contract.json's features), so npm dev and IDE hosts are unaffected;
  // a missing global means "all features on".
  WINDOW_STATS_FEATURES: '__ANTIGRAVITY_STATS_FEATURES__',

  // Single source for every contract.json features payload. Installing without
  // --no-status-bar keeps the status-bar widget on.
  FEATURES: { statusBar: true },

  // <style> element the bundle build inlines its CSS into.
  STYLE_ELEMENT_ID: 'antigravity-stats-styles',

  // Status bar & popover container IDs
  CONTAINER_STATUSBAR_ID: 'antigravity-dsh-statusbar-container',
  CONTAINER_POPOVER_ID: 'antigravity-dsh-popover-container',
};
