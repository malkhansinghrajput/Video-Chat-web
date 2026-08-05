import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import '@/styles/index.css';

/* Initialize theme from local storage before rendering to prevent flash */
const initTheme = () => {
  try {
    const stored = localStorage.getItem('videochat_theme');
    if (stored === 'light' || stored === 'dark') {
      document.documentElement.setAttribute('data-theme', stored);
    } else if (stored === 'system' || !stored) {
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    }
  } catch {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
};
initTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
