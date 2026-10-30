import React from 'react';
import type { ContextMetrics } from '../../types/dsh-telemetry';
import { formatCompactTokens } from '../../utils/dsh-format';

export interface ContextUsagePopoverProps {
  metrics: ContextMetrics;
  lang?: 'zh' | 'en';
}

export const ContextUsagePopover: React.FC<ContextUsagePopoverProps> = ({ metrics, lang = 'zh' }) => {
  const isZh = lang === 'zh';
  const promptTokens = metrics.usedTokens;
  const fillWidthPct = metrics.limitTokens > 0
    ? Math.min(100, (metrics.usedTokens / metrics.limitTokens) * 100)
    : 0;

  const sysPct = promptTokens > 0 ? (metrics.systemPromptTokens / promptTokens) * 100 : 0;
  const toolPct = promptTokens > 0 ? (metrics.toolDefinitionTokens / promptTokens) * 100 : 0;
  const chatPct = promptTokens > 0 ? (metrics.chatMessageTokens / promptTokens) * 100 : 0;

  return (
    <div
      id="antigravity-context-popover"
      role="tooltip"
      aria-label={isZh ? '上下文已用' : 'Context Usage'}
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
        <div>
          <span style={{ color: 'var(--dsh-text-secondary, #d1d5db)' }}>
            {isZh ? '上下文已用 ' : 'Context Used '}
          </span>
          <span className="font-bold text-white">{`${metrics.usedPct}%`}</span>
        </div>
        <span className="font-semibold text-white">
          {`~${formatCompactTokens(metrics.usedTokens)} / ${formatCompactTokens(metrics.limitTokens)}`}
        </span>
      </div>

      {/* Segmented Progress Bar Container */}
      <div className="relative w-full my-3 flex items-center">
        {/* Track */}
        <div className="w-full h-[6px] rounded-full overflow-hidden flex" style={{ backgroundColor: 'var(--dsh-seg-track, #38393e)' }}>
          {/* Filled Portion */}
          <div
            className="h-full flex transition-all duration-300"
            style={{ width: `${fillWidthPct}%` }}
          >
            {sysPct > 0 && (
              <div
                className="h-full transition-all"
                style={{
                  width: `${sysPct}%`,
                  backgroundColor: 'var(--dsh-seg-system-prompt, #9ca3af)',
                }}
                title={`${isZh ? '系统提示词' : 'System Prompt'}: ~${formatCompactTokens(metrics.systemPromptTokens)}`}
              />
            )}
            {toolPct > 0 && (
              <div
                className="h-full transition-all"
                style={{
                  width: `${toolPct}%`,
                  backgroundColor: 'var(--dsh-seg-tool-definitions, #a855f7)',
                }}
                title={`${isZh ? '工具定义' : 'Tool Definitions'}: ~${formatCompactTokens(metrics.toolDefinitionTokens)}`}
              />
            )}
            {chatPct > 0 && (
              <div
                className="h-full transition-all"
                style={{
                  width: `${chatPct}%`,
                  backgroundColor: 'var(--dsh-seg-chat-messages, #3b82f6)',
                }}
                title={`${isZh ? '对话消息' : 'Chat Messages'}: ~${formatCompactTokens(metrics.chatMessageTokens)}`}
              />
            )}
          </div>
        </div>

        {/* 256K Compaction Threshold Indicator (256,000 / 1,048,576 ≈ 24.41%) */}
        <div
          className="absolute w-[2px] h-[10px] -top-[2px] z-10 bg-amber-400 rounded-sm shadow-sm"
          style={{ left: '24.41%' }}
          title={isZh ? '256K 自动压缩阈值 (Antigravity 达到 256K 时将触发会话上下文自动压缩)' : '256K Auto-Compaction Threshold'}
        />
      </div>

      {/* Breakdown Legend Stack */}
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className="w-2.5 h-2.5 rounded-[2px] shrink-0"
              style={{ backgroundColor: 'var(--dsh-seg-system-prompt, #9ca3af)' }}
            />
            <span style={{ color: 'var(--dsh-text-secondary, #d1d5db)' }}>
              {isZh ? '系统提示词' : 'System Prompt'}
            </span>
          </div>
          <span className="font-medium text-white">
            {`~${formatCompactTokens(metrics.systemPromptTokens)}`}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className="w-2.5 h-2.5 rounded-[2px] shrink-0"
              style={{ backgroundColor: 'var(--dsh-seg-tool-definitions, #a855f7)' }}
            />
            <span style={{ color: 'var(--dsh-text-secondary, #d1d5db)' }}>
              {isZh ? '工具定义' : 'Tool Definitions'}
            </span>
          </div>
          <span className="font-medium text-white">
            {`~${formatCompactTokens(metrics.toolDefinitionTokens)}`}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className="w-2.5 h-2.5 rounded-[2px] shrink-0"
              style={{ backgroundColor: 'var(--dsh-seg-chat-messages, #3b82f6)' }}
            />
            <span style={{ color: 'var(--dsh-text-secondary, #d1d5db)' }}>
              {isZh ? '对话消息' : 'Chat Messages'}
            </span>
          </div>
          <span className="font-medium text-white">
            {`~${formatCompactTokens(metrics.chatMessageTokens)}`}
          </span>
        </div>
      </div>

      {/* Threshold & Compaction Note */}
      <div
        className="mt-3 pt-2 text-[11px] flex items-center justify-between border-t"
        style={{
          borderColor: 'var(--dsh-divider, rgba(255, 255, 255, 0.08))',
          color: 'var(--dsh-text-muted, #9ca3af)',
        }}
      >
        <span>{isZh ? '256K 自动压缩阈值 · 缓存命中支持' : '256K Compaction Threshold · Prompt Cache'}</span>
        <span className="font-mono text-white/70">/compact</span>
      </div>
    </div>
  );
};
