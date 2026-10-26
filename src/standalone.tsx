import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { StatsView } from './components/stats/StatsView';
import { LanguageProvider } from './i18n/LanguageContext';
import { detectAntigravityTheme, syncThemeToElement } from './services/stats-service';
import { antigravityI18n } from './i18n/antigravity-ui-i18n';
import './domain/stats.types';

let toastTimeout: ReturnType<typeof setTimeout> | null = null;
let toastFadeTimeout: ReturnType<typeof setTimeout> | null = null;

// Clean removal of floating Toast
export function removeStatsToast(immediate: boolean = false) {
  if (toastTimeout) {
    clearTimeout(toastTimeout);
    toastTimeout = null;
  }
  if (toastFadeTimeout) {
    clearTimeout(toastFadeTimeout);
    toastFadeTimeout = null;
  }
  const existingToast = document.getElementById('antigravity-stats-toast');
  if (existingToast) {
    if (immediate) {
      existingToast.remove();
      return;
    }
    existingToast.style.opacity = '0';
    existingToast.style.transform = 'translateY(-6px) scale(0.96)';
    existingToast.style.pointerEvents = 'none';
    toastFadeTimeout = setTimeout(() => {
      existingToast.remove();
    }, 250);
  }
}

// Non-intrusive floating Toast notification (Antigravity 2.0 Glassmorphism)
export function showStatsToast(message: string = '✦ Token Stats & 汉化增强已就绪', durationMs: number = 4000) {
  if (toastTimeout) clearTimeout(toastTimeout);
  if (toastFadeTimeout) clearTimeout(toastFadeTimeout);
  const oldToast = document.getElementById('antigravity-stats-toast');
  if (oldToast) oldToast.remove();

  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  const shortcutLabel = isMac ? '⌥T' : 'Alt+T';

  const toast = document.createElement('div');
  toast.id = 'antigravity-stats-toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 999999;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    border-radius: 12px;
    background-color: rgba(18, 20, 26, 0.92);
    backdrop-filter: blur(24px) saturate(180%);
    -webkit-backdrop-filter: blur(24px) saturate(180%);
    border: 1px solid rgba(255, 255, 255, 0.12);
    box-shadow: 0 16px 36px -8px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.06);
    color: #f1f4f9;
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 13px;
    cursor: pointer;
    user-select: none;
    opacity: 0;
    transform: translateY(-8px) scale(0.96);
    transition: opacity 0.25s cubic-bezier(0.16, 1, 0.3, 1), transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  `;

  toast.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 8px; background: rgba(59, 130, 246, 0.15); border: 1px solid rgba(96, 165, 250, 0.3); color: #60a5fa; flex-shrink: 0; position: relative;">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="20" x2="18" y2="10"></line>
        <line x1="12" y1="20" x2="12" y2="4"></line>
        <line x1="6" y1="20" x2="6" y2="14"></line>
      </svg>
      <span style="position: absolute; top: -2px; right: -2px; width: 6px; height: 6px; border-radius: 9999px; background-color: #10b981; box-shadow: 0 0 6px #10b981;"></span>
    </div>
    <div style="display: flex; flex-direction: column; gap: 1px; min-width: 0;">
      <span data-toast-message style="font-weight: 600; color: #f1f4f9; letter-spacing: -0.01em; white-space: nowrap;"></span>
      <span style="font-size: 11px; color: #94a3b8; letter-spacing: 0.01em; white-space: nowrap;">按 <kbd style="font-family: inherit; padding: 1px 4px; border-radius: 4px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.12); color: #cbd5e1;">${shortcutLabel}</kbd> 或点击查看看板</span>
    </div>
    <button id="antigravity-stats-toast-close" style="margin-left: 6px; display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 6px; border: none; background: transparent; color: rgba(255,255,255,0.4); cursor: pointer; padding: 0; outline: none; transition: color 0.15s, background-color 0.15s;" title="关闭">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    </button>
  `;
  const messageNode = toast.querySelector('[data-toast-message]');
  if (messageNode) messageNode.textContent = message;

  toast.addEventListener('click', (e) => {
    const closeBtn = toast.querySelector('#antigravity-stats-toast-close');
    if (closeBtn && (e.target === closeBtn || closeBtn.contains(e.target as Node))) {
      e.stopPropagation();
      removeStatsToast();
      return;
    }
    removeStatsToast(true);
    openStatsModal();
  });

  const closeBtn = toast.querySelector('#antigravity-stats-toast-close') as HTMLElement | null;
  if (closeBtn) {
    closeBtn.addEventListener('mouseenter', () => {
      closeBtn.style.color = '#ffffff';
      closeBtn.style.backgroundColor = 'rgba(255,255,255,0.1)';
    });
    closeBtn.addEventListener('mouseleave', () => {
      closeBtn.style.color = 'rgba(255,255,255,0.4)';
      closeBtn.style.backgroundColor = 'transparent';
    });
  }

  toast.addEventListener('mouseenter', () => {
    if (toastTimeout) {
      clearTimeout(toastTimeout);
      toastTimeout = null;
    }
  });
  toast.addEventListener('mouseleave', () => {
    if (!toastTimeout) {
      toastTimeout = setTimeout(() => {
        removeStatsToast();
      }, 2000);
    }
  });

  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0) scale(1)';
  });

  toastTimeout = setTimeout(() => {
    removeStatsToast();
  }, durationMs);
}

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

