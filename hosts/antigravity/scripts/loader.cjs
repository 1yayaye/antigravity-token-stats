/**
 * Antigravity Token Stats — Main Process Scheduler & Lifecycle Loader
 * Injected into Antigravity Electron main process via dist/main.js
 */

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { getDevBundlePathFile } = require('./paths.cjs');

let electron;
try {
  electron = require('electron');
} catch (e) {
  electron = null;
}

// Runs flat inside the patched asar (dist/antigravity-stats/) and from the repo
// checkout (hosts/antigravity/scripts -> scripts/ and src/), so try both layouts.
function loadModuleRelative(candidates) {
  for (const p of candidates) {
    try {
      return require(p);
    } catch (e) {}
  }
  throw new Error(`None of these modules could be loaded: ${candidates.join(', ')}`);
}

// The contract is required to hook anything; the aggregation engine degrades to
// null so the UI/i18n bundle still injects when it is missing, and the null
// guards below keep the rest of the loader inert.
let aggregate = null;
try {
  let devCandidates = [];
  try {
    const redirectFile = getDevBundlePathFile();
    if (fs.existsSync(redirectFile)) {
      const devPath = fs.readFileSync(redirectFile, 'utf8').trim();
      if (devPath) {
        devCandidates.push(path.resolve(path.dirname(devPath), '..', 'scripts', 'aggregate-stats.cjs'));
        devCandidates.push(path.resolve(path.dirname(devPath), 'aggregate-stats.cjs'));
      }
    }
  } catch (e) {}

  aggregate = loadModuleRelative([...devCandidates, './aggregate-stats.cjs', '../../../scripts/aggregate-stats.cjs']);
} catch (e) {
  console.warn('[TokenStats Loader] aggregate-stats.cjs unavailable, stats aggregation disabled:', e.message);
}
const computeStats = aggregate?.computeStats ?? null;
const readSingleSession = aggregate?.readSingleSession ?? null;
const contract = loadModuleRelative(['./injection-contract.cjs', '../../../src/injection-contract.cjs']);

const { app, BrowserWindow, webContents, ipcMain } = electron || {};

let lastStats = null;
let debounceTimer = null;
let retryBusyTimer = null;
let pushInFlight = false;
let pendingAfterFlight = false;
let pendingReason = null;
let watchers = [];
let lastFullScanAt = 0;
const FULL_SCAN_MIN_GAP_MS = 2000;
const pendingSessionIds = new Set();
let sessionTimer = null;
const hookedWindows = new WeakSet();
// Keep on-demand historical sessions across full-scan broadcasts so viewing a >24h
// idle conversation does not flicker to zero whenever computeStats trims sessions.
const pinnedSessionIds = new Set();
const MAX_PINNED_SESSIONS = 8;

function pinSessionId(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') return;
  if (pinnedSessionIds.has(sessionId)) {
    pinnedSessionIds.delete(sessionId);
  }
  pinnedSessionIds.add(sessionId);
  while (pinnedSessionIds.size > MAX_PINNED_SESSIONS) {
    const oldest = pinnedSessionIds.values().next().value;
    pinnedSessionIds.delete(oldest);
  }
}

function attachPinnedSessions(stats) {
  if (!stats || typeof stats !== 'object' || pinnedSessionIds.size === 0) return;
  if (!stats.sessions) stats.sessions = {};
  for (const sId of Array.from(pinnedSessionIds)) {
    if (stats.sessions[sId]) continue;
    let summary = null;
    if (readSingleSession) {
      try {
        summary = readSingleSession(sId);
      } catch (e) {}
    }
    if (!summary && lastStats && lastStats.sessions && lastStats.sessions[sId]) {
      summary = lastStats.sessions[sId];
    }
    if (summary) {
      stats.sessions[sId] = summary;
    } else {
      pinnedSessionIds.delete(sId);
    }
  }
}

// Bundle injection re-runs on every window load and navigation; the ~300KB source is
// cached keyed by file identity so repeats serve from memory while a rebuilt bundle
// (dev-bundle.path redirect) still invalidates through its mtime/size change.
let bundleCodeCache = null; // { path, mtimeMs, size, code }

