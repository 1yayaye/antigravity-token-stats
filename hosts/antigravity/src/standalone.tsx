import React from 'react';
import ReactDOM from 'react-dom/client';
import '../../../src/index.css';
import { StatsView } from '../../../src/components/stats/StatsView';
import { LanguageProvider } from '../../../src/i18n/LanguageContext';
import { detectAntigravityTheme, syncThemeToElement } from '../../../src/services/stats-service';
import { antigravityI18n } from './i18n/antigravity-ui-i18n';
import { startQuotaUpdates } from './quota';
import { StatusBar } from '../../../src/components/statusbar/StatusBar';
import type { StatusBarHostStyle } from '../../../src/components/statusbar/StatusBar';
import type { SessionTelemetry } from '../../../src/types/telemetry';
import { resolveModelContextLimit } from '../../../src/utils/telemetry-format';
import { CONTAINER_POPOVER_ID, CONTAINER_STATUSBAR_ID, EVENT_LANGUAGE_CHANGED, EVENT_REQUEST_SYNC, EVENT_STATS_UPDATED, FEATURES, IPC_REQUEST_SYNC, WINDOW_LIVE_QUOTA, WINDOW_STATS_FEATURES, WINDOW_SYNC_BRIDGE } from '../../../src/injection-contract.cjs';
import '../../../src/domain/stats.types';

let activeContainer: HTMLElement | null = null;
let isMounting = false;

// Injectable features are switchable per install (contract.json features, relayed by
// the loader through window[WINDOW_STATS_FEATURES]). A missing global means "all on",
// so npm dev, IDE, and older patches are unaffected.
export function isStatsFeatureEnabled(name: keyof typeof FEATURES): boolean {
  const features = typeof window === 'undefined'
    ? undefined
    : (window as unknown as Record<string, Record<string, boolean> | undefined>)[WINDOW_STATS_FEATURES];
  return features?.[name] ?? true;
}

// Standalone injector for Antigravity 2.0 with debouncing & error guards
export function mountStats(container: HTMLElement) {
  if (!container) return;

  if (isMounting) return;
  isMounting = true;

  try {
    syncThemeToElement(container);
    const existingRoot = window.__ANTIGRAVITY_STATS_ROOT__;
    if (existingRoot && activeContainer === container) {
      existingRoot.render(
        <React.StrictMode>
          <LanguageProvider>
            <div className="w-full min-h-0">
              <StatsView />
            </div>
          </LanguageProvider>
        </React.StrictMode>
      );
      isMounting = false;
      return;
    }

    unmountStats();

    container.innerHTML = '';
    const root = ReactDOM.createRoot(container);
    window.__ANTIGRAVITY_STATS_ROOT__ = root;
    activeContainer = container;

    root.render(
      <React.StrictMode>
        <LanguageProvider>
          <div className="w-full min-h-0">
            <StatsView />
          </div>
        </LanguageProvider>
      </React.StrictMode>
    );
  } catch (err) {
    console.error('[TokenStats] Mount error:', err);
  } finally {
    isMounting = false;
  }
}

export function unmountStats() {
  if (window.__ANTIGRAVITY_STATS_ROOT__) {
    try {
      window.__ANTIGRAVITY_STATS_ROOT__.unmount();
    } catch (e) {
      console.warn('[TokenStats] Error unmounting root:', e);
    }
    window.__ANTIGRAVITY_STATS_ROOT__ = null;
  }
  activeContainer = null;

  // Clean up any stale misplaced containers or orphan elements
  document.querySelectorAll('#antigravity-stats-settings-content, .antigravity-stats-container').forEach(el => {
    try { el.innerHTML = ''; } catch (e) {}
  });
}

export function removeContextPopover() {
  document.querySelectorAll(`#antigravity-context-popover, #${CONTAINER_POPOVER_ID}`).forEach(el => el.remove());
}

