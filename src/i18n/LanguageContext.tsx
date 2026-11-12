import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Language, TranslationKey, translations } from './translations';
import { EVENT_LANGUAGE_CHANGED } from '../injection-contract.cjs';

interface LanguageContextType {
  lang: Language;
  setLang: (lang: Language) => void;
  toggleLang: () => void;
  t: (key: TranslationKey) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

const STORAGE_KEY = 'antigravity-stats-lang';

export const LanguageProvider: React.FC<{ children: React.ReactNode; initialLang?: Language }> = ({ children, initialLang }) => {
  const [lang, setLangState] = useState<Language>(() => {
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
    setLangState(newLang);
    // Host layers (e.g. the Antigravity desktop UI translation) follow the stats UI
    // language through this event; the shared core owns no host code.
    window.dispatchEvent(new CustomEvent(EVENT_LANGUAGE_CHANGED, { detail: { lang: newLang } }));
  };

  // One value per language: a fresh object on every provider render would push every
  // consumer to re-render even when only an unrelated parent re-rendered.
  const contextValue = useMemo(() => ({
    lang,
    setLang,
    toggleLang: () => setLang(lang === 'en' ? 'zh' : 'en'),
    t: (key: TranslationKey): string => {
      const dict = translations[lang] || translations.en;
      return dict[key] || translations.en[key] || key;
    },
  }), [lang]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onExternalChange = (e: Event) => {
      const detail = (e as CustomEvent<{ lang: Language }>).detail;
      if (detail?.lang && (detail.lang === 'en' || detail.lang === 'zh') && detail.lang !== lang) {
        setLangState(detail.lang);
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
