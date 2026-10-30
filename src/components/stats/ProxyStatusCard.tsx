import React from 'react';
import { ProxyStatusSummary, ProxyTargetInfo } from '../../domain/stats.types';
import { useLanguage } from '../../i18n/LanguageContext';

export interface ProxyStatusCardProps {
  proxy?: ProxyStatusSummary;
}

const TargetColumn: React.FC<{
  label: string;
  info?: ProxyTargetInfo;
  badgeText: string;
  t: (key: any) => string;
}> = ({ label, info, badgeText, t }) => {
  const isInstalled = Boolean(info?.installed);
  const isRunning = Boolean(info?.isRunning);
  const proxyConfig = info?.config?.proxy;

  return (
    <div className="flex-1 rounded-xl border border-border/70 bg-card/40 p-3 sm:p-4 flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-secondary/80 text-foreground border border-border/60">
              {badgeText}
            </span>
            <span className="text-sm font-medium text-foreground">{label}</span>
          </div>

          <div className="flex items-center gap-1.5">
            <span
              className={`inline-block w-2 h-2 rounded-full ${
                isInstalled ? 'bg-emerald-500 shadow-xs shadow-emerald-500/50' : 'bg-muted-foreground/40'
              }`}
            />
            <span className={`text-xs font-medium ${isInstalled ? 'text-emerald-500' : 'text-muted-foreground'}`}>
              {isInstalled ? t('proxyInstalled') : t('proxyNotInstalled')}
            </span>
          </div>
        </div>

        <div className="text-xs text-muted-foreground space-y-1 mt-2">
          <div className="flex items-center justify-between">
            <span>{t('proxyProcessStatus')}:</span>
            <span className={isRunning ? 'text-amber-500 font-medium' : 'text-muted-foreground'}>
              {isRunning ? t('proxyRunning') : t('proxyIdle')}
            </span>
          </div>

          {proxyConfig && (
            <div className="flex items-center justify-between">
              <span>{t('proxyTitle')}:</span>
              <span className="font-mono text-foreground">
                {proxyConfig.type}://{proxyConfig.host}:{proxyConfig.port}
              </span>
            </div>
          )}

          {info?.dir && (
            <div className="truncate text-[11px] text-muted-foreground/80 mt-1" title={info.dir}>
              {info.dir}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const ProxyStatusCard: React.FC<ProxyStatusCardProps> = ({ proxy }) => {
  const { t } = useLanguage();

  if (!proxy) return null;

  return (
    <div className="w-full rounded-2xl border border-border/80 bg-card/60 p-4 sm:p-5 shadow-xs backdrop-blur-md mb-4 transition-all">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <svg
            className="w-4 h-4 text-primary"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
          <h3 className="text-sm font-semibold text-foreground tracking-tight">{t('proxyTitle')}</h3>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-medium">
            MinHook v2.4
          </span>
        </div>
      </div>

      {/* Target Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        <TargetColumn
          label={t('proxyDesktopLabel')}
          badgeText="Desktop"
          info={proxy.desktop}
          t={t}
        />
        <TargetColumn
          label={t('proxyIdeLabel')}
          badgeText="IDE"
          info={proxy.ide}
          t={t}
        />
      </div>

      {/* CLI Quick Guide & Alert */}
      <div className="rounded-xl bg-secondary/30 border border-border/60 p-2.5 text-xs text-muted-foreground flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-foreground">{t('proxyInstallHint')}</span>
          <code className="px-1.5 py-0.5 rounded bg-muted/60 text-foreground font-mono text-[11px]">
            npm run proxy:install -- --target all --port 7890
          </code>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground/90">
          <span>{t('proxyLocationDesc')}</span>
        </div>
      </div>
    </div>
  );
};