export function getCurrentConversationId(): string | null {
  if (typeof window === 'undefined' || !window.location?.pathname) return null;
  const match = window.location.pathname.match(/\/c\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

/**
 * Resolves the session ID owned by a given statusbar slot so split panes show
 * their own conversation instead of mirroring the active route's session.
 */
export function resolveSessionIdForContainer(container?: HTMLElement | null): string | null {
  if (container && typeof container.closest === 'function') {
    const cascadeEl = container.closest('[data-cascade-id]');
    const cascadeId = cascadeEl?.getAttribute('data-cascade-id')?.trim();
    if (cascadeId) return cascadeId;

    // A newly split empty pane lives inside [data-pane-id] without [data-cascade-id] yet;
    // avoid inheriting the URL route's session when another pane already renders it.
    const paneEl = container.closest('[data-pane-id]');
    if (paneEl && typeof document !== 'undefined' && typeof document.querySelectorAll === 'function') {
      const urlSessionId = getCurrentConversationId();
      if (urlSessionId) {
        const activeViews = Array.from(document.querySelectorAll('[data-cascade-id]'));
        const claimedElsewhere = activeViews.some(
          (el) => el.getAttribute('data-cascade-id') === urlSessionId && !paneEl.contains(el)
        );
        if (claimedElsewhere) return null;
      }
    }
  }
  return getCurrentConversationId();
}

const lastSyncRequestBySession = new Map<string, number>();
export function requestDataSync(sessionId?: string | null) {
  const targetSessionId = sessionId ?? null;
  if (targetSessionId) {
    const now = Date.now();
    const lastTime = lastSyncRequestBySession.get(targetSessionId) ?? 0;
    if (now - lastTime < 100) return; // 100ms per-session heartbeat throttle
    lastSyncRequestBySession.set(targetSessionId, now);
  }

  // Tier 1: ContextBridge Preload bridge
  const syncBridge = typeof window !== 'undefined'
    ? (window as unknown as Record<string, Window['__ANTIGRAVITY_SYNC_BRIDGE__']>)[WINDOW_SYNC_BRIDGE]
    : undefined;
  if (syncBridge && typeof syncBridge.requestSync === 'function') {
    syncBridge.requestSync({ sessionId: targetSessionId }).catch(() => {});
  }
  // Tier 2: Direct Electron IPC if available
  else if (typeof window !== 'undefined' && typeof window.require === 'function') {
    try {
      const electron = window.require('electron');
      if (electron?.ipcRenderer) {
        electron.ipcRenderer.invoke(IPC_REQUEST_SYNC, { sessionId: targetSessionId }).catch(() => {});
      }
    } catch {}
  }
  // Tier 3: Event fallback
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENT_REQUEST_SYNC, { detail: { sessionId: targetSessionId } }));
  }
}

if (typeof window !== 'undefined') {
  window.__ANTIGRAVITY_REQUEST_SYNC__ = (sessionId?: string | null) => requestDataSync(sessionId);
}

// The stop button is the only instant "generating" hint. Our own i18n rewrites aria-labels,
// hence both languages. It never feeds token numbers; those come from SQLite only.
export function checkGenerationState(container?: HTMLElement | null): boolean {
  if (typeof document === 'undefined') return false;
  const scope: ParentNode = (container && typeof container.closest === 'function'
    ? container.closest('[data-testid="conversation-view"], [data-pane-id], [data-testid="agent-input-box"], [data-agent-composer-root]')
    : null) || document;
  if (typeof scope.querySelector !== 'function') return false;
  return Boolean(scope.querySelector(
    'button[data-testid="input-cancel-button"], button[aria-label*="Cancel"], button[aria-label*="Stop"], button[aria-label="取消"], button[aria-label="停止"]'
  ));
}

// A new conversation has no stats entry, and the host pushes nothing until its first model call
// lands. This heartbeat re-reads active sessions once per second, independent of any event.
const PILL_HEARTBEAT_MS = 1000;
const statusbarRoots = new Map<HTMLElement, { root: ReactDOM.Root; signature: string }>();

function isElementConnected(el: HTMLElement | null | undefined): el is HTMLElement {
  return Boolean(el) && el!.isConnected !== false;
}

function pruneDisconnectedStatusBars() {
  for (const container of Array.from(statusbarRoots.keys())) {
    if (!isElementConnected(container)) {
      unmountStatusBar(container);
    }
  }
}

