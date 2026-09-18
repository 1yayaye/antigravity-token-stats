import type { DailyStatEntry, HeatmapCell } from '../domain/stats.types';

export function buildActivityHistory(cells: HeatmapCell[], dailyStats?: Record<string, DailyStatEntry>, now = new Date()) {
  const key = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const parse = (date: string) => new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
  const today = key(now);
  const daily = new Map<string, DailyStatEntry>(cells.map(cell => [cell.date, cell.detail || { tokens: cell.tokens, tasks: cell.tasks }]));
  for (const [date, entry] of Object.entries(dailyStats || {})) daily.set(date, entry);
  const first = [...daily.keys()].sort().find(date => date <= today && (daily.get(date)!.tokens > 0 || daily.get(date)!.tasks > 0));
  const days: HeatmapCell[] = [];
  if (!first) return { days };

  const levels = new Map(cells.map(cell => [cell.date, cell]));
  const values = [...daily.values()].map(entry => entry.tokens).filter(tokens => tokens > 0).sort((a, b) => a - b);
  const thresholds = [0.25, 0.5, 0.75].map(ratio => values[Math.floor(values.length * ratio)] || 1);
  // Date keys are already aggregated days; parse their calendar fields without shifting them across time zones.
  for (const date = parse(first); key(date) <= today; date.setDate(date.getDate() + 1)) {
    const dateKey = key(date);
    const detail = daily.get(dateKey);
    const tokens = detail?.tokens ?? 0;
    const tasks = detail?.tasks ?? 0;
    const existing = levels.get(dateKey);
    const level = existing && existing.tokens === tokens ? existing.level : tokens === 0 ? 0 : thresholds.filter(threshold => tokens > threshold).length + 1;
    days.push({ date: dateKey, month: dateKey.slice(0, 7), dayOfWeek: date.getDay(), tokens, tasks, level: level as HeatmapCell['level'], detail });
  }
  return { days };
}
