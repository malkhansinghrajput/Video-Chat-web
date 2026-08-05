/* Hook to detect the current responsive breakpoint */

import { useState, useEffect } from 'react';
import { BREAKPOINTS, type BreakpointKey } from '@/constants/breakpoints';

export function useBreakpoint(): BreakpointKey {
  const getBreakpoint = (): BreakpointKey => {
    const width = window.innerWidth;
    if (width >= BREAKPOINTS['3xl']) return '3xl';
    if (width >= BREAKPOINTS['2xl']) return '2xl';
    if (width >= BREAKPOINTS.xl) return 'xl';
    if (width >= BREAKPOINTS.lg) return 'lg';
    if (width >= BREAKPOINTS.md) return 'md';
    if (width >= BREAKPOINTS.sm) return 'sm';
    return 'xs';
  };

  const [breakpoint, setBreakpoint] = useState<BreakpointKey>(getBreakpoint);

  useEffect(() => {
    const handleResize = () => {
      setBreakpoint(getBreakpoint());
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return breakpoint;
}

/* Convenience helpers */
export function useIsMobile(): boolean {
  const bp = useBreakpoint();
  return bp === 'xs' || bp === 'sm';
}

export function useIsTablet(): boolean {
  const bp = useBreakpoint();
  return bp === 'md' || bp === 'lg';
}

export function useIsDesktop(): boolean {
  const bp = useBreakpoint();
  return bp === 'xl' || bp === '2xl' || bp === '3xl';
}
