/* App Store — Theme, preferences, online users, network */

import { create } from 'zustand';
import type { Theme, ResolvedTheme, UserPreferences } from '@/types/common.types';

interface AppState {
  /* Theme */
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;

  /* Preferences */
  preferences: UserPreferences;
  updatePreference: <K extends keyof UserPreferences>(
    key: K,
    value: UserPreferences[K]
  ) => void;

  /* Online Users */
  onlineCount: number;
  setOnlineCount: (count: number) => void;

  /* Network */
  isOnline: boolean;
  setOnline: (online: boolean) => void;
}

const getStoredTheme = (): Theme => {
  try {
    const stored = localStorage.getItem('videochat_theme');
    if (stored === 'dark' || stored === 'light' || stored === 'system') {
      return stored;
    }
  } catch {
    /* localStorage unavailable */
  }
  return 'dark';
};

const resolveTheme = (theme: Theme): ResolvedTheme => {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }
  return theme;
};

const getStoredPreferences = (): UserPreferences => {
  const defaults: UserPreferences = {
    audioInputDevice: null,
    videoInputDevice: null,
    audioOutputDevice: null,
    volume: 1,
    notificationSound: true,
    hapticFeedback: true,
  };
  try {
    const stored = localStorage.getItem('videochat_prefs');
    if (stored) {
      return { ...defaults, ...JSON.parse(stored) };
    }
  } catch {
    /* parse error */
  }
  return defaults;
};

const initialTheme = getStoredTheme();

export const useAppStore = create<AppState>((set, get) => ({
  theme: initialTheme,
  resolvedTheme: resolveTheme(initialTheme),
  setTheme: (theme) => {
    const resolved = resolveTheme(theme);
    document.documentElement.setAttribute('data-theme', resolved);
    try {
      localStorage.setItem('videochat_theme', theme);
    } catch {
      /* storage full */
    }
    set({ theme, resolvedTheme: resolved });
  },

  preferences: getStoredPreferences(),
  updatePreference: (key, value) => {
    const updated = { ...get().preferences, [key]: value };
    try {
      localStorage.setItem('videochat_prefs', JSON.stringify(updated));
    } catch {
      /* storage full */
    }
    set({ preferences: updated });
  },

  onlineCount: 0,
  setOnlineCount: (count) => set({ onlineCount: count }),

  isOnline: navigator.onLine,
  setOnline: (online) => set({ isOnline: online }),
}));
