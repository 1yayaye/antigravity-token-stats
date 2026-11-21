/**
 * Telemetry Format Utilities
 * Formats session duration, compact token counts, and model context window limits.
 */

export function formatDuration(seconds: number | null | undefined, lang: 'zh' | 'en' = 'zh'): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) {
    return lang === 'en' ? '0s' : '0秒';
  }
  if (seconds < 60) {
    const s = Math.round(seconds * 10) / 10;
    return lang === 'en' ? `${s}s` : `${s}秒`;
  }
  const whole = Math.round(seconds);
  const m = Math.floor(whole / 60);
  const rem = whole % 60;
  return lang === 'en' ? `${m}m ${rem}s` : `${m}分${rem}秒`;
}

export function formatCompactTokens(tokens: number | null | undefined): string {
  if (tokens == null || !Number.isFinite(tokens) || tokens <= 0) return '0';
  const scaled = (candidate: number): string =>
    candidate >= 100 ? String(Math.round(candidate)) : String(Math.round(candidate * 10) / 10);
  if (tokens < 1_000) return String(Math.round(tokens));
  if (tokens < 1_000_000) return `${scaled(tokens / 1_000)}K`;
  return `${scaled(tokens / 1_000_000)}M`;
}

// Keep tier steps and doubled-model rules aligned with scripts/aggregate-stats.cjs (resolveContextLimit).
const CONTEXT_LIMIT_TIERS = [256000, 512000, 1000000, 2000000];
const DOUBLED_CONTEXT_MODEL_RE =
  /(?:^|[^a-z0-9])(argon|carbon|hydrogen|neon|worker)(?:[^a-z0-9]|$)|(?:^|[^a-z0-9])gemini[-_.]?4[-_.](?:low|medium|high|xhigh)(?:$|[^a-z0-9])|(?:^|[^a-z0-9])opus[-_.\s]*5[._-]5(?:$|[^a-z0-9])/i;
const ORCHESTRATOR_ONLY_RE = /(?:^|[^a-z0-9])orchestrator(?:[^a-z0-9]|$)/i;
const NON_DOUBLED_MODEL_RE = /(?:^|[^a-z0-9])(claude|opus|sonnet|gpt)(?:[^a-z0-9]|$)/i;

function isDelimiterBoundaryPrefix(full: string, prefix: string): boolean {
  if (full === prefix) return true;
  if (!full.startsWith(prefix)) return false;
  const next = full[prefix.length];
  return next === '-' || next === '_' || next === '.';
}

function findLiveLimit(norm: string, liveLimits: Record<string, number>): number {
  if (liveLimits[norm]) return liveLimits[norm];
  const matches = Object.entries(liveLimits)
    .map(([k, v]) => [k.toLowerCase(), v] as const)
    .filter(([kn]) => isDelimiterBoundaryPrefix(norm, kn) || isDelimiterBoundaryPrefix(kn, norm))
    .sort((a, b) => b[0].length - a[0].length);
  return matches.length > 0 ? matches[0][1] : 0;
}

/**
 * Resolves the context window limit for a model display label or ID.
 * Prefers host-provided live limits, defaults Argon/Carbon/Hydrogen/Neon and Claude Opus 5.5 to 512K,
 * and steps up tiers if observed usedTokens exceeds the baseline.
 */
export function resolveModelContextLimit(
  modelLabelOrId: string | null | undefined,
  usedTokens = 0,
  liveLimits?: Record<string, number>
): number {
  const raw = (modelLabelOrId || '').trim();
  let limit = 0;

  if (raw && liveLimits) {
    const norm = raw.toLowerCase().replace(/[()]/g, '').replace(/\s+/g, '-');
    limit = liveLimits[raw] || findLiveLimit(norm, liveLimits);
    if (!limit && norm.startsWith('orchestrator-')) {
      limit = findLiveLimit(norm.slice('orchestrator-'.length), liveLimits);
    }
  }

  if (!limit) {
    const isDoubled =
      DOUBLED_CONTEXT_MODEL_RE.test(raw) ||
      (ORCHESTRATOR_ONLY_RE.test(raw) && !NON_DOUBLED_MODEL_RE.test(raw));
    limit = isDoubled ? 512000 : 256000;
  }

  if (usedTokens > limit) {
    limit = CONTEXT_LIMIT_TIERS.find(t => usedTokens <= t) || Math.ceil(usedTokens / 100000) * 100000;
  }
  return limit;
}
