/* Common shared type definitions */

export type Theme = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';

export interface UserPreferences {
  audioInputDevice: string | null;
  videoInputDevice: string | null;
  audioOutputDevice: string | null;
  volume: number;
  notificationSound: boolean;
  hapticFeedback: boolean;
}
