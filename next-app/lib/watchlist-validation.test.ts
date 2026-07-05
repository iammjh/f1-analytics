import { describe, expect, it } from 'vitest';
import {
  MAX_WATCHLIST_NAME_LENGTH,
  validateWatchlistDescription,
  validateWatchlistName,
} from '@/lib/watchlist-validation';

describe('validateWatchlistName', () => {
  it('accepts a normal name', () => {
    expect(validateWatchlistName('My Favorites')).toEqual({
      ok: true,
      value: 'My Favorites',
    });
  });

  it('rejects names over the max length', () => {
    const result = validateWatchlistName('x'.repeat(MAX_WATCHLIST_NAME_LENGTH + 1));
    expect(result.ok).toBe(false);
  });
});

describe('validateWatchlistDescription', () => {
  it('allows empty description', () => {
    expect(validateWatchlistDescription('')).toEqual({ ok: true, value: undefined });
  });
});