// Standalone Modal for direct Sidebar / Shortcut access
export function openStatsModal() {
  removeStatsToast(true);

  // Clean any existing modal overlays and unmount prior root
  unmountStats();
  document.querySelectorAll('#antigravity-stats-modal-overlay').forEach(el => el.remove());

  const theme = detectAntigravityTheme();
  const isDark = theme === 'dark';

  const modalOverlay = document.createElement('div');
  modalOverlay.id = 'antigravity-stats-modal-overlay';
  modalOverlay.className = `fixed inset-0 z-[999999] flex items-center justify-center p-6 animate-fadeIn ${theme}`;
  modalOverlay.style.cssText = `position: fixed; inset: 0; z-index: 999999; display: flex; align-items: center; justify-content: center; background-color: ${isDark ? 'rgba(0, 0, 0, 0.65)' : 'rgba(0, 0, 0, 0.35)'}; backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);`;

  const modalContainer = document.createElement('div');
  modalContainer.className = `w-full max-w-5xl h-[88vh] max-h-[880px] overflow-hidden flex flex-col relative rounded-2xl shadow-2xl text-foreground ${theme}`;
  modalContainer.style.cssText = isDark
    ? 'width: 100%; max-width: 1060px; height: 88vh; max-height: 880px; display: flex; flex-direction: column; position: relative; border-radius: 16px; overflow: hidden; background-color: rgba(18, 20, 26, 0.94); backdrop-filter: blur(32px) saturate(180%); -webkit-backdrop-filter: blur(32px) saturate(180%); border: 1px solid rgba(255, 255, 255, 0.12); box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.08);'
    : 'width: 100%; max-width: 1060px; height: 88vh; max-height: 880px; display: flex; flex-direction: column; position: relative; border-radius: 16px; overflow: hidden; background-color: rgba(255, 255, 255, 0.96); backdrop-filter: blur(32px) saturate(180%); -webkit-backdrop-filter: blur(32px) saturate(180%); border: 1px solid rgba(0, 0, 0, 0.12); box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.25);';

  const closeBtn = document.createElement('button');
  closeBtn.className = `transition-colors cursor-pointer border-none bg-transparent outline-none flex items-center justify-center shrink-0 w-9 h-9 rounded-lg absolute z-30 top-4 right-4 ${
    isDark ? 'text-white/70 hover:text-white hover:bg-white/10' : 'text-black/60 hover:text-black hover:bg-black/10'
  }`;
  closeBtn.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
  `;
  closeBtn.title = 'Close (Esc)';
  closeBtn.addEventListener('click', closeStatsModal);

  const contentArea = document.createElement('div');
  contentArea.id = 'antigravity-stats-modal-content';
  contentArea.className = 'flex-1 min-h-0 w-full';

  modalContainer.appendChild(closeBtn);
  modalContainer.appendChild(contentArea);
  modalOverlay.appendChild(modalContainer);

  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeStatsModal();
  });

  document.body.appendChild(modalOverlay);
  mountStats(contentArea);
}

export function closeStatsModal() {
  unmountStats();
  document.querySelectorAll('#antigravity-stats-modal-overlay').forEach(el => el.remove());

  // Re-mount Settings inline view if Settings modal is still open on the Usage Stats tab
  const settingsModal = document.querySelector('.settings-modal-container');
  const settingsContainer = document.getElementById('antigravity-stats-settings-content');
  if (settingsModal && settingsContainer && settingsContainer.style.display !== 'none') {
    mountStats(settingsContainer);
  }
}

let activePopoverEl: HTMLElement | null = null;
let popoverHideTimeout: ReturnType<typeof setTimeout> | null = null;

export function removeContextPopover() {
  if (popoverHideTimeout) {
    clearTimeout(popoverHideTimeout);
    popoverHideTimeout = null;
  }
  if (activePopoverEl) {
    activePopoverEl.remove();
    activePopoverEl = null;
  }
  document.querySelectorAll('#antigravity-context-popover').forEach(el => el.remove());
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
  if (typeof window !== 'undefined' && window.__ANTIGRAVITY_SYNC_BRIDGE__ && typeof window.__ANTIGRAVITY_SYNC_BRIDGE__.requestSync === 'function') {
    window.__ANTIGRAVITY_SYNC_BRIDGE__.requestSync({ sessionId: targetSessionId }).catch(() => {});
  }
  // Tier 2: Direct Electron IPC if available
  else if (typeof window !== 'undefined' && typeof window.require === 'function') {
    try {
      const electron = window.require('electron');
      if (electron?.ipcRenderer) {
        electron.ipcRenderer.invoke('antigravity:request-sync', { sessionId: targetSessionId }).catch(() => {});
      }
    } catch {}
  }
  // Tier 3: Event fallback
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('antigravity:request-sync', { detail: { sessionId: targetSessionId } }));
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

function refreshContextPill() {
  const pill = document.getElementById('antigravity-context-usage-pill');
  if (!pill) {
    if (pillHeartbeat) clearInterval(pillHeartbeat);
    pillHeartbeat = null;
    return;
  }
  const sessionId = getCurrentConversationId();
  updateContextPillContent(pill, sessionId);
  if (sessionId) requestDataSync(sessionId);
  const btn = pill.querySelector('button') as HTMLButtonElement | null;
  if (btn && activePopoverEl) renderContextPopover(btn, detectAntigravityTheme() === 'dark');
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
  }
}

function scheduleHidePopover() {
  if (popoverHideTimeout) clearTimeout(popoverHideTimeout);
  popoverHideTimeout = setTimeout(() => {
    const popover = document.getElementById('antigravity-context-popover');
    if (popover) {
      popover.style.opacity = '0';
      popover.style.transform = 'translateY(6px)';
      popover.style.pointerEvents = 'none';
      setTimeout(() => {
        if (popover && popover.style.opacity === '0') {
          popover.remove();
          activePopoverEl = null;
        }
      }, 200);
    }
  }, 150);
}

function renderContextPopover(btn: HTMLButtonElement, isDark: boolean) {
  if (popoverHideTimeout) {
    clearTimeout(popoverHideTimeout);
    popoverHideTimeout = null;
  }

  let popover = document.getElementById('antigravity-context-popover') as HTMLElement | null;
  if (!popover) {
    popover = document.createElement('div');
    popover.id = 'antigravity-context-popover';
    document.body.appendChild(popover);
  }
  activePopoverEl = popover;

  const rect = btn.getBoundingClientRect();
  const sessionId = getCurrentConversationId();
  const stats = window.__ANTIGRAVITY_STATS__;
  const session = sessionId && stats?.sessions ? stats.sessions[sessionId] : null;

  const isGenerating = Boolean(session?.isRunning) || (Boolean(sessionId) && checkGenerationState());
  // Context occupancy is the prompt of the last completed request; a reply still streaming has
  // no usage row yet, so the number holds still while "生成中" is shown.
  const currentTokens = session ? session.promptTokens : 0;
  const isLoading = currentTokens === 0;
  const turnCalls = session?.turnCalls || 0;
  const turnTokens = session?.turnTokens || 0;
  const turnElapsed = isGenerating && session?.turnStartedAt
    ? Math.max(0, Math.round((Date.now() - session.turnStartedAt) / 1000))
    : 0;

  const compactionLimit = session?.compactionLimit || 256000;
  const pct = isLoading ? 0 : Math.min(100, (currentTokens / compactionLimit) * 100);

  let statusColor = '#10b981';
  if (isGenerating) statusColor = '#38bdf8';
  else if (isLoading) statusColor = '#94a3b8';
  else if (pct > 85) statusColor = '#f43f5e';
  else if (pct > 55) statusColor = '#f59e0b';

  const remainingTokens = Math.max(0, compactionLimit - currentTokens);
  const cacheTokens = session ? session.latestCacheRead : 0;
  const inputTokens = session ? session.latestInput : 0;
  const outputTokens = session ? session.latestOutput : 0;
  const thinkingTokens = session ? session.latestThinking : 0;
  const responseTokens = session ? session.latestResponse : 0;
  const cacheRate = currentTokens > 0 ? ((cacheTokens / currentTokens) * 100).toFixed(1) : '0.0';

  const wasOpen = popover.style.opacity === '1';
  popover.style.cssText = `
    position: fixed;
    bottom: ${Math.max(10, window.innerHeight - rect.top + 8)}px;
    right: ${Math.max(10, window.innerWidth - rect.right)}px;
    z-index: 9999999;
    width: 280px;
    border-radius: 12px;
    padding: 14px;
    font-size: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    box-shadow: 0 20px 40px -10px rgba(0, 0, 0, 0.6), 0 0 0 1px ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'};
    background: ${isDark ? 'rgba(24, 26, 32, 0.95)' : 'rgba(255, 255, 255, 0.98)'};
    backdrop-filter: blur(24px) saturate(180%);
    -webkit-backdrop-filter: blur(24px) saturate(180%);
    color: ${isDark ? '#f1f4f9' : '#0f172a'};
    font-family: system-ui, -apple-system, sans-serif;
    opacity: ${wasOpen ? '1' : '0'};
    transform: translateY(${wasOpen ? '0' : '6px'});
    transition: opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1), transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    pointer-events: auto;
  `;

  const tagText = isGenerating ? '生成中' : isLoading ? '等待首次调用' : 'Ground Truth';
  const tagColor = isGenerating ? '#38bdf8' : isLoading ? '#94a3b8' : '#60a5fa';
  const tagBg = isGenerating ? 'rgba(56, 189, 248, 0.12)' : isLoading ? 'rgba(148, 163, 184, 0.12)' : 'rgba(59, 130, 246, 0.12)';
  const tagBorder = isGenerating ? 'rgba(56, 189, 248, 0.25)' : isLoading ? 'rgba(148, 163, 184, 0.25)' : 'rgba(59, 130, 246, 0.25)';

  popover.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: space-between; padding-bottom: 8px; border-bottom: 1px solid ${isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)'};">
      <div style="display: flex; align-items: center; gap: 6px; font-weight: 600;">
        <span style="width: 8px; height: 8px; border-radius: 9999px; background-color: ${statusColor}; box-shadow: 0 0 6px ${statusColor};"></span>
        <span>当前会话上下文详情</span>
      </div>
      <span style="font-size: 10px; padding: 1px 6px; border-radius: 4px; font-family: monospace; background: ${tagBg}; color: ${tagColor}; border: 1px solid ${tagBorder};">${tagText}</span>
    </div>
    <div style="display: flex; flex-direction: column; gap: 6px;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="color: ${isDark ? '#94a3b8' : '#64748b'};">上下文占用 (上次请求)</span>
        <span style="font-family: monospace; font-weight: 600; color: ${isDark ? '#ffffff' : '#0f172a'};">${isLoading ? (isGenerating ? '生成中...' : '等待首次调用') : currentTokens.toLocaleString() + ' Tokens'}</span>
      </div>
      <div style="width: 100%; height: 6px; border-radius: 9999px; overflow: hidden; display: flex; background: ${isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)'};">
        <div style="height: 100%; width: ${pct}%; background-color: ${statusColor}; transition: width 0.3s ease;"></div>
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: ${isDark ? '#94a3b8' : '#64748b'};">
        <span>距离自动压缩 (~256k)</span>
        <span style="font-family: monospace; font-weight: 600; color: ${statusColor};">${isLoading ? '—' : `剩余 ~${(remainingTokens / 1000).toFixed(1)}k (${pct.toFixed(0)}%)`}</span>
      </div>
    </div>
    <div style="border-radius: 8px; padding: 8px 10px; display: flex; flex-direction: column; gap: 5px; font-size: 11px; background: ${isDark ? 'rgba(0, 0, 0, 0.25)' : 'rgba(0, 0, 0, 0.03)'}; border: 1px solid ${isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.05)'};">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="display: flex; align-items: center; gap: 5px; color: ${isDark ? '#94a3b8' : '#64748b'};">
          <span style="width: 6px; height: 6px; border-radius: 9999px; background: #a855f7;"></span>
          Prompt Cache 命中:
        </span>
        <span style="font-family: monospace; color: #c084fc;">${cacheTokens.toLocaleString()} (${cacheRate}%)</span>
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="display: flex; align-items: center; gap: 5px; color: ${isDark ? '#94a3b8' : '#64748b'};">
          <span style="width: 6px; height: 6px; border-radius: 9999px; background: #3b82f6;"></span>
          增量新输入 Input:
        </span>
        <span style="font-family: monospace; color: #60a5fa;">${inputTokens.toLocaleString()}</span>
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="display: flex; align-items: center; gap: 5px; color: ${isDark ? '#94a3b8' : '#64748b'};">
          <span style="width: 6px; height: 6px; border-radius: 9999px; background: #10b981;"></span>
          上次请求输出 (思考 / 回复):
        </span>
        <span style="font-family: monospace; color: #34d399;">${outputTokens.toLocaleString()} (${thinkingTokens} / ${responseTokens})</span>
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center; padding-top: 4px; border-top: 1px dashed ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'};">
        <span style="display: flex; align-items: center; gap: 5px; color: ${isDark ? '#94a3b8' : '#64748b'};">
          <span style="width: 6px; height: 6px; border-radius: 9999px; background: #38bdf8;"></span>
          ${isGenerating ? '本轮累计' : '上轮累计'}:
        </span>
        <span style="font-family: monospace; color: #7dd3fc;">${turnCalls} 次调用 · ${turnTokens.toLocaleString()}${turnElapsed > 0 ? ` · ${turnElapsed}s` : ''}</span>
      </div>
    </div>
    <div style="padding-top: 4px; display: flex; align-items: center; justify-content: space-between; font-size: 10px; border-top: 1px solid ${isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.05)'}; color: ${isDark ? '#64748b' : '#94a3b8'};">
      <span>模型上下文 1M · 自动压缩 256k</span>
      <span>可输入 <kbd style="padding: 1px 4px; border-radius: 4px; font-family: monospace; background: ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}; color: ${isDark ? '#cbd5e1' : '#475569'};">/compact</kbd></span>
    </div>
  `;

  if (!wasOpen) {
    requestAnimationFrame(() => {
      popover!.style.opacity = '1';
      popover!.style.transform = 'translateY(0)';
    });
  }

  popover.onmouseenter = () => {
    if (popoverHideTimeout) {
      clearTimeout(popoverHideTimeout);
      popoverHideTimeout = null;
    }
  };
  popover.onmouseleave = scheduleHidePopover;
}