function resolveBundleCandidatePaths() {
  const candidates = [];
  try {
    const redirectFile = getDevBundlePathFile();
    if (fs.existsSync(redirectFile)) {
      const devPath = fs.readFileSync(redirectFile, 'utf8').trim();
      if (devPath && fs.existsSync(devPath)) candidates.push(devPath);
    }
  } catch (e) {}
  candidates.push(path.join(__dirname, 'antigravity-stats-bundle.js'));
  return candidates;
}

function getBundleCode() {
  for (const bundlePath of resolveBundleCandidatePaths()) {
    try {
      const stat = fs.statSync(bundlePath);
      const cached = bundleCodeCache;
      if (cached && cached.path === bundlePath && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        return cached.code;
      }
      const code = fs.readFileSync(bundlePath, 'utf8');
      if (!code || code.length <= 50) continue;
      bundleCodeCache = { path: bundlePath, mtimeMs: stat.mtimeMs, size: stat.size, code };
      return code;
    } catch (e) {}
  }
  return null;
}

function resolveWebContents(target) {
  if (!target || typeof target !== 'object') return null;
  if (typeof target.isDestroyed === 'function' && target.isDestroyed()) return null;
  // Antigravity 2.31.2+ hosts the Hub UI in a WebContentsView inside BaseWindow,
  // while older builds used BrowserWindow. Accept either WebContents or BrowserWindow.
  const wc = typeof target.getURL === 'function' ? target : target.webContents;
  if (!wc || (typeof wc.isDestroyed === 'function' && wc.isDestroyed())) return null;
  if (typeof wc.getURL !== 'function') return null;
  return wc;
}

function isAntigravityMainWindow(target) {
  const wc = resolveWebContents(target);
  if (!wc) return false;
  if (typeof wc.getType === 'function' && wc.getType() === 'webview') return false;
  const url = wc.getURL() || '';
  return url.startsWith('https://127.0.0.1:') || url.startsWith('http://127.0.0.1:') ||
         url.startsWith('https://localhost:') || url.startsWith('http://localhost:');
}

function getAllCandidateWebContents() {
  const seen = new Set();
  const list = [];
  if (webContents && typeof webContents.getAllWebContents === 'function') {
    for (const wc of webContents.getAllWebContents()) {
      const resolved = resolveWebContents(wc);
      if (resolved && !seen.has(resolved)) {
        seen.add(resolved);
        list.push(resolved);
      }
    }
  }
  if (BrowserWindow && typeof BrowserWindow.getAllWindows === 'function') {
    for (const win of BrowserWindow.getAllWindows()) {
      const resolved = resolveWebContents(win);
      if (resolved && !seen.has(resolved)) {
        seen.add(resolved);
        list.push(resolved);
      }
    }
  }
  return list;
}

async function injectStatsIntoWindow(target) {
  const wc = resolveWebContents(target);
  if (!wc || !isAntigravityMainWindow(wc)) return;
  try {
    const bundleCode = getBundleCode();
    if (!bundleCode) return;

    if (!lastStats && computeStats) {
      try {
        lastStats = computeStats(true);
      } catch (e) {
        console.error('[TokenStats Loader] Initial computeStats error:', e);
      }
    }

    const statsPayload = (lastStats && lastStats.kpis) ? JSON.stringify(lastStats) : 'null';
    const setupScript = `
      (() => {
        const stats = ${statsPayload};
        if (stats) {
          window.${contract.WINDOW_STATS} = stats;
        }
        window.${contract.WINDOW_REQUEST_SYNC} = (sessionId) => {
          if (window.${contract.WINDOW_SYNC_BRIDGE} && typeof window.${contract.WINDOW_SYNC_BRIDGE}.requestSync === 'function') {
            window.${contract.WINDOW_SYNC_BRIDGE}.requestSync(sessionId).catch(() => {});
          }
          window.dispatchEvent(new CustomEvent('${contract.EVENT_REQUEST_SYNC}', { detail: { sessionId } }));
        };
        return true;
      })()
    `;
    await wc.executeJavaScript(setupScript);
    await wc.executeJavaScript(bundleCode);

    const postScript = `
      (() => {
        if (window.${contract.WINDOW_STATS}) {
          window.dispatchEvent(new CustomEvent('${contract.EVENT_STATS_UPDATED}', { detail: window.${contract.WINDOW_STATS} }));
        }
        return true;
      })()
    `;
    await wc.executeJavaScript(postScript);
  } catch (err) {
    // Window may have navigated, reloaded, or closed
  }
}

