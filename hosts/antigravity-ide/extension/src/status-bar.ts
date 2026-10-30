/**
 * Status bar item for the Antigravity IDE — the counterpart of the desktop
 * client's chat context pill. Shows the context usage of the current session
 * (last completed request) and opens the Token Stats view on click.
 *
 * The current-session rules mirror the desktop pill: a running session wins
 * (newest turn first), otherwise the session with the newest turn, otherwise the
 * conversation file the watcher saw change last; anything else renders the zero
 * state. Severity backgrounds follow the pill's thresholds (>55% warning,
 * >85% error); running and zero states stay neutral.
 */
import * as vscode from 'vscode';
import type { AggregatedStats, SessionSummary } from '../../../../src/domain/stats.types';
import { IDE_OPEN_STATS_COMMAND } from '../../src/ide-contract';

const DEFAULT_COMPACTION_LIMIT = 256000;
const PRIORITY = 100;

/** Desktop pill token formatting: raw <1k, one-decimal k <1M, M above. */
function formatTokens(tokens: number): string {
  if (tokens < 1000) return `${tokens}`;
  if (tokens < 1000000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${(tokens / 1000000).toFixed(2)}M`;
}

interface CurrentSession {
  id: string;
  session: SessionSummary;
}

function selectCurrentSession(stats: AggregatedStats | null | undefined, lastChangedSessionId: string | null): CurrentSession | null {
  const sessions = stats?.sessions;
  if (!sessions) return null;

  let running: CurrentSession | null = null;
  let runningTs = -1;
  let idle: CurrentSession | null = null;
  let idleTs = -1;

  for (const [id, session] of Object.entries(sessions)) {
    if (!session) continue;
    const ts = typeof session.turnStartedAt === 'number' ? session.turnStartedAt : 0;
    if (session.isRunning) {
      if (ts >= runningTs) {
        runningTs = ts;
        running = { id, session };
      }
    } else if (ts >= idleTs) {
      idleTs = ts;
      idle = { id, session };
    }
  }

  if (running) return running;
  if (idle) return idle;
  // The watcher saw a conversation change that has no session entry yet.
  if (lastChangedSessionId && sessions[lastChangedSessionId]) {
    return { id: lastChangedSessionId, session: sessions[lastChangedSessionId] };
  }
  return null;
}

function buildTooltip(target: CurrentSession | null): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  if (!target) {
    md.appendMarkdown('**Token Stats** — 尚无会话数据，等待首次模型调用。');
    return md;
  }
  const { session } = target;
  const limit = session.compactionLimit || DEFAULT_COMPACTION_LIMIT;
  const tokens = session.promptTokens;
  const pct = Math.min(100, Math.round((tokens / limit) * 100));
  const remaining = Math.max(0, limit - tokens);
  const cacheRate = tokens > 0 ? ((session.latestCacheRead / tokens) * 100).toFixed(1) : '0.0';
  const isRunning = Boolean(session.isRunning);
  const turnElapsed = isRunning && typeof session.turnStartedAt === 'number'
    ? Math.max(0, Math.round((Date.now() - session.turnStartedAt) / 1000))
    : 0;

  md.appendMarkdown('**当前会话上下文详情**\n\n');
  md.appendMarkdown(`- 上下文占用 (上次请求): **${tokens.toLocaleString()}** tokens (${pct}%)\n`);
  md.appendMarkdown(`- 距自动压缩 (~${Math.round(limit / 1000)}k): 剩余 ~${(remaining / 1000).toFixed(1)}k (${pct}%)\n`);
  md.appendMarkdown(`- Prompt Cache 命中: **${session.latestCacheRead.toLocaleString()}** (${cacheRate}%)\n`);
  md.appendMarkdown(`- 增量新输入: ${session.latestInput.toLocaleString()}\n`);
  md.appendMarkdown(`- 上次输出 (思考/回复): ${session.latestOutput.toLocaleString()} (${session.latestThinking.toLocaleString()} / ${session.latestResponse.toLocaleString()})\n`);
  const turnLine = `${session.turnCalls ?? 0} 次调用 · ${(session.turnTokens ?? 0).toLocaleString()}${turnElapsed > 0 ? ` · ${turnElapsed}s` : ''}`;
  md.appendMarkdown(`- ${isRunning ? '本轮' : '上轮'}累计: ${turnLine}\n`);
  md.appendMarkdown(`\n_${target.id}_`);
  return md;
}

export class StatsStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, PRIORITY);
    this.item.name = 'Antigravity Token Stats';
    this.item.command = IDE_OPEN_STATS_COMMAND;
    this.update(null, null);
    this.item.show();
  }

  /**
   * Re-renders from the latest aggregate push. Called on every successful flush
   * so all push paths (init, watchers, manual refresh) keep it current.
   */
  update(stats: AggregatedStats | null, lastChangedSessionId: string | null): void {
    const target = selectCurrentSession(stats, lastChangedSessionId);
    const isRunning = Boolean(target?.session.isRunning);
    const tokens = target ? target.session.promptTokens : 0;
    const limit = target?.session.compactionLimit || DEFAULT_COMPACTION_LIMIT;
    const pct = target && tokens > 0 ? Math.min(100, Math.round((tokens / limit) * 100)) : 0;

    const icon = isRunning ? '$(sync~spin)' : '$(beaker)';
    this.item.text = tokens === 0
      ? `${icon} --`
      : `${icon} ${formatTokens(tokens)} (${pct}%)`;
    this.item.tooltip = buildTooltip(target);

    // Background severity only reflects settled usage; a spinning or empty
    // session carries no alarm.
    if (!isRunning && tokens > 0 && pct > 85) {
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    } else if (!isRunning && tokens > 0 && pct > 55) {
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
      this.item.backgroundColor = undefined;
    }
  }

  dispose(): void {
    this.item.dispose();
  }
}
