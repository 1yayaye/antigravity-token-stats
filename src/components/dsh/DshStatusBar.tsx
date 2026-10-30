import React, { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import type { DshTelemetryData } from '../../types/dsh-telemetry';
import { formatCompactTokens } from '../../utils/dsh-format';
import { SessionStatsPopover } from './SessionStatsPopover';
import { TokenUsagePopover } from './TokenUsagePopover';
import { ContextUsagePopover } from './ContextUsagePopover';

// Visual style overrides probed from the host client at injection time so the pills
// match the surrounding Antigravity controls. Every field is optional: when probing
// fails the component falls back to its own --dsh-* tokens from index.css.
export interface DshHostStyle {
  textColor?: string;
  fontSize?: string;
  fontWeight?: string;
  accentColor?: string;
}

export interface DshStatusBarProps {
  telemetry: DshTelemetryData;
  lang?: 'zh' | 'en';
  theme?: 'dark' | 'light';
  liveTps?: number | null;
  hostStyle?: DshHostStyle;
}

type PopoverKind = 'session' | 'token' | 'context';

// The popover sits POPOVER_GAP_PX above the pill, and an equally deep transparent
// strip below the card (the "bridge") keeps the pointer inside the portal while it
// crosses that gap — so the card can neither flicker mid-handoff nor stay pinned
// when the cursor has clearly left both pill and card.
const POPOVER_GAP_PX = 2;
const POPOVER_BRIDGE_PX = 6;
const POPOVER_HIDE_DELAY_MS = 150;

export const DshStatusBar: React.FC<DshStatusBarProps> = ({
  telemetry,
  lang = 'zh',
  theme = 'dark',
  liveTps = null,
  hostStyle,
}) => {
  const isZh = lang === 'zh';
  const { session, token, context, isStreaming } = telemetry;

  const [activePopover, setActivePopover] = useState<PopoverKind | null>(null);
  const [popoverPos, setPopoverPos] = useState<{ bottom: number; left?: number; right?: number }>({ bottom: 40 });
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);

  const perfBtnRef = useRef<HTMLButtonElement>(null);
  const usageBtnRef = useRef<HTMLButtonElement>(null);
  const contextBtnRef = useRef<HTMLButtonElement>(null);

  const cancelHide = () => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    setPortalVisible(true);
  };

  // Hide/show the card imperatively: when the host's event loop is congested a
  // React state commit can land hundreds of ms late, which reads as "sticky".
  const setPortalVisible = (visible: boolean) => {
    const portal = portalRef.current;
    if (portal) {
      portal.style.opacity = visible ? '1' : '0';
      portal.style.pointerEvents = visible ? '' : 'none';
    }
  };

  const scheduleHide = () => {
    cancelHide();
    setPortalVisible(false);
    hideTimerRef.current = setTimeout(() => {
      setActivePopover(null);
    }, POPOVER_HIDE_DELAY_MS);
  };

  const openPopover = (type: PopoverKind, btn: HTMLElement | null) => {
    cancelHide();
    if (btn) {
      const rect = btn.getBoundingClientRect();
      const bottom = Math.max(4, window.innerHeight - rect.top + POPOVER_GAP_PX);
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
    }
    setActivePopover(type);
  };

  // Hover is preview-only: entering a pill always shows its card. mouseenter (not
  // mouseover) keeps child-element bubbling from re-arming a card the cursor left.
  const handlePillEnter = (type: PopoverKind, btn: HTMLElement | null) => {
    if (activePopover === type) {
      cancelHide();
      return;
    }
    openPopover(type, btn);
  };

  // Click is the explicit pin/unpin: it closes even while hovering, and switching
  // pills by click keeps a card open without further hovering.
  const handlePillClick = (type: PopoverKind) => {
    cancelHide();
    setActivePopover((cur) => (cur === type ? null : type));
  };

  // Fallback dismissal for every path the 150ms hover timer can miss: pointer-down
  // outside the pills and card, Escape, scrolling away, or losing the window.
  useEffect(() => {
    if (!activePopover) return;
    const isInsideInjected = (target: EventTarget | null) =>
      rootRef.current?.contains(target as Node) || portalRef.current?.contains(target as Node);
    const close = () => {
      setPortalVisible(false);
      setActivePopover(null);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!isInsideInjected(e.target)) close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onScroll = (e: Event) => {
      if (!portalRef.current?.contains(e.target as Node)) close();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('blur', close);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('blur', close);
    };
  }, [activePopover]);

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

  const probeVars = {
    ...(hostStyle?.textColor ? { '--dsh-text-secondary': hostStyle.textColor } : {}),
    ...(hostStyle?.accentColor ? { '--dsh-accent': hostStyle.accentColor } : {}),
  } as React.CSSProperties;
  const rootStyle: React.CSSProperties = {
    ...probeVars,
    color: 'var(--dsh-text-secondary, #d1d5db)',
    ...(hostStyle?.fontSize ? { fontSize: hostStyle.fontSize } : {}),
  };
  const pillTextStyle: React.CSSProperties = hostStyle?.fontWeight
    ? { fontWeight: hostStyle.fontWeight }
    : {};

  return (
    <div
      ref={rootRef}
      id="antigravity-dsh-statusbar-inner"
      className="antigravity-dsh-statusbar inline-flex items-center gap-3.5 h-[28px] text-[13px] font-sans select-none bg-transparent transition-colors"
      style={rootStyle}
    >
      {/* 1. Performance Pill */}
      <button
        id="dsh-pill-performance"
        ref={perfBtnRef}
        type="button"
        onMouseEnter={() => handlePillEnter('session', perfBtnRef.current)}
        onMouseLeave={scheduleHide}
        onClick={() => handlePillClick('session')}
        className="dsh-pill flex items-center gap-2 px-2 py-1 rounded-[6px] transition-colors outline-none border-none bg-transparent"
        style={{ color: isStreaming ? 'var(--dsh-accent, #38bdf8)' : 'var(--dsh-text-secondary, #d1d5db)' }}
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
          className={isStreaming ? 'animate-pulse' : undefined}
        >
          <path d="m12 14 4-4" />
          <path d="M3.34 19a10 10 0 1 1 17.32 0" />
        </svg>
        <span className="font-medium whitespace-nowrap" style={pillTextStyle}>{perfText}</span>
      </button>

      {/* 2. Usage Pill */}
      <button
        id="dsh-pill-usage"
        ref={usageBtnRef}
        type="button"
        onMouseEnter={() => handlePillEnter('token', usageBtnRef.current)}
        onMouseLeave={scheduleHide}
        onClick={() => handlePillClick('token')}
        className="dsh-pill flex items-center gap-2 px-2 py-1 rounded-[6px] transition-colors outline-none border-none bg-transparent"
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
        >
          <ellipse cx="12" cy="5" rx="9" ry="3" />
          <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
          <path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3" />
        </svg>
        <span className="font-medium whitespace-nowrap" style={pillTextStyle}>{usageText}</span>
      </button>

      {/* 3. Context Donut Pill (with backward-compatible id antigravity-context-usage-pill) */}
      <div id="antigravity-context-usage-pill" className="inline-flex items-center">
        <button
          id="dsh-pill-context"
          ref={contextBtnRef}
          type="button"
          onMouseEnter={() => handlePillEnter('context', contextBtnRef.current)}
          onMouseLeave={scheduleHide}
          onClick={() => handlePillClick('context')}
          className="dsh-pill flex items-center gap-1.5 px-2 py-1 rounded-[6px] transition-colors outline-none border-none bg-transparent"
          style={{ color: 'var(--dsh-text-secondary, #d1d5db)' }}
          aria-label={`上下文已用: ${context.usedPct}%`}
        >
          <div className="relative w-[14px] h-[14px] flex items-center justify-center shrink-0">
            <svg width="14" height="14" viewBox="0 0 16 16" style={{ transform: 'rotate(-90deg)', transformOrigin: 'center' }}>
              <circle
                cx="8"
                cy="8"
                r="6"
                stroke="var(--dsh-donut-track, #3f3f46)"
                strokeWidth="2"
                fill="none"
              />
              <circle
                cx="8"
                cy="8"
                r="6"
                stroke={isStreaming ? 'var(--dsh-accent, #38bdf8)' : 'var(--dsh-donut-fill, #e4e4e7)'}
                strokeWidth="2"
                strokeLinecap="round"
                fill="none"
                strokeDasharray={circumference.toFixed(1)}
                strokeDashoffset={offset.toFixed(1)}
                style={{ transition: 'stroke-dashoffset 0.25s ease' }}
              />
            </svg>
          </div>
          <span
            className="font-mono text-[12px] font-semibold whitespace-nowrap"
            style={{ ...pillTextStyle, color: 'var(--dsh-text-secondary, #d1d5db)' }}
          >
            {`${context.usedPct}%`}
          </span>
        </button>
      </div>

      {/* Render Popover Portal into document.body */}
      {typeof document !== 'undefined' && activePopover && ReactDOM.createPortal(
        <div
          ref={portalRef}
          id="antigravity-dsh-popover-container"
          className={`antigravity-dsh-container ${theme}`}
          style={{
            position: 'fixed',
            bottom: `${popoverPos.bottom}px`,
            left: popoverPos.left != null ? `${popoverPos.left}px` : undefined,
            right: popoverPos.right != null ? `${popoverPos.right}px` : undefined,
            zIndex: 9999999,
            paddingBottom: POPOVER_BRIDGE_PX,
            transition: 'opacity 80ms linear',
          }}
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
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
