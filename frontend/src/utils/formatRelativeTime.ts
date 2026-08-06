/* Format a timestamp into relative time string */

export function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);

  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (minutes < 60) return `${minutes}m ago`;

  /* After 1 hour, show HH:MM */
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
