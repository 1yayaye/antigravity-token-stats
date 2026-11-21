import React, { useEffect, useRef, useState } from 'react';
import { ProxyStatusSummary, ProxyTargetInfo } from '../../domain/stats.types';
import { useLanguage } from '../../i18n/LanguageContext';
import { IPC_REQUEST_SYNC, WINDOW_SYNC_BRIDGE } from '../../injection-contract.cjs';

export interface ProxyStatusCardProps {
  proxy?: ProxyStatusSummary;
}

type StatusTone = 'success' | 'warning' | 'error' | 'muted';

function resolveProxyStatus(info: ProxyTargetInfo | undefined, t: (key: any) => string): {
  tone: StatusTone;
  label: string;
} {
  if (!info || (!info.dllExists && !info.configExists)) {
    return { tone: 'muted', label: t('proxyNotInstalled') };
  }
  if (!info.dllExists && info.configExists) {
    return { tone: 'error', label: t('proxyDllMissing') };
  }
  if (info.dllExists && !info.configExists) {
    return { tone: 'error', label: t('proxyConfigMissing') };
  }
  if (info.dllLoaded === false) {
    return { tone: 'warning', label: t('proxyPendingRestart') };
  }
  if (info.config?.proxy?.port === 0) {
    return { tone: 'muted', label: t('proxyDirectMode') };
  }
  return { tone: 'success', label: t('proxyInstalled') };
}

const TONE_CLASSES: Record<StatusTone, { text: string; dot: string }> = {
  success: {
    text: 'text-emerald-500',
    dot: 'bg-emerald-500 shadow-xs shadow-emerald-500/50',
  },
  warning: {
    text: 'text-amber-500',
    dot: 'bg-amber-500 shadow-xs shadow-amber-500/50',
  },
  error: {
    text: 'text-rose-500',
    dot: 'bg-rose-500 shadow-xs shadow-rose-500/50',
  },
  muted: {
    text: 'text-muted-foreground',
    dot: 'bg-muted-foreground/40',
  },
};

function hasLogOpenBridge(): boolean {
  if (typeof window === 'undefined') return false;
  const win = window as unknown as Record<string, any>;
  if (win[WINDOW_SYNC_BRIDGE] && typeof win[WINDOW_SYNC_BRIDGE].requestSync === 'function') {
    return true;
  }
  if (typeof win.require === 'function') {
    try {
      const electron = win.require('electron');
      return Boolean(electron?.ipcRenderer?.invoke);
    } catch {
      return false;
    }
  }
  return false;
}

function invokeOpenLogDir(): void {
  if (typeof window === 'undefined') return;
  const win = window as unknown as Record<string, any>;
  if (win[WINDOW_SYNC_BRIDGE] && typeof win[WINDOW_SYNC_BRIDGE].requestSync === 'function') {
    win[WINDOW_SYNC_BRIDGE].requestSync({ action: 'open-proxy-logs' }).catch(() => {});
    return;
  }
  if (typeof win.require === 'function') {
    try {
      const electron = win.require('electron');
      electron?.ipcRenderer?.invoke(IPC_REQUEST_SYNC, { action: 'open-proxy-logs' }).catch(() => {});
    } catch {}
  }
}

export const ProxyStatusCard: React.FC<ProxyStatusCardProps> = ({ proxy }) => {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  if (!proxy) return null;

  const desktop = proxy.desktop;
  const status = resolveProxyStatus(desktop, t);
  const toneCls = TONE_CLASSES[status.tone];
  const proxyConfig = desktop?.config?.proxy;
  const logDir = desktop?.logDir || proxy.logDir || null;
  const pluginVersion = proxy.pluginVersion;
  const canOpenLogs = hasLogOpenBridge();

  const handleCopyLogDir = async () => {
    if (!logDir) return;
    let ok = false;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(logDir);
        ok = true;
      }
    } catch {}
    if (!ok && typeof document !== 'undefined') {
      try {
        const ta = document.createElement('textarea');
        ta.value = logDir;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch {}
    }
    if (ok) {
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <section className="bento-tile bento-proxy" aria-label={t('proxyTitle')}>
      <div className="proxy-status-row">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 min-w-0">
          <span className="text-xs font-semibold text-foreground flex items-center gap-2 whitespace-nowrap">
            {t('proxyTitle')}
          </span>
          <span className="proxy-status-item min-w-0">
            <span className="proxy-status-tag">Desktop</span>
            <span className={`inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap ${toneCls.text}`}>
              <span className={`inline-block w-2 h-2 rounded-full ${toneCls.dot}`} />
              {status.label}
            </span>
            {proxyConfig && (
              <span className="font-mono text-[11px] text-muted-foreground truncate">
                {proxyConfig.type}://{proxyConfig.host}:{proxyConfig.port}
              </span>
            )}
          </span>
        </div>
        {pluginVersion && (
          <span className="font-mono text-[11px] text-muted-foreground shrink-0">
            v{pluginVersion}
          </span>
        )}
      </div>

      {logDir && (
        <div className="proxy-log-row">
          <span className="proxy-status-item min-w-0 flex-1" title={logDir}>
            <span className="proxy-status-tag shrink-0">{t('proxyLogLabel')}</span>
            <span className="font-mono text-[11px] text-muted-foreground truncate">
              {logDir}
            </span>
          </span>
          <div className="inline-flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleCopyLogDir}
              className="proxy-action-btn"
              title={logDir}
            >
              {copied ? t('proxyCopied') : t('proxyCopyLogPath')}
            </button>
            {canOpenLogs && (
              <button
                type="button"
                onClick={invokeOpenLogDir}
                className="proxy-action-btn"
              >
                {t('proxyOpenLogDir')}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
