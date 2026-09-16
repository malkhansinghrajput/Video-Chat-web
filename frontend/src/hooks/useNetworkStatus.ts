/* Hook to monitor online/offline network status */

import { useEffect, useState } from 'react';

/**
 * Returns true when the browser has network connectivity.
 * Listens to 'online'/'offline' events from the window.
 *
 * This is the single source of truth for network state — the ChatRoom
 * reads this directly rather than storing it in the global Zustand store.
 */
export function useNetworkStatus(): boolean {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}
