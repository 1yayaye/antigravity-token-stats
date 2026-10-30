import React from 'react';
import { ProxyStatusSummary, ProxyTargetInfo } from '../../domain/stats.types';
import { useLanguage } from '../../i18n/LanguageContext';

export interface ProxyStatusCardProps {
  proxy?: ProxyStatusSummary;
}

const TargetStatus: React.FC<{
  badge: string;
  info?: ProxyTargetInfo;
  t: (key: any) => string;
}> = ({ badge, info, t }) => {
  const isRunning = Boolean(info?.isRunning);
  const proxyConfig = info?.config?.proxy;

  return (
    <span className="proxy-status-item min-w-0">
      <span className="proxy-status-tag">{badge}</span>
      <span className={`inline-flex items-center gap-1.5 text-xs whitespace-nowrap ${isRunning ? 'text-emerald-500' : 'text-muted-foreground'}`}>
        <span className={`inline-block w-2 h-2 rounded-full ${isRunning ? 'bg-emerald-500 shadow-xs shadow-emerald-500/50' : 'bg-muted-foreground/40'}`} />
        {isRunning ? t('proxyRunning') : t('proxyIdle')}
      </span>
      {proxyConfig && (
        <span className="font-mono text-[11px] text-muted-foreground truncate">
          {proxyConfig.type}://{proxyConfig.host}:{proxyConfig.port}
        </span>
      )}
    </span>
  );
};

export const ProxyStatusCard: React.FC<ProxyStatusCardProps> = ({ proxy }) => {
  const { t } = useLanguage();

  if (!proxy) return null;

  return (
    <section className="bento-tile bento-proxy" aria-label={t('proxyTitle')}>
      <span className="text-xs font-semibold text-foreground flex items-center gap-2 whitespace-nowrap">
        {t('proxyTitle')}
        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
          MinHook v2.4
        </span>
      </span>
      <TargetStatus badge="Desktop" info={proxy.desktop} t={t} />
      <TargetStatus badge="IDE" info={proxy.ide} t={t} />
    </section>
  );
};
