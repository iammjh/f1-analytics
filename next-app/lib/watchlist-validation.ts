export const MAX_WATCHLIST_NAME_LENGTH = 100;
export const MAX_WATCHLIST_DESCRIPTION_LENGTH = 500;

export function normalizeWatchlistName(raw: unknown, fallback = 'My Watchlist'): string {
  if (typeof raw !== 'string') return fallback.slice(0, MAX_WATCHLIST_NAME_LENGTH);
  const trimmed = raw.trim();
  if (!trimmed) return fallback.slice(0, MAX_WATCHLIST_NAME_LENGTH);
  return trimmed.slice(0, MAX_WATCHLIST_NAME_LENGTH);
}

export function normalizeWatchlistDescription(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, MAX_WATCHLIST_DESCRIPTION_LENGTH);
}

export function validateWatchlistName(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { ok: false, error: 'Watchlist name is required.' };
  }
  if (raw.length > MAX_WATCHLIST_NAME_LENGTH) {
    return {
      ok: false,
      error: `Watchlist name must be ${MAX_WATCHLIST_NAME_LENGTH} characters or fewer.`,
    };
  }
  return { ok: true, value: raw.trim() };
}

export function validateWatchlistDescription(
  raw: unknown,
): { ok: true; value: string | undefined } | { ok: false; error: string } {
  if (raw === undefined || raw === null) {
    return { ok: true, value: undefined };
  }
  if (typeof raw !== 'string') {
    return { ok: false, error: 'Watchlist description must be a string.' };
  }
  if (raw.length > MAX_WATCHLIST_DESCRIPTION_LENGTH) {
    return {
      ok: false,
      error: `Watchlist description must be ${MAX_WATCHLIST_DESCRIPTION_LENGTH} characters or fewer.`,
    };
  }
  const trimmed = raw.trim();
  return { ok: true, value: trimmed || undefined };
}
