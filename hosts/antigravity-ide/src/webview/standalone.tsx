import React from 'react';
import ReactDOM from 'react-dom/client';
import '../../../../src/index.css';
import { StatsView } from '../../../../src/components/stats/StatsView';
import { LanguageProvider } from '../../../../src/i18n/LanguageContext';
import { syncThemeToElement } from '../../../../src/services/stats-service';
import { EVENT_STATS_UPDATED, WINDOW_LIVE_QUOTA, WINDOW_REQUEST_SYNC, WINDOW_STATS } from '../../../../src/injection-contract.cjs';
import { EXT_TO_WEBVIEW, WEBVIEW_TO_EXT, type ExtensionToWebviewMessage, type ThemeKind } from '../ide-contract';
import '../../../../src/domain/stats.types';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

/**
 * Webview entry for the Antigravity IDE sidebar view. The extension host owns the
 * filesystem and aggregation; this side only mirrors pushed state into the shared
 * injection contract (window.__ANTIGRAVITY_STATS__ + the stats-updated event) so the
 * shared StatsView works unchanged through its priority-1 fetchRawStats() path.
 */
const vscode = acquireVsCodeApi();
const container = document.getElementById('root');

if (!container) {
  throw new Error('[TokenStats IDE] Missing #root element in webview HTML');
}

// Both signals feed detectAntigravityTheme(): the class also fires StatsView's
// MutationObserver (it does not watch data-vscode-theme-kind), the attribute
// matches the VSCode convention for host webviews.
function applyTheme(themeKind: ThemeKind) {
  const isDark = themeKind === 'dark';
  document.documentElement.setAttribute('data-vscode-theme-kind', isDark ? 'vscode-dark' : 'vscode-light');
  document.documentElement.classList.toggle('dark', isDark);
  document.documentElement.classList.toggle('light', !isDark);
  syncThemeToElement(container);
}

window.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data as ExtensionToWebviewMessage;
  switch (msg.type) {
    case EXT_TO_WEBVIEW.STATS:
      (window as unknown as Record<string, unknown>)[WINDOW_STATS] = msg.stats;
      window.dispatchEvent(new CustomEvent(EVENT_STATS_UPDATED, { detail: msg.stats }));
      break;
    case EXT_TO_WEBVIEW.QUOTA:
      // Mirror the quota into the shared window global so SubscriptionQuotaCard's
      // tryFetchLiveQuotaFromHost() picks it up. Dispatched WITHOUT a detail: the
      // shared StatsView handler treats detail as AggregatedStats, and the stats
      // side was already pushed via EXT_TO_WEBVIEW.STATS.
      (window as unknown as Record<string, unknown>)[WINDOW_LIVE_QUOTA] = msg.quota;
      window.dispatchEvent(new CustomEvent(EVENT_STATS_UPDATED));
      break;
    case EXT_TO_WEBVIEW.THEME:
      applyTheme(msg.themeKind);
      break;
  }
});

// The shared StatsView calls this on mount; route the request to the extension,
// which answers with a full stats push.
(window as unknown as Record<string, unknown>)[WINDOW_REQUEST_SYNC] = () => {
  vscode.postMessage({ type: WEBVIEW_TO_EXT.REQUEST_SYNC });
};

applyTheme('dark');
const theme = syncThemeToElement(container);
const root = ReactDOM.createRoot(container);
root.render(
  <React.StrictMode>
    <LanguageProvider>
      <div className={`antigravity-stats-container ${theme} w-full h-full`} style={{ height: '100%', minHeight: '500px' }}>
        <StatsView />
      </div>
    </LanguageProvider>
  </React.StrictMode>
);

// Ask the host for the real theme plus the initial aggregate.
vscode.postMessage({ type: WEBVIEW_TO_EXT.READY });
