const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { app, webContents, ipcMain, BrowserWindow, session } = require('electron');
const contract = require('./injection-contract.cjs');
const { computeStats, readSingleSession } = require('./aggregate-stats.cjs');
const { fetchLiveQuota } = require('./quota-service.cjs');

const dataDir = path.join(os.homedir(), '.gemini', 'antigravity-ide');
const workbenchPath = path.resolve(__dirname, '..', 'vs/code/electron-browser/workbench/workbench.html').replace(/\\/g, '/').toLowerCase();
const PROXY_PROBE_URL = 'https://oauth2.googleapis.com/token';
const LOCAL_NO_PROXY = 'localhost,127.0.0.1,::1';
let stats = null;
let quota = null;
let lastScan = 0;
let quotaInFlight = null;
let quotaInFlightForced = false;
const attached = new WeakSet();

// The native Go backend dials Google directly and hangs when only the system
// proxy is enabled (no env vars, no http.proxy setting). These helpers inherit
// exactly the proxy Chromium itself resolves for the auth endpoint; explicit
// configuration and unreadable settings always win by disabling inheritance.

function hasExplicitProxyEnv(env) {
  return [env.HTTP_PROXY, env.http_proxy, env.HTTPS_PROXY, env.https_proxy]
    .some(value => typeof value === 'string' && value.trim() !== '');
}

function planProxyInheritance({ env = process.env, httpProxySetting, systemProxy }) {
  if (httpProxySetting === null) return null; // settings unreadable: never guess
  if (hasExplicitProxyEnv(env)) return null;
  if (typeof httpProxySetting === 'string' && httpProxySetting.trim() !== '') return null;
  const match = /^\s*(PROXY|HTTPS|SOCKS\d*)\s+([^\s;,]+)/i.exec(systemProxy || '');
  if (!match || /^SOCKS/i.test(match[1])) return null; // DIRECT, unknown or SOCKS stay untouched
  const proxyUrl = (match[1].toUpperCase() === 'HTTPS' ? 'https://' : 'http://') + match[2];
  const changes = { HTTP_PROXY: proxyUrl, http_proxy: proxyUrl, HTTPS_PROXY: proxyUrl, https_proxy: proxyUrl };
  const noProxy = env.NO_PROXY ?? env.no_proxy;
  if (typeof noProxy !== 'string' || noProxy.trim() === '') {
    changes.NO_PROXY = LOCAL_NO_PROXY;
    changes.no_proxy = LOCAL_NO_PROXY;
  }
  return changes;
}

let jsoncParser = null;
try { jsoncParser = require('jsonc-parser'); } catch { jsoncParser = null; }

// Returns the user's http.proxy string, undefined when absent, or null when the
// default-profile settings exist but cannot be read confidently.
function readHttpProxySetting(userDataDir, readFile = fs.readFileSync) {
  let raw;
  try { raw = readFile(path.join(userDataDir, 'User', 'settings.json'), 'utf8'); }
  catch (error) { return error?.code === 'ENOENT' ? undefined : null; }
  const errors = [];
  let parsed;
  try { parsed = jsoncParser?.parse(raw, errors, { allowTrailingCommas: true }); }
  catch { return null; }
  if (!jsoncParser || (Array.isArray(errors) && errors.length > 0) || !parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const value = parsed['http.proxy'];
  return typeof value === 'string' ? value : undefined;
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('resolveProxy timed out')), ms);
    Promise.resolve(promise).then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); });
  });
}

async function inheritSystemProxy() {
  try {
    if (hasExplicitProxyEnv(process.env)) return;
    const setting = readHttpProxySetting(app.getPath('userData'));
    if (setting === null) {
      console.warn('[TokenStats IDE] default-profile settings unreadable; system proxy not inherited');
      return;
    }
    if (typeof setting === 'string' && setting.trim() !== '') return; // the native host applies this setting itself
    const systemProxy = await withTimeout(session.defaultSession.resolveProxy(PROXY_PROBE_URL), 5000);
    const changes = planProxyInheritance({ env: process.env, httpProxySetting: setting, systemProxy });
    if (!changes) return;
    Object.assign(process.env, changes);
    console.warn(`[TokenStats IDE] inherited system proxy for the native backend (${changes.HTTPS_PROXY}, NO_PROXY=${changes.NO_PROXY || 'kept'})`);
  } catch (error) {
    console.warn('[TokenStats IDE] system proxy inheritance skipped:', error?.message || error);
  }
}

function isWorkbench(url) {
  try {
    const parsed = new URL(url);
    const localOrigin = (parsed.protocol === 'file:' && !parsed.hostname)
      || (parsed.protocol === 'vscode-file:' && parsed.hostname === 'vscode-app');
    return localOrigin
      && decodeURIComponent(parsed.pathname).replace(/^\/([a-z]:)/i, '$1').toLowerCase() === workbenchPath;
  } catch { return false; }
}

