import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { StatsView } from './components/stats/StatsView';
import { LanguageProvider } from './i18n/LanguageContext';
import { detectAntigravityTheme, syncThemeToElement } from './services/stats-service';
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
export function showStatsToast(message: string = '✦ Token Stats 已就绪', durationMs: number = 4000) {
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
      <span style="font-weight: 600; color: #f1f4f9; letter-spacing: -0.01em; white-space: nowrap;">${message}</span>
      <span style="font-size: 11px; color: #94a3b8; letter-spacing: 0.01em; white-space: nowrap;">按 <kbd style="font-family: inherit; padding: 1px 4px; border-radius: 4px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.12); color: #cbd5e1;">${shortcutLabel}</kbd> 或点击查看看板</span>
    </div>
    <button id="antigravity-stats-toast-close" style="margin-left: 6px; display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 6px; border: none; background: transparent; color: rgba(255,255,255,0.4); cursor: pointer; padding: 0; outline: none; transition: color 0.15s, background-color 0.15s;" title="关闭">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    </button>
  `;

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
}

// Auto-injection DOM observer for Antigravity 2.0 Settings Modal & Sidebar Shortcut
export function initAntigravitySettingsInjector() {
  if (window.__ANTIGRAVITY_OBSERVER__) {
    window.__ANTIGRAVITY_OBSERVER__.disconnect();
    window.__ANTIGRAVITY_OBSERVER__ = null;
  }
  unmountStats();

  // Clean up any stale misplaced containers, buttons, and toasts from prior injections
  document.querySelectorAll('#antigravity-stats-nav-btn, #antigravity-stats-sidebar-btn, #antigravity-stats-content, #antigravity-stats-settings-content, #antigravity-stats-modal-overlay, #antigravity-stats-toast').forEach(el => el.remove());

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
      const modelsBtn = Array.from(modal.querySelectorAll('button')).find((b) => (b.innerText || '').trim() === 'Models');
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
  };

  let scanDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  const debouncedScanAndInject = () => {
    if (scanDebounceTimer) clearTimeout(scanDebounceTimer);
    scanDebounceTimer = setTimeout(scanAndInject, 60);
  };

  const observer = new MutationObserver(debouncedScanAndInject);
  window.__ANTIGRAVITY_OBSERVER__ = observer;
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });

  // Run immediate scan on load
  scanAndInject();
}

// Automatically initialize when loaded into the renderer
if (typeof window !== 'undefined') {
  window.AntigravityStats = {
    mount: mountStats,
    unmount: unmountStats,
    openModal: openStatsModal,
    closeModal: closeStatsModal,
    showToast: showStatsToast,
    closeToast: removeStatsToast,
    init: initAntigravitySettingsInjector,
  };
  initAntigravitySettingsInjector();
}