function ensurePillStructure(pillContainer: HTMLElement, isDark: boolean) {
  let btn = pillContainer.querySelector('button') as HTMLButtonElement | null;
  if (!btn) {
    pillContainer.innerHTML = `
      <button type="button" class="antigravity-pill-btn"
        style="display: flex; cursor: pointer; align-items: center; height: 28px; gap: 6px; border-radius: 9999px; padding-left: 8px; padding-right: 8px; font-size: 12px; color: ${isDark ? '#cbd5e1' : '#475569'}; background: ${isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.04)'}; border: 1px solid ${isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)'}; user-select: none; outline: none; transition: background 0.15s ease, border-color 0.15s ease, box-shadow 0.2s ease; shrink: 0;"
        onmouseover="this.style.background='${isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)'}';"
        onmouseout="this.style.background='${isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.04)'}';">
        <div class="antigravity-pill-icon" style="position: relative; width: 14px; height: 14px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
          <svg width="14" height="14" viewBox="0 0 16 16" style="transform: rotate(-90deg);">
            <circle class="antigravity-pill-bg" cx="8" cy="8" r="6" stroke="${isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)'}" stroke-width="2" fill="none" />
            <circle class="antigravity-pill-fg" cx="8" cy="8" r="6" stroke="#10b981" stroke-width="2" stroke-linecap="round" fill="none"
              stroke-dasharray="37.7" stroke-dashoffset="37.7"
              style="transition: stroke-dashoffset 0.25s ease, stroke 0.25s ease;" />
          </svg>
        </div>
        <span class="antigravity-pill-text" style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 11px; font-weight: 600; letter-spacing: -0.01em; color: ${isDark ? '#f1f4f9' : '#0f172a'};">--</span>
      </button>
    `;
    btn = pillContainer.querySelector('button') as HTMLButtonElement;
    btn.onmouseenter = () => renderContextPopover(btn!, detectAntigravityTheme() === 'dark');
    btn.onmouseleave = scheduleHidePopover;
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      removeContextPopover();
      openStatsModal();
    };
  }

  const iconDiv = btn.querySelector('.antigravity-pill-icon') as HTMLDivElement;
  const bgCircle = btn.querySelector('.antigravity-pill-bg') as SVGCircleElement;
  const progressCircle = btn.querySelector('.antigravity-pill-fg') as SVGCircleElement;
  const textSpan = btn.querySelector('.antigravity-pill-text') as HTMLSpanElement;

  return { btn, iconDiv, bgCircle, progressCircle, textSpan };
}

