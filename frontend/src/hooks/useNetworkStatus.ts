/* Hook to monitor online/offline network status */

import { useEffect } from 'react';
import { useAppStore } from '@/stores/appStore';

export function useNetworkStatus() {
  const setOnline = useAppStore((s) => s.setOnline);
  const isOnline = useAppStore((s) => s.isOnline);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [setOnline]);

  return isOnline;
}
