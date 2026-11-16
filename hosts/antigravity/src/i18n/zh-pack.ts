/**
 * Optional Chinese translation pack entry. Built as its own IIFE bundle
 * (dist-bundle/antigravity-stats-zh-pack.js) and injected before the main bundle;
 * loaders and the installer may skip this file, in which case the UI falls back
 * to English (see antigravity-ui-i18n.ts and LanguageContext.tsx).
 */
import { WINDOW_ZH_PACK } from '../../../../src/injection-contract.cjs';
import { zhTranslations } from '../../../../src/i18n/translations-zh';
import { UI_EXACT_MAP, UI_DYNAMIC_RULES, EXCLUSION_SELECTORS } from './antigravity-ui-dict';

(window as unknown as Record<string, unknown>)[WINDOW_ZH_PACK] = {
  statsTranslations: zhTranslations,
  uiDict: {
    exactMap: UI_EXACT_MAP,
    dynamicRules: UI_DYNAMIC_RULES,
    exclusionSelectors: EXCLUSION_SELECTORS,
  },
};
