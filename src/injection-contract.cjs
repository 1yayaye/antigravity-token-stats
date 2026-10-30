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
  EVENT_LANGUAGE_CHANGED: 'antigravity:language-changed',

  // <style> element the bundle build inlines its CSS into.
  STYLE_ELEMENT_ID: 'antigravity-stats-styles',

  // Status bar & popover container IDs
  CONTAINER_STATUSBAR_ID: 'antigravity-dsh-statusbar-container',
  CONTAINER_POPOVER_ID: 'antigravity-dsh-popover-container',
};
