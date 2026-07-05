/**
 * Live dashboard poll intervals (ms).
 * Faster when session timing exists; slower when idle or tab is hidden.
 */
export type LiveRaceStatus = 'live' | 'recent' | 'upcoming' | 'scheduled' | 'completed' | string;

const LIVE_POLL_MS = 15_000;
const RECENT_POLL_MS = 30_000;
const UPCOMING_POLL_MS = 60_000;
const IDLE_POLL_MS = 120_000;
const HIDDEN_POLL_MS = 300_000;

export function getLivePollIntervalMs(
  status: LiveRaceStatus | null | undefined,
  isDocumentHidden = false,
): number {
  if (isDocumentHidden) return HIDDEN_POLL_MS;

  switch (status) {
    case 'live':
      return LIVE_POLL_MS;
    case 'recent':
      return RECENT_POLL_MS;
    case 'upcoming':
      return UPCOMING_POLL_MS;
    default:
      return IDLE_POLL_MS;
  }
}
