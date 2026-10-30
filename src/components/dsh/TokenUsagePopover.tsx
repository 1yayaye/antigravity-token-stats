import React from 'react';
import type { TokenMetrics } from '../../types/dsh-telemetry';

export interface TokenUsagePopoverProps {
  metrics: TokenMetrics;
  lang?: 'zh' | 'en';
}

export const TokenUsagePopover: React.FC<TokenUsagePopoverProps> = ({ metrics, lang = 'zh' }) => {
  const isZh = lang === 'zh';

  return (
    <div
      id="antigravity-token-usage-popover"
      role="tooltip"
      aria-label={isZh ? 'Token 用量' : 'Token Usage'}
      className="antigravity-dsh-popover w-[320px] rounded-[14px] p-4 text-[13px] font-sans select-none border backdrop-blur-md shadow-2xl transition-all"
      style={{
        backgroundColor: 'var(--dsh-card-bg, #25262b)',
        borderColor: 'var(--dsh-card-border, rgba(255, 255, 255, 0.08))',
        boxShadow: 'var(--dsh-card-shadow, 0 20px 25px -5px rgba(0, 0, 0, 0.5))',
        color: 'var(--dsh-text-primary, #ffffff)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between text-[14px]">
        <div className="flex items-center gap-2 font-semibold text-white">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#d1d5db]">
            <ellipse cx="12" cy="5" rx="9" ry="3" />
            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
            <path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3" />
          </svg>
          <span>{isZh ? 'Token 用量' : 'Token Usage'}</span>
        </div>
        <span className="font-bold text-white">
          {`${metrics.totalTokens.toLocaleString()} tok`}
        </span>
      </div>

      {/* Divider */}
      <div className="h-[1px] my-3" style={{ backgroundColor: 'var(--dsh-divider, rgba(255, 255, 255, 0.08))' }} />

      {/* Detail Rows */}
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <span style={{ color: 'var(--dsh-text-secondary, #d1d5db)' }}>
            {isZh ? '缓存命中' : 'Cache Hit Rate'}
          </span>
          <span className="font-bold text-white">
            {metrics.cacheHitRatePct != null ? `${metrics.cacheHitRatePct}%` : '--'}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span style={{ color: 'var(--dsh-text-muted, #9ca3af)' }}>
            {isZh ? '未缓存输入' : 'Uncached Input'}
          </span>
          <span className="font-medium text-white">
            {`${metrics.uncachedInputTokens.toLocaleString()} tok`}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span style={{ color: 'var(--dsh-text-muted, #9ca3af)' }}>
            {isZh ? '缓存读取' : 'Cache Read'}
          </span>
          <span className="font-medium text-white">
            {`${metrics.cacheReadTokens.toLocaleString()} tok`}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span style={{ color: 'var(--dsh-text-muted, #9ca3af)' }}>
            {isZh ? '输出' : 'Output'}
          </span>
          <span className="font-medium text-white">
            {`${metrics.outputTokens.toLocaleString()} tok`}
          </span>
        </div>
      </div>
    </div>
  );
};
