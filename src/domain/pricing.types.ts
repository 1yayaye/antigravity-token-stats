export interface CapturedQuotaBucket {
  displayName: string;
  bucketId: string;
  remainingFraction: number; // 0.0 ~ 1.0
  usedFraction: number;      // 0.0 ~ 1.0
  resetTime: string | null;  // ISO string
}

export type QuotaPoolId = 'gemini' | 'claude' | 'argon';

export type SubscriptionTierId = 'free' | 'pro' | 'ultra_5x' | 'ultra_20x';

export interface DetectedAccountTier {
  tier: SubscriptionTierId;
  /** True when the backend identifies Ultra without specifying 5x vs 20x. */
  isUltraAmbiguous?: boolean;
  /** Non-PII backend tier identifier (e.g. "g1-pro-tier", "g1-ultra-tier", "free-tier"). */
  rawTierId?: string;
  /** Non-PII tier display name from the host (e.g. "Google AI Pro"). */
  rawTierName?: string;
  /** Non-PII hashed identifier of the active account to scope manual overrides. */
  accountKey?: string;
}

export interface LiveQuotaSummary {
  capturedAt: string;
  weeklyGemini?: CapturedQuotaBucket;
  weeklyClaude?: CapturedQuotaBucket;
  weeklyArgon?: CapturedQuotaBucket;
  description?: string;
  detectedAccountTier?: DetectedAccountTier;
}

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
