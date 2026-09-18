const fs = require('fs');
const path = require('path');
const os = require('os');
const { computeStats } = require('./aggregate-stats.cjs');

function getAntigravityDir() {
  return process.env.ANTIGRAVITY_DATA_DIR || path.join(os.homedir(), '.gemini', 'antigravity');
}

function getDevToolsPortPath() {
  if (process.env.ANTIGRAVITY_DEVTOOLS_PATH) {
    return process.env.ANTIGRAVITY_DEVTOOLS_PATH;
  }

  const candidates = [
    path.join(os.homedir(), 'AppData', 'Roaming', 'Antigravity', 'DevToolsActivePort'),
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Antigravity', 'DevToolsActivePort') : null,
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.join(os.homedir(), 'AppData', 'Roaming', 'Antigravity', 'DevToolsActivePort');
}

async function getDevToolsPort() {
  if (process.env.ANTIGRAVITY_DEVTOOLS_PORT) {
    const p = parseInt(process.env.ANTIGRAVITY_DEVTOOLS_PORT, 10);
    if (!isNaN(p)) return p;
  }

  const devToolsPath = getDevToolsPortPath();
  if (!fs.existsSync(devToolsPath)) {
    throw new Error(
      `DevToolsActivePort not found at ${devToolsPath}.\n` +
      `Is Antigravity running with remote debugging enabled?\n` +
      `Tip: Run "npm run launch" to automatically start Antigravity with Token Stats.`
    );
  }
  const lines = fs.readFileSync(devToolsPath, 'utf8').trim().split(/\r?\n/);
  const port = parseInt(lines[0], 10);
  if (isNaN(port)) {
    throw new Error(`Invalid port in DevToolsActivePort (${devToolsPath}): ${lines[0]}`);
  }
  return port;
}

function isMainAppPage(p) {
  if (!p || p.type !== 'page') return false;
  if (!p.url || p.url.includes('devtools://') || p.url === 'about:blank') return false;
  if (p.url.startsWith('data:')) return false;
  return p.url.startsWith('http://') || p.url.startsWith('https://') || p.url.startsWith('file://');
}

async function inject(options = {}) {
  const silent = options.silent || false;
  const log = (...args) => { if (!silent) console.log(...args); };

  log('=== Starting Antigravity 2.0 CDP Hot Injection ===');
  const bundlePath = path.join(__dirname, '..', 'dist-bundle', 'antigravity-stats-bundle.js');
  if (!fs.existsSync(bundlePath)) {
    console.error('Bundle not found! Please run "npm run build:bundle" first.');
    process.exit(1);
  }

  const port = options.port || await getDevToolsPort();
  log(`[CDP] Detected Antigravity DevTools active on port: ${port}`);

  let pages;
  try {
    const pagesRes = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(3000) });
    if (!pagesRes.ok) throw new Error(`HTTP ${pagesRes.status} ${pagesRes.statusText}`);
    pages = await pagesRes.json();
  } catch (err) {
    throw new Error(
      `Could not connect to Antigravity DevTools on port ${port} (${err.message || 'connection failed'}).\n` +
      `The Antigravity process may have terminated or remote debugging is not ready.\n` +
      `Tip: Run "npm run launch" to automatically start Antigravity with Token Stats.`
    );
  }

  const mainPage = pages.find(isMainAppPage);

  if (!mainPage) {
    throw new Error('No active Antigravity page found to inject into.');
  }

  log(`[CDP] Target Window: "${mainPage.title}" (${mainPage.url})`);
  log('[Stats] Computing fresh token metrics from SQLite & transcripts...');
  const stats = computeStats();
  log(`[Stats] Cumulative tokens: ${stats.kpis.lifetimeTokens} (${stats.kpis.lifetimeTokensRaw.toLocaleString()}) | Peak: ${stats.kpis.peakTokens}`);

  const bundleCode = fs.readFileSync(bundlePath, 'utf8');

  return new Promise((resolve, reject) => {
    let connTimer = null;
    let isTerminated = false;
    const ws = new WebSocket(mainPage.webSocketDebuggerUrl);
    const safeClose = () => {
      if (isTerminated) return;
      isTerminated = true;
      try {
        if (ws.readyState === WebSocket.OPEN) ws.close();
      } catch (e) {}
    };
    connTimer = setTimeout(() => {
      safeClose();
      reject(new Error(`CDP connection to ${mainPage.webSocketDebuggerUrl} timed out`));
    }, 10000);
    
    ws.onopen = async () => {
      if (connTimer) clearTimeout(connTimer);
      log('[CDP] Connected via WebSocket. Injecting bundle & data...');

      let reqId = 100;
      const sendCDP = (method, params, timeoutMs = 15000) => new Promise((res, rej) => {
        const id = reqId++;
        let timer = null;
        const onMsg = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.id === id) {
              if (timer) clearTimeout(timer);
              ws.removeEventListener('message', onMsg);
              if (data.error) {
                rej(new Error(data.error.message));
              } else if (data.result && data.result.exceptionDetails) {
                const ex = data.result.exceptionDetails;
                rej(new Error(`CDP JS Exception: ${ex.exception?.description || ex.text}`));
              } else {
                res(data.result);
              }
            }
          } catch (e) {}
        };
        timer = setTimeout(() => {
          ws.removeEventListener('message', onMsg);
          rej(new Error(`CDP command ${method} (id ${id}) timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        ws.addEventListener('message', onMsg);
        ws.send(JSON.stringify({ id, method, params }));
      });

      try {
        // A CDP target exists before Electron finishes navigation to the app.
        const readyDeadline = Date.now() + 20000;
        let appReady = false;
        while (Date.now() < readyDeadline) {
          try {
            const readiness = await sendCDP('Runtime.evaluate', {
              expression: `document.readyState === 'complete' && !!document.querySelector('[aria-label="Sidebar"]')`,
              returnByValue: true,
            }, 2000);
            if (readiness?.result?.value === true) {
              appReady = true;
              break;
            }
          } catch {
            // Navigation can destroy the initial execution context while loading.
          }
          await new Promise(resolve => setTimeout(resolve, 250));
        }
        if (!appReady) throw new Error('Antigravity main UI did not become ready within 20s; injection was not applied.');

        // Step 1: Clean up previous instances and set fresh data & manual sync handler
        const cleanupScript = `
          (() => {
            if (window.__ANTIGRAVITY_OBSERVER__) {
              try { window.__ANTIGRAVITY_OBSERVER__.disconnect(); } catch (e) {}
              window.__ANTIGRAVITY_OBSERVER__ = null;
            }
            if (window.__ANTIGRAVITY_STATS_ROOT__) {
              try { window.__ANTIGRAVITY_STATS_ROOT__.unmount(); } catch (e) {}
              window.__ANTIGRAVITY_STATS_ROOT__ = null;
            }
            if (window.__ANTIGRAVITY_KEY_HANDLER__) {
              try { window.removeEventListener('keydown', window.__ANTIGRAVITY_KEY_HANDLER__); } catch (e) {}
              window.__ANTIGRAVITY_KEY_HANDLER__ = null;
            }
            document.querySelectorAll('#antigravity-stats-nav-btn, #antigravity-stats-sidebar-btn, #antigravity-stats-content, #antigravity-stats-settings-content, #antigravity-stats-modal-overlay, #antigravity-stats-toast').forEach(el => el.remove());
            window.__ANTIGRAVITY_STATS__ = ${JSON.stringify(stats)};
            window.__ANTIGRAVITY_REQUEST_SYNC__ = () => {
              if (typeof window.__ANTIGRAVITY_CDP_SYNC__ === 'function') {
                try { window.__ANTIGRAVITY_CDP_SYNC__('manual-refresh'); } catch (e) {}
              }
              window.dispatchEvent(new CustomEvent('antigravity:request-sync'));
            };
            return true;
          })()
        `;
        await sendCDP('Runtime.evaluate', { expression: cleanupScript, returnByValue: true });

        // Step 2: Evaluate fresh bundle code directly
        await sendCDP('Runtime.evaluate', { expression: bundleCode, returnByValue: false });

        // Step 3: Activate in open settings modal if present or open standalone modal, and show floating Toast
        const shouldOpenModal = Boolean(options.openModal);
        const activateRes = await sendCDP('Runtime.evaluate', {
          expression: `
            (async () => {
              window.focus();
              const modal = document.querySelector('.settings-modal-container');
              const btn = document.getElementById('antigravity-stats-nav-btn');
              if (modal && btn) {
                btn.click();
              } else if (${shouldOpenModal}) {
                if (window.AntigravityStats && typeof window.AntigravityStats.openModal === 'function') {
                  window.AntigravityStats.openModal();
                }
              }
              if (window.AntigravityStats && typeof window.AntigravityStats.showToast === 'function') {
                window.AntigravityStats.showToast('✦ Token Stats 已就绪');
              }
              if (!window.AntigravityStats) throw new Error('Token Stats bundle did not initialize.');
              if (${shouldOpenModal} || (modal && btn)) {
                const renderDeadline = Date.now() + 5000;
                let rendered = false;
                while (Date.now() < renderDeadline) {
                  const heading = document.querySelector('.stats-view h1');
                  if (heading && heading.getBoundingClientRect().height > 0) {
                    rendered = true;
                    break;
                  }
                  await new Promise(resolve => setTimeout(resolve, 50));
                }
                if (!rendered) throw new Error('Token Stats view did not render after injection.');
              }
              return {
                success: true,
                hasAntigravityStats: typeof window.AntigravityStats !== 'undefined',
                hasToast: !!document.getElementById('antigravity-stats-toast'),
                hasModal: !!document.getElementById('antigravity-stats-modal-overlay'),
                lifetimeTokens: window.__ANTIGRAVITY_STATS__?.kpis?.lifetimeTokens
              };
            })()
          `,
          returnByValue: true,
          awaitPromise: true
        });

        // Bring window to front
        try {
          await sendCDP('Page.bringToFront', {});
        } catch {}

        log('[CDP Result]', activateRes?.result?.value || activateRes?.result);
        log('\n======================================================');
        log('✓ SUCCESS: Token Stats hot-injected into Antigravity 2.0!');
        log('Toast notification active. Press Alt+T or click Settings -> Stats.');
        log('======================================================\n');
        safeClose();
        resolve(activateRes?.result?.value);
      } catch (err) {
        safeClose();
        reject(err);
      }
    };

    ws.onerror = () => {
      if (connTimer) clearTimeout(connTimer);
      if (isTerminated) return;
      isTerminated = true;
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.close(); } catch (e) {}
      }
      reject(new Error('CDP WebSocket error'));
    };
  });
}

// Watch Mode: Keeps CDP connection open, watches database & transcript files, pushes live updates
async function watchLive() {
  const log = (...args) => console.log(...args);
  log('=== Running in Watch Mode (auto-synchronize on SQLite & transcript changes) ===');

  let activeWs = null;
  let reqId = 2000;
  let isConnecting = false;
  let debounceTimer = null;
  let retryBusyTimer = null;
  let pendingReason = null;
  let pushInFlight = false;
  let pendingAfterFlight = false;
  let watchers = [];
  let consecutiveDisconnects = 0;

  function setupWatchers() {
    for (const w of watchers) {
      try { w.close(); } catch (e) {}
    }
    watchers = [];

    const agDir = getAntigravityDir();
    const convDir = path.join(agDir, 'conversations');
    const brainDir = path.join(agDir, 'brain');

    if (fs.existsSync(convDir)) {
      try {
        const convWatcher = fs.watch(convDir, (eventType, filename) => {
          if (!filename || filename.endsWith('.db') || filename.endsWith('.db-wal') || filename.endsWith('.db-shm')) {
            schedulePush(`conv:${filename || eventType}`);
          }
        });
        watchers.push(convWatcher);
      } catch (e) {
        log(`[Watch] Failed to watch ${convDir}:`, e.message);
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

  function schedulePush(reason) {
    pendingReason = pendingReason || reason;
    if (pushInFlight) pendingAfterFlight = true;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => flush('debounce'), 500);
  }

  function flush(trigger = 'scheduled') {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (!pendingReason) return;
    if (pushInFlight) {
      pendingAfterFlight = true;
      return;
    }

    const reason = pendingReason;
    pendingReason = null;
    pushInFlight = true;
    const startedAt = Date.now();
    log(`[Live Sync] Flush start (${trigger}, reason=${reason})`);
    pushLatestStats(reason)
      .catch(err => log(`[Live Sync] Flush error (${reason}): ${err.message}`))
      .finally(() => {
        pushInFlight = false;
        log(`[Live Sync] Flush end (${reason}) after ${Date.now() - startedAt}ms`);
        if (pendingAfterFlight || pendingReason) {
          pendingAfterFlight = false;
          flush('after-flight');
        }
      });
  }

  async function pushLatestStats(reason = 'file-change') {
    if (!activeWs || activeWs.readyState !== WebSocket.OPEN) return;
    try {
      const freshStats = computeStats(true);
      const updateScript = `
        (() => {
          window.__ANTIGRAVITY_STATS__ = ${JSON.stringify(freshStats)};
          window.dispatchEvent(new CustomEvent('antigravity:stats-updated', { detail: window.__ANTIGRAVITY_STATS__ }));
          return true;
        })()
      `;
      await sendCDP(activeWs, 'Runtime.evaluate', { expression: updateScript, returnByValue: true });
      log(`[Live Sync] Updated stats pushed (${reason}): ${freshStats.kpis.lifetimeTokens} tokens | Cache: ${freshStats.insights.cacheHitRate}`);

      if (freshStats.meta?.hasStaleSessions) {
        if (retryBusyTimer) clearTimeout(retryBusyTimer);
        retryBusyTimer = setTimeout(() => {
          retryBusyTimer = null;
          log('[Live Sync] Retrying push after busy lock (retry-after-busy)...');
          schedulePush('retry-after-busy');
        }, 2500);
      }
    } catch (err) {
      log(`[Live Sync] Push error: ${err.message}`);
    }
  }

  // Setup file system watchers immediately so OS file events are captured
  setupWatchers();

  const sendCDP = (ws, method, params = {}, timeoutMs = 10000) => new Promise((res, rej) => {
    const id = reqId++;
    let timer = null;
    const onMsg = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.id === id) {
          if (timer) clearTimeout(timer);
          ws.removeEventListener('message', onMsg);
          if (data.error) rej(new Error(data.error.message));
          else res(data.result);
        }
      } catch (e) {}
    };
    timer = setTimeout(() => {
      ws.removeEventListener('message', onMsg);
      rej(new Error(`CDP command ${method} (id ${id}) timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });


  const connectAndWatch = async () => {
    if (isConnecting) return;
    isConnecting = true;

    try {
      log('[Live Sync] Probing DevTools port...');
      const port = await getDevToolsPort();
      log('[Live Sync] Found port:', port);
      const pagesRes = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(3000) });
      const pages = await pagesRes.json();
      let mainPage = pages.find(isMainAppPage);

      if (!mainPage) {
        log('[Live Sync] Main application page not ready yet (waiting for Antigravity app load)...');
        consecutiveDisconnects++;
        setTimeout(() => { isConnecting = false; connectAndWatch(); }, 2000);
        return;
      }

      log(`[Live Sync] Target page found: "${mainPage.title}" (${mainPage.url})`);

      // Ensure bundle is injected into the window
      await inject({ port, silent: true }).catch(err => {
        log(`[Live Sync] Notice during initial inject: ${err.message}`);
      });

      try {
        const freshPagesRes = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(3000) });
        const freshPages = await freshPagesRes.json();
        const freshMainPage = freshPages.find(isMainAppPage);
        if (freshMainPage) mainPage = freshMainPage;
      } catch (e) {}

      log(`[Live Sync] Target page confirmed: "${mainPage.title}" (${mainPage.url})`);
      log('[Live Sync] Opening persistent WebSocket to:', mainPage.webSocketDebuggerUrl);
      let wsClosed = false;
      const ws = new WebSocket(mainPage.webSocketDebuggerUrl);

      const safeClose = () => {
        if (wsClosed) return;
        wsClosed = true;
        try {
          if (ws.readyState === WebSocket.OPEN) ws.close();
        } catch (e) {}
      };

      ws.onopen = async () => {
        activeWs = ws;
        isConnecting = false;
        consecutiveDisconnects = 0;
        log(`[Live Sync] Connected persistent CDP session on port ${port}`);

        try {
          await sendCDP(ws, 'Runtime.enable');
          await sendCDP(ws, 'Runtime.addBinding', { name: '__ANTIGRAVITY_CDP_SYNC__' });

          const initSyncScript = `
            (() => {
              window.__ANTIGRAVITY_REQUEST_SYNC__ = () => {
                if (typeof window.__ANTIGRAVITY_CDP_SYNC__ === 'function') {
                  try { window.__ANTIGRAVITY_CDP_SYNC__('manual-refresh'); } catch (e) {}
                }
                window.dispatchEvent(new CustomEvent('antigravity:request-sync'));
              };
              return true;
            })()
          `;
          await sendCDP(ws, 'Runtime.evaluate', { expression: initSyncScript, returnByValue: true });
          schedulePush('initial-connect');
        } catch (err) {
          log(`[Live Sync] Binding setup error:`, err.message);
        }

        setupWatchers();
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.method === 'Runtime.bindingCalled' && data.params?.name === '__ANTIGRAVITY_CDP_SYNC__') {
            log('[Live Sync] UI requested immediate refresh via __ANTIGRAVITY_REQUEST_SYNC__');
            schedulePush('ui-manual-request');
          }
        } catch (e) {}
      };

      ws.onclose = () => {
        wsClosed = true;
        if (retryBusyTimer) {
          clearTimeout(retryBusyTimer);
          retryBusyTimer = null;
        }
        log('[Live Sync] CDP WebSocket closed. Reconnecting...');
        activeWs = null;
        consecutiveDisconnects++;
        setTimeout(() => { isConnecting = false; connectAndWatch(); }, 2000);
      };

      ws.onerror = (err) => {
        log('[Live Sync] WebSocket error:', err?.message || 'unknown');
        safeClose();
      };

    } catch (err) {
      log('[Live Sync] connectAndWatch error:', err?.stack || err?.message || err);
      consecutiveDisconnects++;
      setTimeout(() => { isConnecting = false; connectAndWatch(); }, 3000);
    }
  };


  connectAndWatch();
}

if (require.main === module) {
  const isWatch = process.argv.includes('--watch');
  if (!isWatch) {
    inject().catch((err) => {
      console.error('[Injection Failed]:', err.message || err);
      process.exit(1);
    });
  } else {
    watchLive();
  }
}

module.exports = {
  getDevToolsPort,
  getDevToolsPortPath,
  inject,
  watchLive,
};
