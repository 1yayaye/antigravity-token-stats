import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRequire } from 'module';
import type { AggregatedStats } from '../../../../src/domain/stats.types';
import {
  EXT_TO_WEBVIEW,
  IDE_OPEN_STATS_COMMAND,
  IDE_PROXY_INSTALL_COMMAND,
  IDE_PROXY_STATUS_COMMAND,
  IDE_PROXY_UNINSTALL_COMMAND,
  IDE_REFRESH_COMMAND,
  IDE_STATS_VIEW_ID,
  IDE_WORKBENCH_VIEW_ID,
  WEBVIEW_TO_EXT,
  type ExtensionToWebviewMessage,
  type WebviewToExtensionMessage,
} from '../../src/ide-contract';
import { fetchLiveQuota } from './quota-service';
import { StatsStatusBar } from './status-bar';

// Session data root of the Antigravity IDE (resolves to
// C:/Users/<user>/.gemini/antigravity-ide). Passed explicitly to computeStats so
// the aggregation never falls back to the desktop client's data root.
const DATA_DIR = path.join(os.homedir(), '.gemini', 'antigravity-ide');

// Watch/debounce rhythm mirrors hosts/antigravity/scripts/loader.cjs: events are
// batched for at least 400ms, full rescans are capped at one per 2s, and a scan
// landing while another is in flight is merged instead of dropped.
const DEBOUNCE_MIN_MS = 400;
const FULL_SCAN_MIN_GAP_MS = 2000;
const RETRY_AFTER_BUSY_MS = 2500;

// The aggregation engine is bundled into out/ by build-extension-ide.cjs so the
// extension is self-contained once installed under ~/.antigravity-ide/extensions/;
// walking up to the repo's shared scripts/ keeps in-repo dev runs working when
// the bundle step was skipped. Typed locally: the .cjs ships no declarations.
function loadAggregator(): { computeStats: (force?: boolean, dataDir?: string) => AggregatedStats } {
  const bundled = path.join(__dirname, 'aggregate-stats.cjs');
  if (fs.existsSync(bundled)) {
    return createRequire(path.join(__dirname, 'package.json'))(bundled);
  }
  // __dirname sits inside the compiled out/ tree; walk up to the repo root instead
  // of hard-coding the emit layout.
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    const candidate = path.join(dir, 'scripts', 'aggregate-stats.cjs');
    if (fs.existsSync(candidate)) {
      const req = createRequire(path.join(dir, 'package.json'));
      return req(candidate);
    }
    dir = path.dirname(dir);
  }
  throw new Error(`[TokenStats IDE] aggregate-stats.cjs not found next to or above ${__dirname}`);
}

const { computeStats } = loadAggregator();

let currentView: vscode.WebviewView | null = null;
let watchers: fs.FSWatcher[] = [];
let debounceTimer: NodeJS.Timeout | null = null;
let busyRetryTimer: NodeJS.Timeout | null = null;
let pendingReason: string | null = null;
let pushInFlight = false;
let pendingAfterFlight = false;
let lastFullScanAt = 0;
// Conversation the conv watcher saw change last (.db basename). Only used as the
// status bar's session fallback before the aggregate picks the session up.
let lastChangedSessionId: string | null = null;
let statusBar: StatsStatusBar | null = null;

function postToView(message: ExtensionToWebviewMessage) {
  if (currentView) {
    void currentView.webview.postMessage(message);
  }
}

function themeKind(): 'dark' | 'light' {
  const kind = vscode.window.activeColorTheme.kind;
  return kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight
    ? 'light'
    : 'dark';
}

function sendTheme() {
  postToView({ type: EXT_TO_WEBVIEW.THEME, themeKind: themeKind() });
}