function hookWindow(target) {
  const wc = resolveWebContents(target);
  if (!wc || hookedWindows.has(wc)) return;
  if (typeof wc.getType === 'function' && wc.getType() === 'webview') return;
  hookedWindows.add(wc);

  if (typeof wc.on === 'function') {
    wc.on('did-finish-load', () => {
      injectStatsIntoWindow(wc);
    });

    if (isAntigravityMainWindow(wc) && typeof wc.isLoading === 'function' && !wc.isLoading()) {
      injectStatsIntoWindow(wc);
    }
  }
}

function broadcastStats(stats) {
  if (!stats || !stats.kpis) return;
  attachPinnedSessions(stats);
  lastStats = stats;
  const script = `
    (() => {
      const nextStats = ${JSON.stringify(stats)};
      const prevSessions = window.${contract.WINDOW_STATS} && window.${contract.WINDOW_STATS}.sessions;
      const match = typeof window !== 'undefined' && window.location && window.location.pathname
        ? window.location.pathname.match(/\\/c\\/([a-zA-Z0-9_-]+)/)
        : null;
      const activeId = match ? match[1] : null;
      if (activeId && prevSessions && prevSessions[activeId] && (!nextStats.sessions || !nextStats.sessions[activeId])) {
        if (!nextStats.sessions) nextStats.sessions = {};
        nextStats.sessions[activeId] = prevSessions[activeId];
      }
      window.${contract.WINDOW_STATS} = nextStats;
      window.dispatchEvent(new CustomEvent('${contract.EVENT_STATS_UPDATED}', { detail: window.${contract.WINDOW_STATS} }));
      return true;
    })()
  `;
  for (const wc of getAllCandidateWebContents()) {
    if (isAntigravityMainWindow(wc)) {
      try {
        wc.executeJavaScript(script).catch(() => {});
      } catch (e) {}
    }
  }
}

function broadcastSessionUpdate(sessionId, sessionData) {
  if (!sessionId || !sessionData) return;
  const script = `
    (() => {
      if (!window.${contract.WINDOW_STATS}) window.${contract.WINDOW_STATS} = { sessions: {} };
      if (!window.${contract.WINDOW_STATS}.sessions) window.${contract.WINDOW_STATS}.sessions = {};
      window.${contract.WINDOW_STATS}.sessions[${JSON.stringify(sessionId)}] = ${JSON.stringify(sessionData)};
      window.dispatchEvent(new CustomEvent('${contract.EVENT_STATS_UPDATED}', { detail: window.${contract.WINDOW_STATS} }));
      return true;
    })()
  `;
  for (const wc of getAllCandidateWebContents()) {
    if (isAntigravityMainWindow(wc)) {
      try {
        wc.executeJavaScript(script).catch(() => {});
      } catch (e) {}
    }
  }
}

// Single-session reads are cheap (~25ms); the full 400+ DB rescan is not, so a running task must
// never trigger one per model call. Full scans are throttled, the pill is fed by pushSessionUpdate.
function pushSessionUpdate(sessionId) {
  if (!readSingleSession) return;
  try {
    const single = readSingleSession(sessionId);
    if (!single) return;
    pinSessionId(sessionId);
    if (!lastStats) lastStats = { kpis: {}, sessions: {} };
    if (!lastStats.sessions) lastStats.sessions = {};
    lastStats.sessions[sessionId] = single;
    broadcastSessionUpdate(sessionId, single);
  } catch (e) {}
}

function scheduleSessionPush(sessionId) {
  pendingSessionIds.add(sessionId);
  if (sessionTimer) return;
  sessionTimer = setTimeout(() => {
    sessionTimer = null;
    const ids = Array.from(pendingSessionIds);
    pendingSessionIds.clear();
    ids.forEach(pushSessionUpdate);
  }, 150);
}

function schedulePush(reason) {
  pendingReason = pendingReason || reason;
  if (pushInFlight) pendingAfterFlight = true;
  if (debounceTimer) return;
  const sinceLastScan = Date.now() - lastFullScanAt;
  debounceTimer = setTimeout(() => flush('debounce'), Math.max(400, FULL_SCAN_MIN_GAP_MS - sinceLastScan));
}

