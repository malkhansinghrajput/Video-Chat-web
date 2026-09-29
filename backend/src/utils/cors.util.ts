/**
 * Utility to validate incoming CORS requests against allowed origin patterns.
 * Supports exact domain matches, wildcard '*' (all), and wildcard subdomains like:
 *   - '*.vercel.app'
 *   - 'https://*.vercel.app'
 *   - 'https://video-chat-*.vercel.app'
 */
export function isOriginAllowed(origin: string | undefined, allowedOrigins: string[]): boolean {
  // Requests without an Origin header (e.g. mobile apps, curl, server-to-server) are allowed
  if (!origin) return true;

  const normalizedOrigin = origin.replace(/\/$/, '');

  for (const allowed of allowedOrigins) {
    const cleanAllowed = allowed.trim().replace(/\/$/, '');
    if (!cleanAllowed) continue;

    // Wildcard match all
    if (cleanAllowed === '*') return true;

    // Exact match
    if (cleanAllowed === normalizedOrigin) return true;

    // Wildcard domain match (e.g. https://*.vercel.app or *.vercel.app)
    if (cleanAllowed.includes('*')) {
      const pattern = '^' + cleanAllowed
        .split('*')
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*') + '$';
      const regex = new RegExp(pattern);
      if (regex.test(normalizedOrigin)) {
        return true;
      }
    }
  }

  return false;
}
