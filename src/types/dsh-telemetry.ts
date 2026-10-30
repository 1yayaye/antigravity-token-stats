/**
 * DeepSeek Harness Telemetry Metric Type Contracts
 * Strictly aligns with deepseek-ai/deepseek-harness telemetry models
 */

/** Session performance metrics (Speedometer pill & SessionStatsPopover) */
export interface SessionMetrics {
  /** Current session user interaction rounds (min 1) */
  rounds: number;
  /** Current session total steps (model invocations + tool invocations) */
  steps: number;
  /** Text-only output tokens / matching response duration across completed measurable steps; excludes thinking and tool calls. */
  tps: number | null;
  /** Model generation total duration in seconds */
  modelDurationSec: number;
  /** Local tool execution total duration in seconds (capped at 180s per call) */
  toolDurationSec: number;
  /** Average Time To First Token in seconds (null if unmeasured or cancelled) */
  ttftSec: number | null;
}

/** Token billing and consumption metrics (Database pill & TokenUsagePopover) */
export interface TokenMetrics {
  /** Total billed tokens (uncached input + cache read + output) */
  totalTokens: number;
  /** Cache hit rate percentage (0 - 100, null if billed input is 0) */
  cacheHitRatePct: number | null;
  /** Raw un-cached input tokens */
  uncachedInputTokens: number;
  /** Prompt cache read tokens */
  cacheReadTokens: number;
  /** Model output tokens (thinking + response) */
  outputTokens: number;
}

/** Context window capacity and composition breakdown metrics (Donut pill & ContextUsagePopover) */
export interface ContextMetrics {
  /** Currently occupied context tokens (promptTokens of latest completed request) */
  usedTokens: number;
  /** Context window upper limit (default 1,048,576 / 1M) */
  limitTokens: number;
  /** Context used percentage (0 - 100) */
  usedPct: number;
  /** System prompt tokens estimate (silver gray segment) */
  systemPromptTokens: number;
  /** Tool definitions schema tokens estimate (purple segment) */
  toolDefinitionTokens: number;
  /** Chat history messages tokens estimate (blue segment) */
  chatMessageTokens: number;
}

/** Unified DSH Telemetry Data Packet */
export interface DshTelemetryData {
  /** Globally unique session identifier */
  sessionId: string;
  /** Whether the session is currently in active streaming generation */
  isStreaming: boolean;
  /** Session performance metrics */
  session: SessionMetrics;
  /** Token billing metrics */
  token: TokenMetrics;
  /** Context breakdown metrics */
  context: ContextMetrics;
}