function getAllStatusBarContainers(): HTMLElement[] {
  if (typeof document === 'undefined') return [];
  const seen = new Set<HTMLElement>();
  const add = (el: Element | null | undefined) => {
    if (el && isElementConnected(el as HTMLElement)) {
      seen.add(el as HTMLElement);
    }
  };
  for (const container of statusbarRoots.keys()) add(container);
  if (typeof document.querySelectorAll === 'function') {
    document.querySelectorAll(`#${CONTAINER_STATUSBAR_ID}, [data-ag-statusbar="true"]`).forEach(add);
  }
  if (typeof document.getElementById === 'function') {
    add(document.getElementById(CONTAINER_STATUSBAR_ID));
  }
  return Array.from(seen);
}

function stopContextPillHeartbeat() {
  if (typeof window !== 'undefined' && window.__ANTIGRAVITY_PILL_HEARTBEAT__) {
    clearInterval(window.__ANTIGRAVITY_PILL_HEARTBEAT__);
    window.__ANTIGRAVITY_PILL_HEARTBEAT__ = null;
  }
}

// Probe the host's own control styling so the injected pills inherit the same text
// color, size and weight as native Antigravity controls (e.g. the Turbo dropdown).
// Every field is optional — when the host DOM isn't ready the pills fall back to
// their own --ag-sb-* tokens.
function probeHostPillStyle(container?: HTMLElement | null): StatusBarHostStyle {
  const probe: StatusBarHostStyle = {};
  try {
    const anchor = container?.parentElement?.querySelector?.('button[data-testid="permissions-selector-trigger"]')
      || document.querySelector('button[data-testid="permissions-selector-trigger"]');
    if (anchor instanceof HTMLElement && anchor.isConnected) {
      const cs = getComputedStyle(anchor);
      if (cs.color) probe.textColor = cs.color;
      if (cs.fontSize) probe.fontSize = cs.fontSize;
      if (cs.fontWeight) probe.fontWeight = cs.fontWeight;
    }
    const rootCs = getComputedStyle(document.documentElement);
    const accent = (rootCs.getPropertyValue('--primary') || rootCs.getPropertyValue('--accent-primary')).trim();
    if (accent) probe.accentColor = accent;
  } catch {
    // Host styles unavailable — component defaults apply.
  }
  return probe;
}

const COMPOSER_MODEL_RE = /(?:^|[^a-z0-9])(gemini|claude|gpt|argon|carbon|hydrogen|neon|orchestrator)(?:[^a-z0-9]|$)/i;

// Reads the currently selected model pill in the composer footer so new conversations
// and mid-session model switches update the context window limit before the first turn.
function detectSelectedModelFromComposer(container: HTMLElement): string {
  try {
    let scope: HTMLElement | null = container.parentElement;
    for (let depth = 0; depth < 4 && scope && scope !== document.body; depth++) {
      const buttons = scope.querySelectorAll('button, [role="button"]');
      for (const btn of Array.from(buttons)) {
        if (!(btn instanceof HTMLElement)) continue;
        if (container.contains(btn)) continue;
        if (btn.getAttribute('data-testid') === 'permissions-selector-trigger') continue;
        const rect = btn.getBoundingClientRect();
        if (rect.height <= 0 || rect.height > 48) continue;
        const text = (btn.textContent || '').trim();
        if (text.length > 0 && text.length < 64 && COMPOSER_MODEL_RE.test(text)) {
          return text;
        }
      }
      scope = scope.parentElement;
    }
  } catch {
    // Host DOM probing is best-effort.
  }
  return '';
}

