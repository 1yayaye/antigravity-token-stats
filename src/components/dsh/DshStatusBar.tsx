import React, { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import type { DshTelemetryData } from '../../types/dsh-telemetry';
import { formatCompactTokens } from '../../utils/dsh-format';
import { SessionStatsPopover } from './SessionStatsPopover';
import { TokenUsagePopover } from './TokenUsagePopover';
import { ContextUsagePopover } from './ContextUsagePopover';

export interface DshStatusBarProps {
  telemetry: DshTelemetryData;
  lang?: 'zh' | 'en';
  theme?: 'dark' | 'light';
  onOpenModal?: () => void;
  liveTps?: number | null;
}

export const DshStatusBar: React.FC<DshStatusBarProps> = ({
  telemetry,
  lang = 'zh',
  theme = 'dark',
  onOpenModal,
  liveTps = null,
}) => {
  const isZh = lang === 'zh';
  const { session, token, context, isStreaming } = telemetry;

  const [activePopover, setActivePopover] = useState<'session' | 'token' | 'context' | null>(null);
  const [popoverPos, setPopoverPos] = useState<{ bottom: number; left?: number; right?: number }>({ bottom: 40 });
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const perfBtnRef = useRef<HTMLButtonElement>(null);
  const usageBtnRef = useRef<HTMLButtonElement>(null);
  const contextBtnRef = useRef<HTMLButtonElement>(null);

  const updatePopoverPos = (btn: HTMLElement | null) => {
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const bottom = Math.max(10, window.innerHeight - rect.top + 8);
    const cardWidth = 320;
    if (rect.left + cardWidth > window.innerWidth - 16) {
      setPopoverPos({
        bottom,
        right: Math.max(16, window.innerWidth - rect.right),
      });
    } else {
      setPopoverPos({
        bottom,
        left: Math.max(16, rect.left),
      });
    }
  };

  const handleMouseEnter = (type: 'session' | 'token' | 'context', btn: HTMLElement | null) => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    updatePopoverPos(btn);
    setActivePopover(type);
  };

  const handleMouseLeave = () => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      setActivePopover(null);
    }, 150);
  };

  const handlePopoverMouseEnter = () => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  };

  const handlePopoverMouseLeave = () => {
    handleMouseLeave();
  };

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  // Performance Text
  const currentTps = liveTps !== null ? liveTps : session.tps;
  const perfText = currentTps !== null
    ? `${session.rounds} ${isZh ? '轮' : 'rounds'} ${session.steps} ${isZh ? '步' : 'steps'} · ${currentTps} tok/s`
    : `${session.rounds} ${isZh ? '轮' : 'rounds'} ${session.steps} ${isZh ? '步' : 'steps'}`;

  // Usage Text
  const compactTotal = formatCompactTokens(token.totalTokens);
  const usageText = token.cacheHitRatePct !== null
    ? `${compactTotal} tok · ${isZh ? '缓存命中' : 'Cache'} ${token.cacheHitRatePct}%`
    : `${compactTotal} tok`;

  // Context Donut Calculations
  const radius = 6;
  const circumference = 2 * Math.PI * radius; // 37.6991
  const offset = circumference - (Math.min(100, Math.max(0, context.usedPct)) / 100) * circumference;

  const handlePillClick = () => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    setActivePopover(null);
    if (onOpenModal) onOpenModal();
  };

  return (
    <div
      id="antigravity-dsh-statusbar-inner"
      className="antigravity-dsh-statusbar inline-flex items-center gap-3.5 h-[28px] text-[13px] font-sans select-none bg-transparent transition-colors"
      style={{
        color: 'var(--dsh-text-secondary, #d1d5db)',
      }}
    >
      {/* 1. Performance Pill */}
      <button
        id="dsh-pill-performance"
        ref={perfBtnRef}
        type="button"
        onClick={handlePillClick}
        onMouseEnter={() => handleMouseEnter('session', perfBtnRef.current)}
        onMouseOver={() => handleMouseEnter('session', perfBtnRef.current)}
        onMouseLeave={handleMouseLeave}
        className="flex items-center gap-2 px-2 py-1 rounded-[6px] transition-colors cursor-pointer outline-none border-none bg-transparent hover:bg-white/[0.08]"
        style={{ color: isStreaming ? '#38bdf8' : 'var(--dsh-text-secondary, #d1d5db)' }}
        aria-label={`性能统计: ${perfText}`}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={isStreaming ? 'animate-pulse text-sky-400' : 'text-[#d1d5db]'}
        >
          <path d="m12 14 4-4" />
          <path d="M3.34 19a10 10 0 1 1 17.32 0" />
        </svg>
        <span className="font-medium whitespace-nowrap">{perfText}</span>
      </button>

      {/* 2. Usage Pill */}
      <button
        id="dsh-pill-usage"
        ref={usageBtnRef}
        type="button"
        onClick={handlePillClick}
        onMouseEnter={() => handleMouseEnter('token', usageBtnRef.current)}
        onMouseOver={() => handleMouseEnter('token', usageBtnRef.current)}
        onMouseLeave={handleMouseLeave}
        className="flex items-center gap-2 px-2 py-1 rounded-[6px] transition-colors cursor-pointer outline-none border-none bg-transparent hover:bg-white/[0.08]"
        style={{ color: 'var(--dsh-text-secondary, #d1d5db)' }}
        aria-label={`用量统计: ${usageText}`}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-[#d1d5db]"
        >
          <ellipse cx="12" cy="5" rx="9" ry="3" />
          <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
          <path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3" />
        </svg>
        <span className="font-medium whitespace-nowrap">{usageText}</span>
      </button>

      {/* 3. Context Donut Pill (with backward-compatible id antigravity-context-usage-pill) */}
      <div id="antigravity-context-usage-pill" className="inline-flex items-center">
        <button
          id="dsh-pill-context"
          ref={contextBtnRef}
          type="button"
          onClick={handlePillClick}
          onMouseEnter={() => handleMouseEnter('context', contextBtnRef.current)}
          onMouseOver={() => handleMouseEnter('context', contextBtnRef.current)}
          onMouseLeave={handleMouseLeave}
          className="flex items-center gap-1.5 px-2 py-1 rounded-[6px] transition-colors cursor-pointer outline-none border-none bg-transparent hover:bg-white/[0.08]"
          style={{ color: 'var(--dsh-text-secondary, #d1d5db)' }}
          aria-label={`上下文已用: ${context.usedPct}%`}
        >
          <div className="relative w-[14px] h-[14px] flex items-center justify-center shrink-0">
            <svg width="14" height="14" viewBox="0 0 16 16" style={{ transform: 'rotate(-90deg)', transformOrigin: 'center' }}>
              <circle
                cx="8"
                cy="8"
                r="6"
                stroke="#3f3f46"
                strokeWidth="2"
                fill="none"
              />
              <circle
                cx="8"
                cy="8"
                r="6"
                stroke={isStreaming ? '#38bdf8' : '#e4e4e7'}
                strokeWidth="2"
                strokeLinecap="round"
                fill="none"
                strokeDasharray={circumference.toFixed(1)}
                strokeDashoffset={offset.toFixed(1)}
                style={{ transition: 'stroke-dashoffset 0.25s ease' }}
              />
            </svg>
          </div>
          <span className="font-mono text-[12px] font-semibold text-white whitespace-nowrap">
            {`${context.usedPct}%`}
          </span>
        </button>
      </div>

      {/* Render Popover Portal into document.body */}
      {typeof document !== 'undefined' && activePopover && ReactDOM.createPortal(
        <div
          id="antigravity-dsh-popover-container"
          className={`antigravity-dsh-container ${theme}`}
          style={{
            position: 'fixed',
            bottom: `${popoverPos.bottom}px`,
            left: popoverPos.left != null ? `${popoverPos.left}px` : undefined,
            right: popoverPos.right != null ? `${popoverPos.right}px` : undefined,
            zIndex: 9999999,
          }}
          onMouseEnter={handlePopoverMouseEnter}
          onMouseLeave={handlePopoverMouseLeave}
        >
          {activePopover === 'session' && (
            <SessionStatsPopover
              metrics={{
                ...session,
                tps: currentTps,
              }}
              lang={lang}
            />
          )}
          {activePopover === 'token' && <TokenUsagePopover metrics={token} lang={lang} />}
          {activePopover === 'context' && <ContextUsagePopover metrics={context} lang={lang} />}
        </div>,
        document.body
      )}
    </div>
  );
};