function flush(trigger: 'init' | 'request' | 'debounce' | 'retry' | 'after-flight') {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (!pendingReason && trigger !== 'init' && trigger !== 'request') return;
  if (pushInFlight) {
    pendingAfterFlight = true;
    return;
  }

  pendingReason = null;
  pendingAfterFlight = false;
  pushInFlight = true;

  try {
    const stats = computeStats(true, DATA_DIR);
    lastFullScanAt = Date.now();
    if (stats && stats.kpis) {
      postToView({ type: EXT_TO_WEBVIEW.STATS, stats });
      statusBar?.update(stats, lastChangedSessionId);
      // Live quota rides along with every stats push; its 60s throttle lives
      // inside the service, so this stays cheap.
      void fetchLiveQuota(false).then(quota => {
        postToView({ type: EXT_TO_WEBVIEW.QUOTA, quota });
      });
      if (stats.meta?.hasStaleSessions) {
        // Some session DBs were locked (IDE mid-write); retry once after a pause
        // so the view does not sit on partial numbers until the next event.
        if (busyRetryTimer) clearTimeout(busyRetryTimer);
        busyRetryTimer = setTimeout(() => {
          busyRetryTimer = null;
          schedulePush('retry-after-busy');
        }, RETRY_AFTER_BUSY_MS);
      }
    }
  } catch (err) {
    console.error('[TokenStats IDE] computeStats error:', err);
  } finally {
    pushInFlight = false;
    if (pendingAfterFlight || pendingReason) {
      pendingAfterFlight = false;
      flush('after-flight');
    }
  }
}

function schedulePush(reason: string) {
  pendingReason = pendingReason || reason;
  if (pushInFlight) pendingAfterFlight = true;
  if (debounceTimer) return;
  const wait = Math.max(DEBOUNCE_MIN_MS, FULL_SCAN_MIN_GAP_MS - (Date.now() - lastFullScanAt));
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    flush('debounce');
  }, wait);
}

function disposeWatchers() {
  for (const w of watchers) {
    try { w.close(); } catch (e) {}
  }
  watchers = [];
}

function setupWatchers() {
  disposeWatchers();

  const convDir = path.join(DATA_DIR, 'conversations');
  const brainDir = path.join(DATA_DIR, 'brain');

  if (fs.existsSync(convDir)) {
    try {
      const convWatcher = fs.watch(convDir, (eventType, filename) => {
        if (!filename || filename.endsWith('.db') || filename.endsWith('.db-wal') || filename.endsWith('.db-shm')) {
          if (filename && filename.endsWith('.db')) {
            // Strip the extension: aggregate-stats keys sessions by basename.
            lastChangedSessionId = filename.slice(0, -'.db'.length);
          }
          schedulePush(`conv:${filename || eventType}`);
        }
      });
      watchers.push(convWatcher);
    } catch (e) {
      console.warn('[TokenStats IDE] Failed to watch conversations dir:', (e as Error).message);
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
    } catch (e) {
      console.warn('[TokenStats IDE] Failed to watch brain dir:', (e as Error).message);
    }
  }
}

function getNonce() {
  let nonce = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}

function getHtml(webview: vscode.Webview, extensionUri: vscode.Uri) {
  const bundleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'antigravity-stats-ide-bundle.js')
  );
  const nonce = getNonce();
  // The bundle injects its own <style> element at runtime, hence 'unsafe-inline'
  // for styles; the script is pinned to a nonce per the VSCode webview guidelines.
  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} data:`,
    `font-src ${webview.cspSource}`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    html, body { height: 100%; margin: 0; padding: 0; overflow: hidden; }
    #root { height: 100%; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${bundleUri}"></script>
</body>
</html>`;
}