export function mountStatusBar(container: HTMLElement) {
  if (!container || !isStatsFeatureEnabled('statusBar')) return;

  pruneDisconnectedStatusBars();

  const sessionId = resolveSessionIdForContainer(container);
  const stats = window.__ANTIGRAVITY_STATS__;
  const session = sessionId && stats?.sessions ? stats.sessions[sessionId] : null;
  const isGenerating = Boolean(session?.isRunning) || (Boolean(sessionId) && checkGenerationState(container));
  const effectiveTps = session?.tps ?? null;

  const selectedModel = detectSelectedModelFromComposer(container);
  const effectiveModel = selectedModel || session?.modelName || '';
  const liveLimits = (window as unknown as Record<string, { modelContextLimits?: Record<string, number> } | undefined>)[WINDOW_LIVE_QUOTA]?.modelContextLimits;
  const baseUsedTokens = session?.telemetry?.context?.usedTokens ?? 0;
  const resolvedLimit = resolveModelContextLimit(effectiveModel, baseUsedTokens, liveLimits);
  const resolvedUsedPct = baseUsedTokens > 0
    ? Math.min(100, Math.round((baseUsedTokens / resolvedLimit) * 100))
    : 0;

  // Server-side aggregate-stats always attaches `telemetry` to every SessionSummary;
  // fall back to a zero-baseline only when no session data has arrived yet.
  const telemetry: SessionTelemetry = session?.telemetry ? {
    ...session.telemetry,
    isStreaming: isGenerating,
    session: {
      ...session.telemetry.session,
      tps: effectiveTps,
    },
    context: {
      ...session.telemetry.context,
      limitTokens: resolvedLimit,
      usedPct: resolvedUsedPct,
    },
  } : {
    sessionId: sessionId || '',
    isStreaming: isGenerating,
    session: {
      rounds: 1,
      steps: 0,
      tps: effectiveTps,
      modelDurationSec: 0,
      toolDurationSec: 0,
      ttftSec: null,
    },
    token: {
      totalTokens: 0,
      cacheHitRatePct: null,
      uncachedInputTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 0,
    },
    context: {
      usedTokens: 0,
      limitTokens: resolvedLimit,
      usedPct: 0,
      systemPromptTokens: 0,
      toolDefinitionTokens: 0,
      chatMessageTokens: 0,
    },
  };

  const theme = detectAntigravityTheme();
  const lang = antigravityI18n.getLanguage();
  const hostStyle = probeHostPillStyle(container);

  // The heartbeat, mutation scans and sync events all funnel through here every
  // second; skipping no-op renders keeps the host's event loop free enough that
  // popover dismissal stays instant.
  const renderSignature = JSON.stringify([telemetry, theme, lang, hostStyle]);

  const existing = statusbarRoots.get(container);
  if (existing && isElementConnected(container)) {
    window.__ANTIGRAVITY_STATUSBAR_ROOT__ = existing.root;
    window.__ANTIGRAVITY_STATUSBAR_CONTAINER__ = container;
    if (existing.signature === renderSignature) return;
    existing.signature = renderSignature;
    window.__ANTIGRAVITY_STATUSBAR_SIGNATURE__ = renderSignature;
    existing.root.render(
      <React.StrictMode>
        <div className={`antigravity-statusbar-container ${theme}`}>
          <StatusBar
            telemetry={telemetry}
            lang={lang}
            theme={theme}
            hostStyle={hostStyle}
          />
        </div>
      </React.StrictMode>
    );
    return;
  }

  if (existing) {
    unmountStatusBar(container);
  }

  container.innerHTML = '';
  const root = ReactDOM.createRoot(container);
  statusbarRoots.set(container, { root, signature: renderSignature });
  window.__ANTIGRAVITY_STATUSBAR_ROOT__ = root;
  window.__ANTIGRAVITY_STATUSBAR_CONTAINER__ = container;
  window.__ANTIGRAVITY_STATUSBAR_SIGNATURE__ = renderSignature;

  root.render(
    <React.StrictMode>
      <div className={`antigravity-statusbar-container ${theme}`}>
        <StatusBar
          telemetry={telemetry}
          lang={lang}
          theme={theme}
          hostStyle={hostStyle}
        />
      </div>
    </React.StrictMode>
  );
}

export function unmountStatusBar(targetContainer?: HTMLElement) {
  if (targetContainer) {
    const entry = statusbarRoots.get(targetContainer);
    if (entry) {
      try {
        entry.root.unmount();
      } catch (e) {
        console.warn('[TokenStats] Error unmounting status bar root:', e);
      }
      statusbarRoots.delete(targetContainer);
      if (window.__ANTIGRAVITY_STATUSBAR_CONTAINER__ === targetContainer) {
        const nextEntry = statusbarRoots.entries().next().value;
        window.__ANTIGRAVITY_STATUSBAR_CONTAINER__ = nextEntry ? nextEntry[0] : null;
        window.__ANTIGRAVITY_STATUSBAR_ROOT__ = nextEntry ? nextEntry[1].root : null;
        window.__ANTIGRAVITY_STATUSBAR_SIGNATURE__ = nextEntry ? nextEntry[1].signature : undefined;
      }
    }
    return;
  }

  stopContextPillHeartbeat();
  const unmountedRoots = new Set<ReactDOM.Root>();
  for (const entry of statusbarRoots.values()) {
    try {
      entry.root.unmount();
    } catch (e) {
      console.warn('[TokenStats] Error unmounting status bar root:', e);
    }
    unmountedRoots.add(entry.root);
  }
  statusbarRoots.clear();

  if (window.__ANTIGRAVITY_STATUSBAR_ROOT__ && !unmountedRoots.has(window.__ANTIGRAVITY_STATUSBAR_ROOT__)) {
    try {
      window.__ANTIGRAVITY_STATUSBAR_ROOT__.unmount();
    } catch (e) {
      console.warn('[TokenStats] Error unmounting status bar root:', e);
    }
  }
  window.__ANTIGRAVITY_STATUSBAR_ROOT__ = null;
  window.__ANTIGRAVITY_STATUSBAR_CONTAINER__ = null;
  window.__ANTIGRAVITY_STATUSBAR_SIGNATURE__ = undefined;
}

