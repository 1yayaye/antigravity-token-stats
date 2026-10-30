import React from 'react';
import ReactDOM from 'react-dom/client';
import '../../../src/index.css';
import { StatsView } from '../../../src/components/stats/StatsView';
import { LanguageProvider } from '../../../src/i18n/LanguageContext';
import { detectAntigravityTheme, syncThemeToElement } from '../../../src/services/stats-service';
import { antigravityI18n } from './i18n/antigravity-ui-i18n';
import { DshStatusBar } from '../../../src/components/dsh/DshStatusBar';
import type { DshHostStyle } from '../../../src/components/dsh/DshStatusBar';
import type { DshTelemetryData } from '../../../src/types/dsh-telemetry';
import { CONTAINER_STATUSBAR_ID, EVENT_LANGUAGE_CHANGED, EVENT_REQUEST_SYNC, EVENT_STATS_UPDATED, IPC_REQUEST_SYNC, WINDOW_SYNC_BRIDGE } from '../../../src/injection-contract.cjs';
import '../../../src/domain/stats.types';

let activeContainer: HTMLElement | null = null;
let isMounting = false;

// Standalone injector for Antigravity 2.0 with debouncing & error guards
export function mountStats(container: HTMLElement) {
  if (!container) return;

  if (isMounting) return;
  isMounting = true;

  try {
    const theme = syncThemeToElement(container);
    const existingRoot = window.__ANTIGRAVITY_STATS_ROOT__;
    if (existingRoot && activeContainer === container) {
      existingRoot.render(
        <React.StrictMode>
          <LanguageProvider>
            <div className={`w-full h-full min-h-[500px] antigravity-stats-container ${theme}`}>
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
          <div className={`w-full h-full min-h-[500px] antigravity-stats-container ${theme}`}>
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
  document.querySelectorAll('#antigravity-context-popover, #antigravity-dsh-popover-container').forEach(el => el.remove());
}

export function getCurrentConversationId(): string | null {
  if (typeof window === 'undefined') return null;
  const match = window.location.pathname.match(/\/c\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

let lastSyncRequestTime = 0;
export function requestDataSync(sessionId?: string | null) {
  const targetSessionId = sessionId || getCurrentConversationId();
  const now = Date.now();
  if (now - lastSyncRequestTime < 100) return; // 100ms throttle
  lastSyncRequestTime = now;

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
export function checkGenerationState(): boolean {
  if (typeof document === 'undefined') return false;
  return Boolean(document.querySelector(
    'button[aria-label*="Cancel"], button[aria-label*="Stop"], button[aria-label="取消"], button[aria-label="停止"]'
  ));
}

// A new conversation has no stats entry, and the host pushes nothing until its first model call
// lands. This heartbeat re-reads the active session once per second, independent of any event.
const PILL_HEARTBEAT_MS = 1000;
let pillHeartbeat: ReturnType<typeof setInterval> | null = null;

// Probe the host's own control styling so the injected pills inherit the same text
// color, size and weight as native Antigravity controls (e.g. the Turbo dropdown).
// Every field is optional — when the host DOM isn't ready the pills fall back to
// their own --dsh-* tokens.
function probeHostPillStyle(): DshHostStyle {
  const probe: DshHostStyle = {};
  try {
    const anchor = document.querySelector('button[data-testid="permissions-selector-trigger"]');
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

export function mountDshStatusBar(container: HTMLElement) {
  if (!container) return;

  const sessionId = getCurrentConversationId();
  const stats = window.__ANTIGRAVITY_STATS__;
  const session = sessionId && stats?.sessions ? stats.sessions[sessionId] : null;
  const isGenerating = Boolean(session?.isRunning) || (Boolean(sessionId) && checkGenerationState());

  const promptTokens = session ? session.promptTokens : 0;
  const totalInput = session?.totalInputTokens || 0;
  const totalCache = session?.totalCacheReadTokens || 0;
  const totalOutput = session?.totalOutputTokens || 0;
  const totalTokens = session?.totalTokens || (totalInput + totalCache + totalOutput);

  const billedInput = totalInput + totalCache;
  let cacheHitRatePct: number | null = null;
  if (billedInput > 0) {
    cacheHitRatePct = Math.round((totalCache / billedInput) * 100);
    if (totalInput > 0 && cacheHitRatePct >= 100) cacheHitRatePct = 99;
  }

  const SYSTEM_BASELINE = 8200;
  const TOOLS_BASELINE = 8300;
  const BASELINE_SUM = SYSTEM_BASELINE + TOOLS_BASELINE;
  let systemPromptTokens = 0;
  let toolDefinitionTokens = 0;
  let chatMessageTokens = 0;

  if (promptTokens <= 0) {
    systemPromptTokens = 0;
    toolDefinitionTokens = 0;
    chatMessageTokens = 0;
  } else if (promptTokens < BASELINE_SUM) {
    const scale = promptTokens / BASELINE_SUM;
    systemPromptTokens = Math.round(SYSTEM_BASELINE * scale);
    toolDefinitionTokens = Math.max(0, promptTokens - systemPromptTokens);
    chatMessageTokens = 0;
  } else {
    systemPromptTokens = SYSTEM_BASELINE;
    toolDefinitionTokens = TOOLS_BASELINE;
    chatMessageTokens = Math.max(0, promptTokens - BASELINE_SUM);
  }

  const usedPct = promptTokens > 0 ? Math.min(100, Math.round((promptTokens / 1048576) * 100)) : 0;
  const effectiveTps = session?.tps ?? null;

  const telemetry: DshTelemetryData = session?.dshTelemetry ? {
    ...session.dshTelemetry,
    isStreaming: isGenerating,
    session: {
      ...session.dshTelemetry.session,
      tps: effectiveTps,
    },
  } : {
    sessionId: sessionId || '',
    isStreaming: isGenerating,
    session: {
      rounds: session?.rounds || 1,
      steps: session?.steps || session?.turnsCount || session?.turnCalls || 0,
      tps: effectiveTps,
      modelDurationSec: session?.modelDurationSec || 0,
      toolDurationSec: session?.toolDurationSec || 0,
      ttftSec: session?.ttftSec ?? null,
    },
    token: {
      totalTokens,
      cacheHitRatePct,
      uncachedInputTokens: totalInput,
      cacheReadTokens: totalCache,
      outputTokens: totalOutput,
    },
    context: {
      usedTokens: promptTokens,
      limitTokens: 1048576,
      usedPct,
      systemPromptTokens,
      toolDefinitionTokens,
      chatMessageTokens,
    },
  };

  const theme = detectAntigravityTheme();
  const lang = antigravityI18n.getLanguage();
  const hostStyle = probeHostPillStyle();

  // The heartbeat, mutation scans and sync events all funnel through here every
  // second; skipping no-op renders keeps the host's event loop free enough that
  // popover dismissal stays instant.
  const renderSignature = JSON.stringify([telemetry, theme, lang, hostStyle]);

  if (window.__ANTIGRAVITY_STATUSBAR_ROOT__ && window.__ANTIGRAVITY_STATUSBAR_CONTAINER__ === container && container.isConnected) {
    if (window.__ANTIGRAVITY_STATUSBAR_SIGNATURE__ === renderSignature) return;
    window.__ANTIGRAVITY_STATUSBAR_SIGNATURE__ = renderSignature;
    window.__ANTIGRAVITY_STATUSBAR_ROOT__.render(
      <React.StrictMode>
        <div className={`antigravity-dsh-container ${theme}`}>
          <DshStatusBar
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

  unmountDshStatusBar();

  container.innerHTML = '';
  const root = ReactDOM.createRoot(container);
  window.__ANTIGRAVITY_STATUSBAR_ROOT__ = root;
  window.__ANTIGRAVITY_STATUSBAR_CONTAINER__ = container;
  window.__ANTIGRAVITY_STATUSBAR_SIGNATURE__ = renderSignature;

  root.render(
    <React.StrictMode>
      <div className={`antigravity-dsh-container ${theme}`}>
        <DshStatusBar
          telemetry={telemetry}
          lang={lang}
          theme={theme}
          hostStyle={hostStyle}
        />
      </div>
    </React.StrictMode>
  );
}

export function unmountDshStatusBar() {
  if (window.__ANTIGRAVITY_STATUSBAR_ROOT__) {
    try {
      window.__ANTIGRAVITY_STATUSBAR_ROOT__.unmount();
    } catch (e) {
      console.warn('[TokenStats] Error unmounting status bar root:', e);
    }
    window.__ANTIGRAVITY_STATUSBAR_ROOT__ = null;
  }
  window.__ANTIGRAVITY_STATUSBAR_CONTAINER__ = null;
}

export function refreshStatusBar() {
  const container = document.getElementById(CONTAINER_STATUSBAR_ID);
  if (container) {
    mountDshStatusBar(container);
  }
}

function refreshContextPill() {
  const container = document.getElementById(CONTAINER_STATUSBAR_ID) || document.getElementById('antigravity-context-usage-pill');
  if (!container) {
    if (pillHeartbeat) clearInterval(pillHeartbeat);
    pillHeartbeat = null;
    return;
  }
  const sessionId = getCurrentConversationId();
  if (sessionId) requestDataSync(sessionId);
  refreshStatusBar();
}

export function startContextPillHeartbeat() {
  if (pillHeartbeat) return;
  pillHeartbeat = setInterval(refreshContextPill, PILL_HEARTBEAT_MS);
}

let lastKnownConversationId: string | null = null;
export function checkConversationRoute() {
  const current = getCurrentConversationId();
  if (current !== lastKnownConversationId) {
    lastKnownConversationId = current;
    requestDataSync(current);
    refreshStatusBar();
  }
}

// Auto-injection DOM observer for Antigravity 2.0 Settings Modal & Sidebar Shortcut
export function initAntigravitySettingsInjector() {
  if (window.__ANTIGRAVITY_OBSERVER__) {
    window.__ANTIGRAVITY_OBSERVER__.disconnect();
    window.__ANTIGRAVITY_OBSERVER__ = null;
  }
  unmountStats();
  unmountDshStatusBar();

  // Clean up any stale misplaced containers, buttons, toasts and modal overlays
  // from prior injections (older bundles exposed a floating dashboard + toast).
  document.querySelectorAll('#antigravity-stats-nav-btn, #antigravity-stats-sidebar-btn, #antigravity-stats-content, #antigravity-stats-settings-content, #antigravity-stats-modal-overlay, #antigravity-stats-toast, #antigravity-context-usage-pill, #antigravity-dsh-statusbar-container, #antigravity-dsh-popover-container').forEach(el => el.remove());

  const scanAndInject = () => {
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
        statsBtn.className = 'flex items-center gap-1.5 group mx-2 px-2 py-1 rounded-lg cursor-pointer border-none text-left transition-all outline-none hover:bg-sidebar-muted';
        statsBtn.innerHTML = `
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-secondary-foreground group-hover:text-foreground shrink-0">
            <line x1="18" y1="20" x2="18" y2="10"></line>
            <line x1="12" y1="20" x2="12" y2="4"></line>
            <line x1="6" y1="20" x2="6" y2="14"></line>
          </svg>
          <span class="text-sm transition-colors select-none truncate flex-1 text-secondary-foreground group-hover:text-foreground">Usage Stats</span>
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
        });

        // Restore rightContentPanel when other tabs clicked
        const allNavButtons = modal.querySelectorAll('button');
        allNavButtons.forEach((btn) => {
          if (btn.id !== 'antigravity-stats-nav-btn') {
            btn.addEventListener('click', () => {
              statsBtn.classList.remove('bg-sidebar-secondary');
              statsBtn.classList.add('hover:bg-sidebar-muted');
              const statsSpan = statsBtn.querySelector('span');
              if (statsSpan) {
                statsSpan.classList.remove('text-foreground');
                statsSpan.classList.add('text-secondary-foreground');
              }

              const statsContainer = document.getElementById('antigravity-stats-settings-content');
              if (statsContainer) {
                statsContainer.style.display = 'none';
                unmountStats();
              }
              if (rightContentPanel) {
                rightContentPanel.style.display = '';
              }
            });
          }
        });
      }
    }

    // Ensure any leftover sidebar button is removed
    const existingSidebarBtn = document.getElementById('antigravity-stats-sidebar-btn');
    if (existingSidebarBtn) {
      existingSidebarBtn.remove();
    }

    // 2. Hook into Turbo button in the chat input footer (DSH Status Bar)
    const turboBtn = document.querySelector('button[data-testid="permissions-selector-trigger"]') as HTMLElement | null;
    if (turboBtn && turboBtn.parentElement) {
      const parent = turboBtn.parentElement;
      if (parent.contains(turboBtn)) {
        let container = parent.querySelector(`#${CONTAINER_STATUSBAR_ID}`) as HTMLElement | null;
        if (!container) {
          container = document.createElement('div');
          container.id = CONTAINER_STATUSBAR_ID;
          container.className = 'relative inline-flex items-center';
          turboBtn.before(container);
        }
        mountDshStatusBar(container);
        startContextPillHeartbeat();
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

  if (!window.__ANTIGRAVITY_STATS_LISTENER__) {
    window.__ANTIGRAVITY_STATS_LISTENER__ = true;
    window.addEventListener(EVENT_STATS_UPDATED, () => {
      refreshStatusBar();
    });

    // Host UI translation follows the stats UI language. The guard stops the echo
    // loop: antigravityI18n.setLanguage re-dispatches this same event.
    window.addEventListener(EVENT_LANGUAGE_CHANGED, (e) => {
      const detail = (e as CustomEvent<{ lang?: string }>).detail;
      if (detail?.lang && antigravityI18n.getLanguage() !== detail.lang) {
        antigravityI18n.setLanguage(detail.lang as 'en' | 'zh');
      }
    });

    window.addEventListener('focus', () => {
      requestDataSync(getCurrentConversationId());
    });
  }

  let scanDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  const debouncedScanAndInject = () => {
    if (scanDebounceTimer) clearTimeout(scanDebounceTimer);
    scanDebounceTimer = setTimeout(() => {
      checkConversationRoute();
      scanAndInject();
    }, 60);
  };

  const observer = new MutationObserver(debouncedScanAndInject);
  window.__ANTIGRAVITY_OBSERVER__ = observer;
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });

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
export const mountStatusBar = mountDshStatusBar;
export const unmountStatusBar = unmountDshStatusBar;

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
    mountStatusBar: mountDshStatusBar,
    mountDshStatusBar,
    unmountStatusBar: unmountDshStatusBar,
    unmountDshStatusBar,
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