class StatsViewProvider implements vscode.WebviewViewProvider {
  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    currentView = view;

    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    };
    view.webview.html = getHtml(view.webview, this.extensionUri);

    view.webview.onDidReceiveMessage((msg: WebviewToExtensionMessage) => {
      switch (msg.type) {
        case WEBVIEW_TO_EXT.READY:
          // Re-arm watchers on every (re)activation so a data dir created after
          // startup still gets picked up, then push theme + initial aggregate.
          setupWatchers();
          sendTheme();
          flush('init');
          break;
        case WEBVIEW_TO_EXT.REQUEST_SYNC:
          // The shared StatsView fires this on mount, right after READY already
          // forced a full scan; a scan this fresh needs no repeat.
          if (Date.now() - lastFullScanAt >= FULL_SCAN_MIN_GAP_MS) {
            schedulePush('request-sync');
          }
          break;
      }
    });

    view.onDidDispose(() => {
      if (currentView === view) {
        currentView = null;
      }
      // Watchers, timers and the status bar keep running: the status bar must
      // stay live even when the sidebar is closed. The next READY re-arms the
      // watchers (setupWatchers is idempotent) and pushes fresh state.
    });
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = new StatsViewProvider(context.extensionUri);
  statusBar = new StatsStatusBar();
  context.subscriptions.push(
    statusBar,
    vscode.window.registerWebviewViewProvider(IDE_STATS_VIEW_ID, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand(IDE_REFRESH_COMMAND, () => flush('request')),
    vscode.commands.registerCommand(IDE_OPEN_STATS_COMMAND, () => {
      void vscode.commands.executeCommand(IDE_WORKBENCH_VIEW_ID);
    }),
    vscode.commands.registerCommand(IDE_PROXY_STATUS_COMMAND, () => {
      try {
        const req = createRequire(__filename);
        let pm: any;
        try {
          pm = req('./proxy-manager.cjs');
        } catch {
          pm = req('../../../scripts/proxy-manager.cjs');
        }
        const status = pm.getAllStatus();
        const ideStatus = status.ide;
        const msg = ideStatus.installed
          ? `Antigravity IDE Proxy: Active (${ideStatus.config?.proxy?.type}://${ideStatus.config?.proxy?.host}:${ideStatus.config?.proxy?.port})`
          : 'Antigravity IDE Proxy: Inactive (version.dll not installed)';
        vscode.window.showInformationMessage(msg);
      } catch (err) {
        vscode.window.showErrorMessage(`Proxy status check failed: ${(err as Error).message}`);
      }
    }),
    vscode.commands.registerCommand(IDE_PROXY_INSTALL_COMMAND, async () => {
      const portInput = await vscode.window.showInputBox({
        prompt: 'Enter local proxy port (e.g. 7890 for Clash / 10808 for v2rayN)',
        value: '7890',
      });
      if (!portInput) return;
      const port = parseInt(portInput.trim(), 10);
      if (isNaN(port) || port <= 0 || port > 65535) {
        vscode.window.showErrorMessage('Invalid port number');
        return;
      }
      try {
        const req = createRequire(__filename);
        let pm: any;
        try {
          pm = req('./proxy-manager.cjs');
        } catch {
          pm = req('../../../scripts/proxy-manager.cjs');
        }
        pm.installProxy('ide', { port, type: 'socks5', skipProcessCheck: true });
        vscode.window.showInformationMessage(`Transparent proxy successfully installed for Antigravity IDE (Port ${port}). Restart IDE to take effect.`);
        flush('request');
      } catch (err) {
        vscode.window.showErrorMessage(`Proxy installation failed: ${(err as Error).message}`);
      }
    }),
    vscode.commands.registerCommand(IDE_PROXY_UNINSTALL_COMMAND, () => {
      try {
        const req = createRequire(__filename);
        let pm: any;
        try {
          pm = req('./proxy-manager.cjs');
        } catch {
          pm = req('../../../scripts/proxy-manager.cjs');
        }
        pm.uninstallProxy('ide', { skipProcessCheck: true });
        vscode.window.showInformationMessage('Transparent proxy removed for Antigravity IDE. Restart IDE to restore default network.');
        flush('request');
      } catch (err) {
        vscode.window.showErrorMessage(`Proxy uninstall failed: ${(err as Error).message}`);
      }
    }),
    vscode.window.onDidChangeActiveColorTheme(() => sendTheme()),
    new vscode.Disposable(() => {
      if (busyRetryTimer) clearTimeout(busyRetryTimer);
      if (debounceTimer) clearTimeout(debounceTimer);
      disposeWatchers();
      statusBar = null;
    })
  );

  // The status bar (and its underlying data flow) works without the sidebar ever
  // being opened: start watching and run the first scan here. The READY handler
  // re-arms everything idempotently when the view does open.
  setupWatchers();
  flush('init');
}

export function deactivate(): void {}
