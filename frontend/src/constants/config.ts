/* Application configuration constants */

export const CONFIG = {
  /* Search */
  SEARCH_TIMEOUT_MS: 60_000,
  SEARCH_EXTENDED_WAIT_MS: 10_000,
  SEARCH_LONG_WAIT_MS: 30_000,

  /* Auto-search after disconnect */
  AUTO_SEARCH_DELAY_MS: 1500,

  /* Reconnect */
  RECONNECT_TIMEOUT_MS: 5000,
  MAX_RECONNECT_ATTEMPTS: 5,

  /* Connection quality thresholds */
  QUALITY_EXCELLENT_RTT: 100,
  QUALITY_GOOD_RTT: 300,
  QUALITY_POOR_RTT: 1000,
  QUALITY_EXCELLENT_LOSS: 1,
  QUALITY_GOOD_LOSS: 5,
  QUALITY_POOR_LOSS: 15,

  /* Quality check interval */
  QUALITY_CHECK_INTERVAL_MS: 3000,

  /* Chat */
  MAX_MESSAGE_LENGTH: 500,
  MAX_STORED_MESSAGES: 200,
  TYPING_DEBOUNCE_MS: 500,
  SCROLL_THRESHOLD_PX: 200,

  /* Controls auto-hide */
  CONTROLS_HIDE_DELAY_MS: 3000,

  /* Landing page */
  REDIRECT_404_DELAY_MS: 10_000,

  /* Backoff */
  INITIAL_BACKOFF_MS: 1000,
  MAX_BACKOFF_MS: 30_000,
  BACKOFF_JITTER: 0.2,
} as const;
