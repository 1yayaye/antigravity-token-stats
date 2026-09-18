import React, { createContext, useContext, useState } from 'react';
import { Language, TranslationKey, translations } from './translations';

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
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, newLang);
    }
  };

  const toggleLang = () => {
    setLang(lang === 'en' ? 'zh' : 'en');
  };

  const t = (key: TranslationKey): string => {
    const dict = translations[lang] || translations.en;
    return dict[key] || translations.en[key] || key;
  };

  return (
    <LanguageContext.Provider value={{ lang, setLang, toggleLang, t }}>
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