export function updateContextPillContent(pillContainer: HTMLElement, sessionId: string | null) {
  const stats = window.__ANTIGRAVITY_STATS__;
  const session = sessionId && stats?.sessions ? stats.sessions[sessionId] : null;

  const isGenerating = Boolean(session?.isRunning) || (Boolean(sessionId) && checkGenerationState());
  // Exact value of the last completed request; no extrapolation while the next one streams.
  const currentTokens = session ? session.promptTokens : 0;
  const isLoading = currentTokens === 0;

  const compactionLimit = session?.compactionLimit || 256000;
  const pct = isLoading ? 0 : Math.min(100, (currentTokens / compactionLimit) * 100);

  let statusColor = '#10b981'; // emerald (<55%)
  if (isGenerating) {
    statusColor = '#38bdf8'; // sky blue while a call is in flight
  } else if (isLoading) {
    statusColor = '#94a3b8'; // muted gray, nothing completed yet
  } else if (pct > 85) {
    statusColor = '#f43f5e'; // rose (>85%)
  } else if (pct > 55) {
    statusColor = '#f59e0b'; // amber (55%-85%)
  }

  const radius = 6;
  const circumference = 2 * Math.PI * radius; // 37.6991
  const strokeDashoffset = isLoading ? circumference : circumference - (pct / 100) * circumference;

  const displayTokens = isLoading
    ? '--'
    : currentTokens < 1000
      ? `${currentTokens}`
      : currentTokens < 1000000
        ? `${(currentTokens / 1000).toFixed(1)}k`
        : `${(currentTokens / 1000000).toFixed(2)}M`;

  const isDark = detectAntigravityTheme() === 'dark';
  const { btn, iconDiv, progressCircle, textSpan } = ensurePillStructure(pillContainer, isDark);

  const ariaLabel = `会话上下文用量: ${displayTokens}${isGenerating ? ' (生成中)' : ''}`;
  if (btn.getAttribute('aria-label') !== ariaLabel) {
    btn.setAttribute('aria-label', ariaLabel);
  }

  if (textSpan.textContent !== displayTokens) {
    textSpan.textContent = displayTokens;
  }

  const targetDasharray = isLoading ? '3, 3' : circumference.toFixed(1);
  if (progressCircle.getAttribute('stroke-dasharray') !== targetDasharray) {
    progressCircle.setAttribute('stroke-dasharray', targetDasharray);
  }

  const targetOffset = strokeDashoffset.toFixed(1);
  if (progressCircle.getAttribute('stroke-dashoffset') !== targetOffset) {
    progressCircle.setAttribute('stroke-dashoffset', targetOffset);
  }

  if (progressCircle.getAttribute('stroke') !== statusColor) {
    progressCircle.setAttribute('stroke', statusColor);
  }

  if (isGenerating) {
    iconDiv.style.animation = 'antigravity-pill-spin 3s linear infinite';
    btn.style.borderColor = isDark ? 'rgba(56, 189, 248, 0.4)' : 'rgba(14, 165, 233, 0.4)';
    btn.style.boxShadow = '0 0 6px rgba(56, 189, 248, 0.15)';
  } else {
    iconDiv.style.animation = 'none';
    btn.style.borderColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)';
    btn.style.boxShadow = 'none';
  }
}