// Runs inside the native main-chat shell, never reads messages or credentials.
function observeChat(config) {
  const frame = document.getElementById(config.rpc.iframeId);
  if (!frame || !document.documentElement.matches('[data-host="antigravity"]')) return null;
  if (![...document.querySelectorAll('style')].some(style => style.textContent.includes('--vscode-sideBar-background'))) return null;
  const source = new URL(frame.src);
  if (!['http:', 'https:'].includes(source.protocol)) return null;
  const parse = value => /^\/c\/([a-zA-Z0-9_-]{1,128})\/?$/.exec(value)?.[1] || null;
  let state = window[config.key];
  if (!state) {
    state = { id: parse(source.pathname), frame, origin: source.origin };
    window[config.key] = state;
    window.addEventListener('message', event => {
      const message = event.data;
      if (event.source !== state.frame?.contentWindow || event.origin !== state.origin) return;
      if (message?.type !== 'postmessage-rpc' || message.channel !== config.rpc.channel
        || message.source !== config.rpc.source || message.rpcPath !== config.rpc.path
        || typeof message.payload?.path !== 'string') return;
      state.id = parse(message.payload.path);
    });
  } else if (state.frame !== frame || state.origin !== source.origin) {
    // Chat iframe remounted or navigated to a new origin: rebind target and baseline route.
    state.frame = frame;
    state.origin = source.origin;
    state.id = parse(source.pathname);
  }
  const bounds = frame.getBoundingClientRect();
  return { id: state.id, visible: !document.hidden && bounds.width > 0 && bounds.height > 0 };
}

async function activeSession(contents) {
  let owner;
  try { owner = BrowserWindow.fromWebContents(contents); } catch { return null; }
  if (!owner) return null;
  const frames = webContents.getAllWebContents().flatMap(candidate => {
    try {
      return !candidate.isDestroyed() && candidate.getOwnerBrowserWindow()?.id === owner.id
        ? candidate.mainFrame.framesInSubtree : [];
    } catch { return []; }
  });
  const config = { key: contract.WINDOW_IDE_ROUTE, rpc: contract.IDE_NATIVE_CHAT_RPC };
  const results = await Promise.all(frames.map(async frame => {
    try { return await frame.executeJavaScript(`(${observeChat})(${JSON.stringify(config)})`); }
    catch { return null; }
  }));
  const ids = new Set(results.filter(result => result?.visible && result.id).map(result => result.id));
  // Ambiguous frames are unknown; another window/recent session is never a fallback.
  return ids.size === 1 ? [...ids][0] : null;
}

ipcMain.handle(contract.IPC_IDE_SYNC, async (event, options) => {
  if (event.senderFrame !== event.sender.mainFrame || !isWorkbench(event.senderFrame.url)) return null;
  const forceQuota = Boolean(options && typeof options === 'object' && options.forceQuota === true);
  let error = null;
  if (Date.now() - lastScan >= 2000) {
    lastScan = Date.now();
    try { stats = computeStats(true, dataDir); }
    catch { error = 'stats_read_failed'; }
  }
  if (forceQuota) {
    if (quotaInFlight && !quotaInFlightForced) {
      await quotaInFlight;
    }
    if (!quotaInFlight) {
      quotaInFlightForced = true;
      quotaInFlight = fetchLiveQuota(true)
        .then(value => { quota = value; })
        .catch(() => { quota = null; })
        .finally(() => { quotaInFlight = null; quotaInFlightForced = false; });
    }
    await quotaInFlight;
  } else if (!quotaInFlight) {
    quotaInFlightForced = false;
    quotaInFlight = fetchLiveQuota(false)
      .then(value => { quota = value; })
      .catch(() => { quota = null; })
      .finally(() => { quotaInFlight = null; quotaInFlightForced = false; });
  }
  const activeSessionId = await activeSession(event.sender);
  let session = activeSessionId ? stats?.sessions?.[activeSessionId] || null : null;
  if (activeSessionId && !session) {
    try { session = readSingleSession(activeSessionId, dataDir); } catch { /* Busy DB is unavailable, not zero. */ }
  }
  return { stats, quota, activeSessionId, session, sessionTitle: null, contextLimit: null, error };
});

function attach(contents) {
  if (attached.has(contents)) return;
  attached.add(contents);
  contents.on('dom-ready', () => {
    if (!isWorkbench(contents.getURL())) return;
    try {
      const code = fs.readFileSync(path.join(__dirname, 'antigravity-stats-ide-bundle.js'), 'utf8');
      void contents.executeJavaScript(code).catch(() => console.warn('[TokenStats IDE] UI injection failed'));
    } catch { console.warn('[TokenStats IDE] UI bundle unavailable'); }
  });
}

app.on('web-contents-created', (_event, contents) => attach(contents));
for (const contents of webContents.getAllWebContents()) attach(contents);
// Registered on import, before any native ready listener: when it fires the
// final userData is set and no native startup or backend spawn has happened.
// shortcut: resolveProxy runs async while Electron continues ready; assumes the agy extension spawns the backend later, switch to sync WinINET read if cold-boot races appear.
app.once('ready', inheritSystemProxy);
