import React from 'react';
import type { SessionMetrics } from '../../types/dsh-telemetry';
import { formatDuration } from '../../utils/dsh-format';

export interface SessionStatsPopoverProps {
  metrics: SessionMetrics;
  lang?: 'zh' | 'en';
}

export const SessionStatsPopover: React.FC<SessionStatsPopoverProps> = ({ metrics, lang = 'zh' }) => {
  const isZh = lang === 'zh';

  return (
    <div
      id="antigravity-session-stats-popover"
      role="tooltip"
      aria-label={isZh ? '会话统计' : 'Session Stats'}
      className="antigravity-dsh-popover w-[320px] rounded-xl p-4 text-[13px] font-sans select-none border backdrop-blur-md shadow-2xl transition-all"
      style={{
        backgroundColor: 'var(--card, var(--dsh-card-bg, #131317))',
        borderColor: 'var(--border, var(--dsh-card-border, rgba(255, 255, 255, 0.08)))',
        boxShadow: 'var(--dsh-card-shadow, 0 16px 36px -4px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.06))',
        color: 'var(--foreground, var(--dsh-text-primary, #f4f4f5))',
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 font-semibold text-[14px]" style={{ color: 'var(--foreground, var(--dsh-text-primary, #f4f4f5))' }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--primary, var(--dsh-accent, #2F71E3))' }}>
          <path d="m12 14 4-4" />
          <path d="M3.34 19a10 10 0 1 1 17.32 0" />
        </svg>
        <span>{isZh ? '会话统计' : 'Session Stats'}</span>
      </div>

      {/* Divider */}
      <div className="h-[1px] my-3" style={{ backgroundColor: 'var(--border, var(--dsh-divider, rgba(255, 255, 255, 0.08)))' }} />

      {/* Performance Metric Rows */}
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <span style={{ color: 'var(--secondary-foreground, var(--dsh-text-secondary, #a1a1aa))' }}>
            {isZh ? '模型用时' : 'Model Time'}
          </span>
          <span className="font-medium tabular-nums" style={{ color: 'var(--foreground, var(--dsh-text-primary, #f4f4f5))' }}>
            {formatDuration(metrics.modelDurationSec, lang)}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span style={{ color: 'var(--secondary-foreground, var(--dsh-text-secondary, #a1a1aa))' }}>
            {isZh ? '工具调用用时' : 'Tool Call Time'}
          </span>
          <span className="font-medium tabular-nums" style={{ color: 'var(--foreground, var(--dsh-text-primary, #f4f4f5))' }}>
            {formatDuration(metrics.toolDurationSec, lang)}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span style={{ color: 'var(--secondary-foreground, var(--dsh-text-secondary, #a1a1aa))' }}>
            {isZh ? '首 token 平均 (TTFT)' : 'Avg TTFT'}
          </span>
          <span className="font-medium tabular-nums" style={{ color: 'var(--foreground, var(--dsh-text-primary, #f4f4f5))' }}>
            {metrics.ttftSec != null ? formatDuration(metrics.ttftSec, lang) : '--'}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span style={{ color: 'var(--secondary-foreground, var(--dsh-text-secondary, #a1a1aa))' }}>
            {isZh ? '正文输出速度 (TPS)' : 'Text Output Speed (TPS)'}
          </span>
          <span className="font-medium tabular-nums" style={{ color: 'var(--foreground, var(--dsh-text-primary, #f4f4f5))' }}>
            {metrics.tps != null ? `${metrics.tps} tok/s` : '--'}
          </span>
        </div>
      </div>
    </div>
  );
};