// Auto-injection DOM observer for Antigravity 2.0 Settings Modal & Sidebar Shortcut
export function initAntigravitySettingsInjector() {
  if (window.__ANTIGRAVITY_OBSERVER__) {
    window.__ANTIGRAVITY_OBSERVER__.disconnect();
    window.__ANTIGRAVITY_OBSERVER__ = null;
  }
  unmountStats();

  // Clean up any stale misplaced containers, buttons, and toasts from prior injections
  document.querySelectorAll('#antigravity-stats-nav-btn, #antigravity-stats-sidebar-btn, #antigravity-stats-content, #antigravity-stats-settings-content, #antigravity-stats-modal-overlay, #antigravity-stats-toast, #antigravity-context-usage-pill').forEach(el => el.remove());

  // Listen for Esc key to close modal & Alt+T to toggle
  if (window.__ANTIGRAVITY_KEY_HANDLER__) {
    try { window.removeEventListener('keydown', window.__ANTIGRAVITY_KEY_HANDLER__); } catch (e) {}
    window.__ANTIGRAVITY_KEY_HANDLER__ = null;
  }
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeStatsModal();
      removeStatsToast(true);
    }
    // Shortcut Alt+T to toggle Stats
    if (e.altKey && e.key.toLowerCase() === 't') {
      e.preventDefault();
      const existingOverlay = document.getElementById('antigravity-stats-modal-overlay');
      if (existingOverlay) {
        closeStatsModal();
      } else {
        openStatsModal();
      }
    }
  };
  window.__ANTIGRAVITY_KEY_HANDLER__ = handleKeyDown;
  window.__ANTIGRAVITY_KEY_LISTENER__ = true;
  window.addEventListener('keydown', handleKeyDown);

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

    // 2. Hook into Turbo button in the chat input footer (Context Usage Widget)
    const turboBtn = document.querySelector('button[data-testid="permissions-selector-trigger"]') as HTMLElement | null;
    if (turboBtn && turboBtn.parentElement) {
      const parent = turboBtn.parentElement;
      if (parent.contains(turboBtn)) {
        let pill = parent.querySelector('#antigravity-context-usage-pill') as HTMLElement | null;
        if (!pill) {
          pill = document.createElement('div');
          pill.id = 'antigravity-context-usage-pill';
          pill.className = 'relative inline-flex items-center';
          pill.style.cssText = 'position: relative; display: inline-flex; align-items: center;';
          turboBtn.before(pill);
          updateContextPillContent(pill, getCurrentConversationId());
        }
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
    window.addEventListener('antigravity:stats-updated', () => {
      const pill = document.getElementById('antigravity-context-usage-pill');
      if (pill) {
        updateContextPillContent(pill, getCurrentConversationId());
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

export const openModal = openStatsModal;
export const closeModal = closeStatsModal;
export const mount = mountStats;
export const unmount = unmountStats;
export const showToast = showStatsToast;
export const closeToast = removeStatsToast;
export const init = initAntigravitySettingsInjector;
export const i18n = antigravityI18n;

// Automatically initialize when loaded into the renderer
if (typeof window !== 'undefined') {
  const api = {
    mount: mountStats,
    mountStats,
    unmount: unmountStats,
    unmountStats,
    openModal: openStatsModal,
    openStatsModal,
    closeModal: closeStatsModal,
    closeStatsModal,
    showToast: showStatsToast,
    showStatsToast,
    closeToast: removeStatsToast,
    removeStatsToast,
    init: initAntigravitySettingsInjector,
    initAntigravitySettingsInjector,
    i18n: antigravityI18n,
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
