import React from 'react';
import type { ContextMetrics } from '../../types/telemetry';
import { formatCompactTokens } from '../../utils/telemetry-format';
import type { StatusBarDisplayMode } from './StatusBar';

export interface ContextUsagePopoverProps {
  metrics: ContextMetrics;
  lang?: 'zh' | 'en';
  displayMode?: StatusBarDisplayMode;
  onToggleDisplayMode?: () => void;
}

const DISPLAY_MODE_LABELS: Record<StatusBarDisplayMode, { zhName: string; enName: string; zhDesc: string; enDesc: string }> = {
  detailed: { zhName: '详细', enName: 'Detailed', zhDesc: '详细 · 全部胶囊', enDesc: 'Detailed · All Pills' },
  standard: { zhName: '标准', enName: 'Standard', zhDesc: '标准 · 精简胶囊', enDesc: 'Standard · Essentials' },
  compact: { zhName: '简洁', enName: 'Compact', zhDesc: '简洁 · 仅上下文', enDesc: 'Compact · Context' },
};

export const ContextUsagePopover: React.FC<ContextUsagePopoverProps> = ({
  metrics,
  lang = 'zh',
  displayMode = 'detailed',
  onToggleDisplayMode,
}) => {
  const isZh = lang === 'zh';
  const modeLabel = DISPLAY_MODE_LABELS[displayMode] ?? DISPLAY_MODE_LABELS.detailed;
  const promptTokens = metrics.usedTokens;
  const limitTokens = metrics.limitTokens || 256000;
  const fillWidthPct = limitTokens > 0
    ? Math.min(100, (metrics.usedTokens / limitTokens) * 100)
    : 0;

  const sysPct = promptTokens > 0 ? (metrics.systemPromptTokens / promptTokens) * 100 : 0;
  const toolPct = promptTokens > 0 ? (metrics.toolDefinitionTokens / promptTokens) * 100 : 0;
  const chatPct = promptTokens > 0 ? (metrics.chatMessageTokens / promptTokens) * 100 : 0;

  return (
    <div
      id="antigravity-context-popover"
      role="tooltip"
      aria-label={isZh ? '上下文已用' : 'Context Usage'}
      className="antigravity-statusbar-popover w-[320px] rounded-xl p-4 text-[13px] font-sans select-none border backdrop-blur-md shadow-2xl transition-all"
      style={{
        backgroundColor: 'var(--card, var(--ag-sb-card-bg, #131317))',
        borderColor: 'var(--border, var(--ag-sb-card-border, rgba(255, 255, 255, 0.08)))',
        boxShadow: 'var(--ag-sb-card-shadow, 0 16px 36px -4px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.06))',
        color: 'var(--foreground, var(--ag-sb-text-primary, #f4f4f5))',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between text-[14px]">
        <div>
          <span style={{ color: 'var(--muted-foreground, var(--ag-sb-text-secondary, #a1a1aa))' }}>
            {isZh ? '上下文已用 ' : 'Context Used '}
          </span>
          <span className="font-bold tabular-nums" style={{ color: 'var(--foreground, var(--ag-sb-text-primary, #f4f4f5))' }}>{`${metrics.usedPct}%`}</span>
        </div>
        <span className="font-semibold tabular-nums" style={{ color: 'var(--foreground, var(--ag-sb-text-primary, #f4f4f5))' }}>
          {`~${formatCompactTokens(metrics.usedTokens)} / ${formatCompactTokens(limitTokens)}`}
        </span>
      </div>

      {/* Segmented Progress Bar Container */}
      <div className="relative w-full my-3 flex items-center">
        {/* Track */}
        <div className="w-full h-[6px] rounded-full overflow-hidden flex" style={{ backgroundColor: 'var(--ag-sb-seg-track, rgba(255, 255, 255, 0.1))' }}>
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
                  backgroundColor: 'var(--ag-sb-seg-system-prompt, #71717a)',
                }}
                title={`${isZh ? '系统提示词' : 'System Prompt'}: ~${formatCompactTokens(metrics.systemPromptTokens)}`}
              />
            )}
            {toolPct > 0 && (
              <div
                className="h-full transition-all"
                style={{
                  width: `${toolPct}%`,
                  backgroundColor: 'var(--ag-sb-seg-tool-definitions, #8b5cf6)',
                }}
                title={`${isZh ? '工具定义' : 'Tool Definitions'}: ~${formatCompactTokens(metrics.toolDefinitionTokens)}`}
              />
            )}
            {chatPct > 0 && (
              <div
                className="h-full transition-all"
                style={{
                  width: `${chatPct}%`,
                  backgroundColor: 'var(--primary, var(--ag-sb-seg-chat-messages, #2F71E3))',
                }}
                title={`${isZh ? '对话消息' : 'Chat Messages'}: ~${formatCompactTokens(metrics.chatMessageTokens)}`}
              />
            )}
          </div>
        </div>
      </div>

      {/* Breakdown Legend Stack */}
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className="w-2.5 h-2.5 rounded-[2px] shrink-0"
              style={{ backgroundColor: 'var(--ag-sb-seg-system-prompt, #71717a)' }}
            />
            <span style={{ color: 'var(--secondary-foreground, var(--ag-sb-text-secondary, #a1a1aa))' }}>
              {isZh ? '系统提示词' : 'System Prompt'}
            </span>
          </div>
          <span className="font-medium tabular-nums" style={{ color: 'var(--foreground, var(--ag-sb-text-primary, #f4f4f5))' }}>
            {`~${formatCompactTokens(metrics.systemPromptTokens)}`}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className="w-2.5 h-2.5 rounded-[2px] shrink-0"
              style={{ backgroundColor: 'var(--ag-sb-seg-tool-definitions, #8b5cf6)' }}
            />
            <span style={{ color: 'var(--secondary-foreground, var(--ag-sb-text-secondary, #a1a1aa))' }}>
              {isZh ? '工具定义' : 'Tool Definitions'}
            </span>
          </div>
          <span className="font-medium tabular-nums" style={{ color: 'var(--foreground, var(--ag-sb-text-primary, #f4f4f5))' }}>
            {`~${formatCompactTokens(metrics.toolDefinitionTokens)}`}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className="w-2.5 h-2.5 rounded-[2px] shrink-0"
              style={{ backgroundColor: 'var(--primary, var(--ag-sb-seg-chat-messages, #2F71E3))' }}
            />
            <span style={{ color: 'var(--secondary-foreground, var(--ag-sb-text-secondary, #a1a1aa))' }}>
              {isZh ? '对话消息' : 'Chat Messages'}
            </span>
          </div>
          <span className="font-medium tabular-nums" style={{ color: 'var(--foreground, var(--ag-sb-text-primary, #f4f4f5))' }}>
            {`~${formatCompactTokens(metrics.chatMessageTokens)}`}
          </span>
        </div>
      </div>

      {/* Threshold & Compaction Note */}
      <div
        className="mt-3 pt-2 text-[11px] flex items-center justify-between border-t"
        style={{
          borderColor: 'var(--border, var(--ag-sb-divider, rgba(255, 255, 255, 0.08)))',
          color: 'var(--muted-foreground, var(--ag-sb-text-muted, #71717a))',
        }}
      >
        <span>{isZh ? `${formatCompactTokens(limitTokens)} 自动压缩阈值 · 缓存命中支持` : `${formatCompactTokens(limitTokens)} Compaction Threshold · Prompt Cache`}</span>
        <span
          className="font-mono text-[10px] px-1.5 py-0.5 rounded border"
          style={{
            backgroundColor: 'var(--secondary, rgba(255, 255, 255, 0.06))',
            borderColor: 'var(--border, rgba(255, 255, 255, 0.08))',
            color: 'var(--muted-foreground, var(--ag-sb-text-muted, #71717a))',
          }}
        >
          /compact
        </span>
      </div>

      {/* Status Bar Display Mode Toggle */}
      <div
        className="mt-2 pt-2 text-[11px] flex items-center justify-between border-t"
        style={{
          borderColor: 'var(--border, var(--ag-sb-divider, rgba(255, 255, 255, 0.08)))',
          color: 'var(--muted-foreground, var(--ag-sb-text-muted, #71717a))',
        }}
      >
        <span>{isZh ? '状态栏显示模式' : 'Status Bar Display'}</span>
        <button
          id="statusbar-popover-mode-toggle"
          type="button"
          onClick={onToggleDisplayMode}
          className="font-medium text-[11px] px-2 py-0.5 rounded border cursor-pointer transition-colors"
          style={{
            backgroundColor: 'var(--secondary, rgba(255, 255, 255, 0.06))',
            borderColor: 'var(--border, rgba(255, 255, 255, 0.08))',
            color: 'var(--foreground, var(--ag-sb-text-primary, #f4f4f5))',
          }}
          aria-label={
            isZh
              ? `状态栏显示模式：${modeLabel.zhName}`
              : `Status bar mode: ${modeLabel.enName}`
          }
        >
          {isZh ? modeLabel.zhDesc : modeLabel.enDesc}
        </button>
      </div>
    </div>
  );
};