function getActiveSessionIds(containers: HTMLElement[]): string[] {
  const ids = new Set<string>();
  for (const container of containers) {
    const sessionId = resolveSessionIdForContainer(container);
    if (sessionId) ids.add(sessionId);
  }
  const routeId = getCurrentConversationId();
  if (routeId && ids.size === 0) {
    ids.add(routeId);
  }
  return Array.from(ids);
}

export function refreshStatusBar() {
  pruneDisconnectedStatusBars();
  const containers = getAllStatusBarContainers();
  for (const container of containers) {
    mountStatusBar(container);
  }
}

function refreshContextPill() {
  pruneDisconnectedStatusBars();
  const containers = getAllStatusBarContainers();
  if (containers.length === 0 && !document.getElementById('antigravity-context-usage-pill')) {
    stopContextPillHeartbeat();
    return;
  }
  for (const sessionId of getActiveSessionIds(containers)) {
    requestDataSync(sessionId);
  }
  refreshStatusBar();
}

export function startContextPillHeartbeat() {
  if (window.__ANTIGRAVITY_PILL_HEARTBEAT__) return;
  window.__ANTIGRAVITY_PILL_HEARTBEAT__ = setInterval(refreshContextPill, PILL_HEARTBEAT_MS);
}

let lastKnownConversationSignature = '';
export function checkConversationRoute() {
  const containers = getAllStatusBarContainers();
  const routeId = getCurrentConversationId();
  const activeIds = getActiveSessionIds(containers);
  const signature = `${routeId ?? ''}|${activeIds.join(',')}`;
  if (signature !== lastKnownConversationSignature) {
    lastKnownConversationSignature = signature;
    if (activeIds.length > 0) {
      for (const sessionId of activeIds) requestDataSync(sessionId);
    } else {
      requestDataSync(routeId);
    }
    refreshStatusBar();
  }
}

// One restore listener per host settings-nav button, keyed for rebinding: the scan block
// re-runs whenever the host re-renders the modal nav and drops our injected button, and
// re-adding blindly would stack closures over detached nodes. Disconnected buttons are
// pruned on each scan so closed modals do not accumulate.
const navRestoreListeners = new Map<Element, () => void>();

