import React from 'react';
import { LanguageProvider } from './i18n/LanguageContext';
import { StatsView } from './components/stats/StatsView';

export const App: React.FC = () => {
  return (
    <LanguageProvider>
      <main className="w-full min-h-screen bg-background text-foreground">
        <StatsView />
      </main>
    </LanguageProvider>
  );
};
