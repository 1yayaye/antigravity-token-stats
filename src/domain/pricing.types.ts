export interface CapturedQuotaBucket {
  displayName: string;
  bucketId: string;
  remainingFraction: number; // 0.0 ~ 1.0
  usedFraction: number;      // 0.0 ~ 1.0
  resetTime: string | null;  // ISO string
}

export interface LiveQuotaSummary {
  capturedAt: string;
  weeklyGemini?: CapturedQuotaBucket;
  weeklyClaude?: CapturedQuotaBucket;
  description?: string;
}

export type SubscriptionTierId = 'free' | 'pro' | 'ultra_5x' | 'ultra_20x' | 'custom';

export interface SubscriptionTierConfig {
  id: SubscriptionTierId;
  name: string;
  monthlyFeeUsd: number;
  labelKey: string;
}

declare global {
  interface Window {
    __ANTIGRAVITY_LIVE_QUOTA__?: LiveQuotaSummary | null;
  }
}