// Auto-injection DOM observer for Antigravity 2.0 Settings Modal & Sidebar Shortcut
export function initAntigravitySettingsInjector() {
  if (window.__ANTIGRAVITY_OBSERVER__) {
    window.__ANTIGRAVITY_OBSERVER__.disconnect();
    window.__ANTIGRAVITY_OBSERVER__ = null;
  }
  if (window.__ANTIGRAVITY_SCAN_TIMER__) {
    clearTimeout(window.__ANTIGRAVITY_SCAN_TIMER__);
    window.__ANTIGRAVITY_SCAN_TIMER__ = null;
  }
  unmountStats();
  unmountStatusBar();

  // Clean up any stale misplaced containers, buttons, toasts and modal overlays
  // from prior injections (older bundles exposed a floating dashboard + toast).
  document.querySelectorAll(`#antigravity-stats-nav-btn, #antigravity-stats-sidebar-btn, #antigravity-stats-content, #antigravity-stats-settings-content, #antigravity-stats-modal-overlay, #antigravity-stats-toast, #antigravity-context-usage-pill, #${CONTAINER_STATUSBAR_ID}, [data-ag-statusbar="true"], #${CONTAINER_POPOVER_ID}`).forEach(el => el.remove());

  const scanAndInject = () => {
    pruneDisconnectedStatusBars();
    for (const btn of navRestoreListeners.keys()) {
      if (!btn.isConnected) navRestoreListeners.delete(btn);
    }

    // 1. Hook into Settings Modal tabs
    const modal = document.querySelector('.settings-modal-container') as HTMLElement | null;
    if (modal) {
      const modelsBtn = Array.from(modal.querySelectorAll('button')).find((b) => {
        const text = (b.innerText || '').trim();
        return text === 'Models' || text === '模型' || text === '模型配置';
      });
      if (modelsBtn && modelsBtn.parentElement && !modal.querySelector('#antigravity-stats-nav-btn')) {
        const parent = modelsBtn.parentElement;

        // DOM stability verification
        if (!parent.contains(modelsBtn)) {
          console.warn('[TokenStats] DOM structure changed during injection scan, deferring...');
          return;
        }

        const statsBtn = document.createElement('button');
        statsBtn.id = 'antigravity-stats-nav-btn';
        statsBtn.className = 'flex items-center gap-1.5 group w-full px-2 py-1 rounded-lg cursor-pointer border-none text-left transition-all outline-none hover:bg-sidebar-muted';
        statsBtn.innerHTML = `
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-secondary-foreground group-hover:text-foreground shrink-0">
            <line x1="18" y1="20" x2="18" y2="10"></line>
            <line x1="12" y1="20" x2="12" y2="4"></line>
            <line x1="6" y1="20" x2="6" y2="14"></line>
          </svg>
          <span class="transition-colors select-none truncate flex-1 text-secondary-foreground group-hover:text-foreground">Usage Stats</span>
        `;

        // Final verification before insertion (prevent async React re-renders)
        if (!parent.contains(modelsBtn) || modal.querySelector('#antigravity-stats-nav-btn')) {
          console.warn('[TokenStats] DOM changed before button insertion, skipping this cycle');
          return;
        }

        modelsBtn.after(statsBtn);

        // Accurately locate the true global two-column split container in the Settings modal (width > 400px)
        let splitContainer: HTMLElement | null = null;
        let rightContentPanel: HTMLElement | null = null;
        let curr: HTMLElement | null = parent;
        while (curr && curr !== modal) {
          const p: HTMLElement | null = curr.parentElement;
          if (p && p.children.length === 2 && p.children[0].contains(modelsBtn)) {
            if (p.offsetWidth > 400 || (p.children[1] as HTMLElement).offsetWidth > 300) {
              splitContainer = p;
              rightContentPanel = p.children[1] as HTMLElement;
              break;
            }
          }
          curr = p;
        }

        statsBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();

          // Mark active on Stats tab, de-activate others
          modal.querySelectorAll('button').forEach((btn) => {
            if (btn.classList.contains('bg-sidebar-secondary')) {
              btn.classList.remove('bg-sidebar-secondary');
              btn.classList.add('hover:bg-sidebar-muted');
              const span = btn.querySelector('span');
              if (span) {
                span.classList.remove('text-foreground');
                span.classList.add('text-secondary-foreground');
              }
            }
          });
          statsBtn.classList.add('bg-sidebar-secondary');
          statsBtn.classList.remove('hover:bg-sidebar-muted');
          const statsSpan = statsBtn.querySelector('span');
          if (statsSpan) {
            statsSpan.classList.add('text-foreground');
            statsSpan.classList.remove('text-secondary-foreground');
          }

          // Swap right content with Stats view
          if (rightContentPanel && splitContainer) {
            const overlayScrollbar = rightContentPanel.querySelector('[data-testid="overlay-scrollbar"]');
            const viewport = (overlayScrollbar
              ? overlayScrollbar.previousElementSibling
              : rightContentPanel.querySelector('.overflow-auto, .overflow-y-auto')) as HTMLElement | null;
            const panelsContainer = (viewport?.firstElementChild || rightContentPanel.querySelector('.grow.w-full')) as HTMLElement | null;

            if (panelsContainer) {
              // Primary path: reuse official ScrollArea & Viewport
              rightContentPanel.style.display = '';

              Array.from(panelsContainer.children).forEach((child) => {
                if (child.id !== 'antigravity-stats-settings-content') {
                  (child as HTMLElement).style.display = 'none';
                }
              });

              let statsContainer = document.getElementById('antigravity-stats-settings-content');
              if (!statsContainer) {
                statsContainer = document.createElement('div');
                statsContainer.id = 'antigravity-stats-settings-content';
                statsContainer.className = 'w-full min-h-0 bg-background text-foreground antialiased';
                panelsContainer.appendChild(statsContainer);
              } else if (statsContainer.parentElement !== panelsContainer) {
                panelsContainer.appendChild(statsContainer);
              }
              statsContainer.style.cssText = 'display: block; width: 100%;';
              syncThemeToElement(statsContainer);
              mountStats(statsContainer);
            } else {
              // Defensive fallback: mount into splitContainer if official viewport structure is absent
              rightContentPanel.style.display = 'none';

              let statsContainer = document.getElementById('antigravity-stats-settings-content');
              if (!statsContainer) {
                statsContainer = document.createElement('div');
                statsContainer.id = 'antigravity-stats-settings-content';
                statsContainer.className = 'flex-1 h-full min-h-0 overflow-y-auto bg-background text-foreground antialiased';
                statsContainer.style.cssText = 'flex: 1 1 0%; min-width: 0; height: 100%; overflow-y: auto;';
                splitContainer.appendChild(statsContainer);
              }
              syncThemeToElement(statsContainer);
              statsContainer.style.display = 'block';
              mountStats(statsContainer);
            }
          }
        });

        // Restore rightContentPanel when other tabs clicked — rebound (not stacked) on
        // every re-injection so each host button keeps exactly one live-closure handler.
        modal.querySelectorAll('button').forEach((btn) => {
          if (btn.id === 'antigravity-stats-nav-btn') return;
          const previous = navRestoreListeners.get(btn);
          if (previous) btn.removeEventListener('click', previous);
          const restore = () => {
            statsBtn.classList.remove('bg-sidebar-secondary');
            statsBtn.classList.add('hover:bg-sidebar-muted');
            const statsSpan = statsBtn.querySelector('span');
            if (statsSpan) {
              statsSpan.classList.remove('text-foreground');
              statsSpan.classList.add('text-secondary-foreground');
            }

            const statsContainer = document.getElementById('antigravity-stats-settings-content');
            if (statsContainer) {
              const hostPanelsParent = statsContainer.parentElement;
              statsContainer.style.display = 'none';
              unmountStats();
              if (hostPanelsParent && hostPanelsParent !== splitContainer) {
                Array.from(hostPanelsParent.children).forEach((child) => {
                  if (child.id !== 'antigravity-stats-settings-content') {
                    (child as HTMLElement).style.display = '';
                  }
                });
              }
            }
            if (rightContentPanel) {
              rightContentPanel.style.display = '';
            }
          };
          btn.addEventListener('click', restore);
          navRestoreListeners.set(btn, restore);
        });
      }
    }

    // Ensure any leftover sidebar button is removed
    const existingSidebarBtn = document.getElementById('antigravity-stats-sidebar-btn');
    if (existingSidebarBtn) {
      existingSidebarBtn.remove();
    }

    // 2. Hook into Turbo button in every chat input footer (Status Bar); skipped
    // entirely (no container, no heartbeat) when the feature is switched off.
    if (!isStatsFeatureEnabled('statusBar')) return;
    const turboButtons: HTMLElement[] = typeof document.querySelectorAll === 'function'
      ? Array.from(document.querySelectorAll('button[data-testid="permissions-selector-trigger"]')) as HTMLElement[]
      : [document.querySelector('button[data-testid="permissions-selector-trigger"]') as HTMLElement | null].filter(
          (el): el is HTMLElement => Boolean(el)
        );

    for (const turboBtn of turboButtons) {
      if (turboBtn && turboBtn.parentElement) {
        const parent = turboBtn.parentElement;
        if (parent.contains(turboBtn)) {
          let container = parent.querySelector(`#${CONTAINER_STATUSBAR_ID}, [data-ag-statusbar="true"]`) as HTMLElement | null;
          if (!container) {
            container = document.createElement('div');
            container.id = CONTAINER_STATUSBAR_ID;
            container.setAttribute('data-ag-statusbar', 'true');
            container.className = 'antigravity-statusbar-slot relative inline-flex items-center';
            turboBtn.before(container);
          }
          const sessionId = resolveSessionIdForContainer(container);
          if (sessionId && !window.__ANTIGRAVITY_STATS__?.sessions?.[sessionId]) {
            requestDataSync(sessionId);
          }
          mountStatusBar(container);
          startContextPillHeartbeat();
        }
      }
    }
  };

  if (!document.getElementById('antigravity-pill-keyframes')) {
    const style = document.createElement('style');
    style.id = 'antigravity-pill-keyframes';
    style.textContent = `
      @keyframes antigravity-pill-spin {
        0% { transform: rotate(-90deg); }
        100% { transform: rotate(270deg); }
      }
    `;
    document.head.appendChild(style);
  }

  const prevListeners = window.__ANTIGRAVITY_STATS_LISTENER__;
  if (prevListeners && typeof prevListeners === 'object') {
    window.removeEventListener(EVENT_STATS_UPDATED, prevListeners.onStatsUpdated);
    window.removeEventListener(EVENT_LANGUAGE_CHANGED, prevListeners.onLanguageChanged);
    window.removeEventListener('focus', prevListeners.onFocus);
    prevListeners.disposeQuotaUpdates?.();
  }

  const onStatsUpdated: EventListener = () => {
    refreshStatusBar();
  };
  // Host UI translation follows the stats UI language. The guard stops the echo
  // loop: antigravityI18n.setLanguage re-dispatches this same event.
  const onLanguageChanged: EventListener = (e) => {
    const detail = (e as CustomEvent<{ lang?: string }>).detail;
    if (detail?.lang && antigravityI18n.getLanguage() !== detail.lang) {
      antigravityI18n.setLanguage(detail.lang as 'en' | 'zh');
    }
  };
  const onFocus: EventListener = () => {
    const activeIds = getActiveSessionIds(getAllStatusBarContainers());
    if (activeIds.length > 0) {
      for (const sessionId of activeIds) requestDataSync(sessionId);
    } else {
      requestDataSync(getCurrentConversationId());
    }
  };

  window.addEventListener(EVENT_STATS_UPDATED, onStatsUpdated);
  window.addEventListener(EVENT_LANGUAGE_CHANGED, onLanguageChanged);
  window.addEventListener('focus', onFocus);
  window.__ANTIGRAVITY_STATS_LISTENER__ = { onStatsUpdated, onLanguageChanged, onFocus, disposeQuotaUpdates: startQuotaUpdates() };

  const debouncedScanAndInject = () => {
    if (window.__ANTIGRAVITY_SCAN_TIMER__) clearTimeout(window.__ANTIGRAVITY_SCAN_TIMER__);
    window.__ANTIGRAVITY_SCAN_TIMER__ = setTimeout(() => {
      window.__ANTIGRAVITY_SCAN_TIMER__ = null;
      checkConversationRoute();
      scanAndInject();
    }, 60);
  };

  const observer = new MutationObserver(debouncedScanAndInject);
  window.__ANTIGRAVITY_OBSERVER__ = observer;
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-vscode-theme-kind'] });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-vscode-theme-kind'] });

  // Start UI translation if Chinese is selected
  if (antigravityI18n.getLanguage() === 'zh') {
    antigravityI18n.start();
  }

  // Run immediate scan on load
  scanAndInject();
}

export const mount = mountStats;
export const unmount = unmountStats;
export const init = initAntigravitySettingsInjector;
export const i18n = antigravityI18n;

// Automatically initialize when loaded into the renderer
if (typeof window !== 'undefined') {
  const api = {
    mount: mountStats,
    mountStats,
    unmount: unmountStats,
    unmountStats,
    init: initAntigravitySettingsInjector,
    initAntigravitySettingsInjector,
    i18n: antigravityI18n,
    mountStatusBar,
    unmountStatusBar,
    refreshStatusBar,
  };
  window.AntigravityStats = api;
  // Delay assignment after module evaluation in case Rollup re-assigns global
  setTimeout(() => {
    if (window.AntigravityStats) {
      Object.assign(window.AntigravityStats, api);
    }
  }, 0);
  initAntigravitySettingsInjector();
}
