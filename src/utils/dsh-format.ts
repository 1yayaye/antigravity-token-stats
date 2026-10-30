/**
 * DeepSeek Harness Format Utilities
 * Strictly aligns with deepseek-harness formatting specs
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
