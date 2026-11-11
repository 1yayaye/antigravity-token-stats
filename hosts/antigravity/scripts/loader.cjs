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

const { app, BrowserWindow, ipcMain } = electron || {};

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

function getBundleCode() {
  try {
    const redirectFile = getDevBundlePathFile();
    if (fs.existsSync(redirectFile)) {
      const devPath = fs.readFileSync(redirectFile, 'utf8').trim();
      if (devPath && fs.existsSync(devPath)) {
        const code = fs.readFileSync(devPath, 'utf8');
        if (code && code.length > 50) return code;
      }
    }
  } catch (e) {}

  const fallbackPath = path.join(__dirname, 'antigravity-stats-bundle.js');
  if (fs.existsSync(fallbackPath)) {
    try {
      const code = fs.readFileSync(fallbackPath, 'utf8');
      if (code && code.length > 50) return code;
    } catch (e) {}
  }
  return null;
}

function isAntigravityWebContents(wc) {
  if (!wc || (typeof wc.isDestroyed === 'function' && wc.isDestroyed())) return false;
  if (typeof wc.getURL !== 'function') return false;
  const url = wc.getURL() || '';
  return url.startsWith('https://127.0.0.1:') || url.startsWith('http://127.0.0.1:') ||
         url.startsWith('https://localhost:') || url.startsWith('http://localhost:');
}

function isAntigravityMainWindow(win) {
  if (!win || (typeof win.isDestroyed === 'function' && win.isDestroyed())) return false;
  return isAntigravityWebContents(win.webContents);
}

async function injectStatsIntoWebContents(wc) {
  if (!isAntigravityWebContents(wc)) return;
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

async function injectStatsIntoWindow(win) {
  if (win && win.webContents) {
    await injectStatsIntoWebContents(win.webContents);
  }
}

const hookedWebContents = new WeakSet();

function hookWebContents(wc) {
  if (!wc || (typeof wc.isDestroyed === 'function' && wc.isDestroyed()) || hookedWebContents.has(wc)) return;
  hookedWebContents.add(wc);

  if (typeof wc.on === 'function') {
    wc.on('did-finish-load', () => {
      injectStatsIntoWebContents(wc);
    });
    wc.on('did-navigate', () => {
      injectStatsIntoWebContents(wc);
    });
    wc.on('dom-ready', () => {
      injectStatsIntoWebContents(wc);
    });

    if (isAntigravityWebContents(wc) && typeof wc.isLoading === 'function' && !wc.isLoading()) {
      injectStatsIntoWebContents(wc);
    }
  }
}

function hookWindow(win) {
  if (!win || (typeof win.isDestroyed === 'function' && win.isDestroyed()) || hookedWindows.has(win)) return;
  hookedWindows.add(win);

  if (win.webContents) {
    hookWebContents(win.webContents);
  }
}

function getAllTargetWebContents() {
  const result = [];
  if (electron?.webContents && typeof electron.webContents.getAllWebContents === 'function') {
    for (const wc of electron.webContents.getAllWebContents()) {
      if (isAntigravityWebContents(wc)) result.push(wc);
    }
  } else if (BrowserWindow && typeof BrowserWindow.getAllWindows === 'function') {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win?.webContents && isAntigravityWebContents(win.webContents)) {
        result.push(win.webContents);
      }
    }
  }
  return result;
}

function broadcastStats(stats) {
  if (!stats || !stats.kpis) return;
  lastStats = stats;
  const targets = getAllTargetWebContents();
  for (const wc of targets) {
    try {
      const script = `
        (() => {
          window.${contract.WINDOW_STATS} = ${JSON.stringify(stats)};
          window.dispatchEvent(new CustomEvent('${contract.EVENT_STATS_UPDATED}', { detail: window.${contract.WINDOW_STATS} }));
          return true;
        })()
      `;
      wc.executeJavaScript(script).catch(() => {});
    } catch (e) {}
  }
}

function broadcastSessionUpdate(sessionId, sessionData) {
  if (!sessionId || !sessionData) return;
  const targets = getAllTargetWebContents();
  for (const wc of targets) {
    try {
      const script = `
        (() => {
          if (!window.${contract.WINDOW_STATS}) window.${contract.WINDOW_STATS} = { sessions: {} };
          if (!window.${contract.WINDOW_STATS}.sessions) window.${contract.WINDOW_STATS}.sessions = {};
          window.${contract.WINDOW_STATS}.sessions[${JSON.stringify(sessionId)}] = ${JSON.stringify(sessionData)};
          window.dispatchEvent(new CustomEvent('${contract.EVENT_STATS_UPDATED}', { detail: window.${contract.WINDOW_STATS} }));
          return true;
        })()
      `;
      wc.executeJavaScript(script).catch(() => {});
    } catch (e) {}
  }
}

// Single-session reads are cheap (~25ms); the full 400+ DB rescan is not, so a running task must
// never trigger one per model call. Full scans are throttled, the pill is fed by pushSessionUpdate.
function pushSessionUpdate(sessionId) {
  if (!readSingleSession) return;
  try {
    const single = readSingleSession(sessionId);
    if (!single) return;
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
        pushSessionUpdate(sessionId);
        return { success: true };
      }
      flush('ipc-request');
      return { success: true };
    });
  } catch (e) {
    console.warn('[TokenStats Loader] ipcMain.handle error:', e);
  }

  app.on('web-contents-created', (_event, wc) => {
    hookWebContents(wc);
  });

  app.on('browser-window-created', (_event, win) => {
    hookWindow(win);
  });

  const attachAll = () => {
    if (electron?.webContents && typeof electron.webContents.getAllWebContents === 'function') {
      electron.webContents.getAllWebContents().forEach(hookWebContents);
    }
    if (BrowserWindow && typeof BrowserWindow.getAllWindows === 'function') {
      BrowserWindow.getAllWindows().forEach(hookWindow);
    }
  };

  if (typeof app.isReady === 'function' && app.isReady()) {
    attachAll();
  } else if (typeof app.whenReady === 'function') {
    app.whenReady().then(attachAll);
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
  isAntigravityWebContents,
  schedulePush,
  broadcastStats,
  broadcastSessionUpdate,
  getBundleCode,
  setupWatchers,
  flush,
  getDevBundlePathFile,
  injectStatsIntoWindow,
  injectStatsIntoWebContents,
  hookWindow,
  hookWebContents,
};