function flush(trigger = 'scheduled') {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (!pendingReason && !pendingAfterFlight && trigger !== 'ipc-request' && trigger !== 'flush' && trigger !== 'init') return;
  if (pushInFlight) {
    pendingAfterFlight = true;
    return;
  }

  const reason = pendingReason || trigger;
  pendingReason = null;
  pendingAfterFlight = false;
  pushInFlight = true;

  try {
    if (!computeStats) return;
    const freshStats = computeStats(true);
    lastFullScanAt = Date.now();
    if (freshStats && freshStats.kpis) {
      lastStats = freshStats;
      broadcastStats(freshStats);

      if (freshStats.meta?.hasStaleSessions) {
        if (retryBusyTimer) clearTimeout(retryBusyTimer);
        retryBusyTimer = setTimeout(() => {
          retryBusyTimer = null;
          schedulePush('retry-after-busy');
        }, 2500);
      } else if (retryBusyTimer) {
        clearTimeout(retryBusyTimer);
        retryBusyTimer = null;
      }
    }
  } catch (err) {
    console.error('[TokenStats Loader] computeStats error:', err);
  } finally {
    pushInFlight = false;
    if (pendingAfterFlight || pendingReason) {
      pendingAfterFlight = false;
      flush('after-flight');
    }
  }
}

function setupWatchers() {
  for (const w of watchers) {
    try { w.close(); } catch (e) {}
  }
  watchers = [];

  const agDir = process.env.ANTIGRAVITY_DATA_DIR || path.join(os.homedir(), '.gemini', 'antigravity');
  const convDir = path.join(agDir, 'conversations');
  const brainDir = path.join(agDir, 'brain');

  if (fs.existsSync(convDir)) {
    try {
      const convWatcher = fs.watch(convDir, (eventType, filename) => {
        if (!filename || filename.endsWith('.db') || filename.endsWith('.db-wal') || filename.endsWith('.db-shm')) {
          // The changed file names the session, so the pill updates within ~150ms of every
          // completed model call instead of waiting for the throttled full rescan.
          const match = /^(.+?)\.db(?:-(?:wal|shm))?$/.exec(filename || '');
          if (match) scheduleSessionPush(match[1]);
          schedulePush(`conv:${filename || eventType}`);
        }
      });
      watchers.push(convWatcher);
    } catch (e) {
      console.warn('[TokenStats Loader] Failed to watch conversations dir:', e.message);
    }
  }

  if (fs.existsSync(brainDir)) {
    try {
      const brainWatcher = fs.watch(brainDir, { recursive: true }, (eventType, filename) => {
        if (!filename || filename.includes('transcript.jsonl')) {
          schedulePush(`brain:${filename || eventType}`);
        }
      });
      watchers.push(brainWatcher);
    } catch (e) {}
  }
}

function init() {
  if (!ipcMain || !app) return;

  try {
    ipcMain.removeHandler(contract.IPC_REQUEST_SYNC);
  } catch (e) {}
  try {
    ipcMain.handle(contract.IPC_REQUEST_SYNC, async (_event, payload) => {
      const sessionId = payload?.sessionId || (typeof payload === 'string' ? payload : null);
      // Session-scoped requests keep their promise: one DB read, no full rescan. Only the
      // dashboard (no sessionId) needs the whole aggregate refreshed.
      if (sessionId) {
        pinSessionId(sessionId);
        pushSessionUpdate(sessionId);
        return { success: true };
      }
      flush('ipc-request');
      return { success: true };
    });
  } catch (e) {
    console.warn('[TokenStats Loader] ipcMain.handle error:', e);
  }

  app.on('web-contents-created', (_event, contents) => {
    hookWindow(contents);
  });

  app.on('browser-window-created', (_event, win) => {
    hookWindow(win);
  });

  if (typeof app.isReady === 'function' && app.isReady()) {
    getAllCandidateWebContents().forEach(hookWindow);
  } else if (typeof app.whenReady === 'function') {
    app.whenReady().then(() => {
      getAllCandidateWebContents().forEach(hookWindow);
    });
  }

  setupWatchers();
  schedulePush('init');
}

if (electron && electron.app) {
  init();
}

module.exports = {
  init,
  isAntigravityMainWindow,
  schedulePush,
  broadcastStats,
  broadcastSessionUpdate,
  pushSessionUpdate,
  getBundleCode,
  setupWatchers,
  flush,
  getDevBundlePathFile,
  injectStatsIntoWindow,
  hookWindow,
};
