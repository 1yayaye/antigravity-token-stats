import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Language, TranslationKey, translations } from './translations';
import { EVENT_LANGUAGE_CHANGED, WINDOW_ZH_PACK } from '../injection-contract.cjs';
import type { ZhLanguagePack } from '../domain/stats.types';

interface LanguageContextType {
  lang: Language;
  setLang: (lang: Language) => void;
  toggleLang: () => void;
  canSwitchLang: boolean;
  t: (key: TranslationKey) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

const STORAGE_KEY = 'antigravity-stats-lang';

function getZhPack(): ZhLanguagePack | undefined {
  return typeof window === 'undefined'
    ? undefined
    : (window as unknown as Record<string, ZhLanguagePack | undefined>)[WINDOW_ZH_PACK];
}

export function hasZhStatsSupport(): boolean {
  return Object.keys(translations.zh).length > 0 || Boolean(getZhPack()?.statsTranslations);
}

export const LanguageProvider: React.FC<{ children: React.ReactNode; initialLang?: Language }> = ({ children, initialLang }) => {
  const canSwitchLang = hasZhStatsSupport();
  const normalizeLang = (candidate: Language): Language => (candidate === 'zh' && !hasZhStatsSupport() ? 'en' : candidate);

  const [lang, setLangState] = useState<Language>(() => {
    if (!canSwitchLang) return 'en';
    if (initialLang) return initialLang;
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'en' || saved === 'zh') return saved;
      // Auto-detect browser language if Chinese
      const navLang = navigator.language?.toLowerCase();
      if (navLang?.startsWith('zh')) return 'zh';
    }
    return 'en';
  });

  const setLang = (newLang: Language) => {
    const effectiveLang = normalizeLang(newLang);
    setLangState(effectiveLang);
    // Host layers (e.g. the Antigravity desktop UI translation) follow the stats UI
    // language through this event; the shared core owns no host code.
    window.dispatchEvent(new CustomEvent(EVENT_LANGUAGE_CHANGED, { detail: { lang: effectiveLang } }));
  };

  // One value per language: a fresh object on every provider render would push every
  // consumer to re-render even when only an unrelated parent re-rendered.
  const contextValue = useMemo(() => ({
    lang,
    setLang,
    toggleLang: () => setLang(lang === 'zh' ? 'en' : 'zh'),
    canSwitchLang,
    // Desktop bundles swap the zh dictionary for an empty stub, so Chinese comes
    // from the optional zh-pack (injected before the bundle); missing pack = English.
    t: (key: TranslationKey): string => {
      const zhPack = getZhPack();
      return translations[lang]?.[key]
        ?? zhPack?.statsTranslations?.[key]
        ?? translations.en[key]
        ?? key;
    },
  }), [lang, canSwitchLang]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onExternalChange = (e: Event) => {
      const detail = (e as CustomEvent<{ lang: Language }>).detail;
      if (detail?.lang && (detail.lang === 'en' || detail.lang === 'zh')) {
        const effectiveLang = normalizeLang(detail.lang);
        if (effectiveLang !== lang) setLangState(effectiveLang);
      }
    };
    window.addEventListener(EVENT_LANGUAGE_CHANGED, onExternalChange);
    return () => window.removeEventListener(EVENT_LANGUAGE_CHANGED, onExternalChange);
  }, [lang]);

  return (
    <LanguageContext.Provider value={contextValue}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = (): LanguageContextType => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};
