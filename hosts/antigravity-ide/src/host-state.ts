import type { AggregatedStats, SessionSummary } from '../../../src/domain/stats.types';
import type { LiveQuotaSummary } from '../../../src/domain/pricing.types';

export interface IdeHostState {
  stats: AggregatedStats | null;
  quota: LiveQuotaSummary | null;
  activeSessionId: string | null;
  sessionTitle: string | null;
  session: SessionSummary | null;
  contextLimit: number | null;
  error: string | null;
}
