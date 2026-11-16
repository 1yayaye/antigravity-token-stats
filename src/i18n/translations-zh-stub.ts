/**
 * Compile-time replacement for translations-zh.ts used by the desktop bundle build
 * (vite.bundle.config.ts resolve.alias). An empty dictionary makes the main bundle
 * English-only; real Chinese arrives at runtime through the optional zh-pack
 * (window.__ANTIGRAVITY_ZH_PACK__).
 */
export const zhTranslations: Record<string, string> = {};
