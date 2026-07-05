import { describe, expect, it } from 'vitest';
import { getMaxSeason, parseRoundParam, parseSeasonParam } from '@/lib/query-params';

describe('parseSeasonParam', () => {
  it('defaults to the current year when omitted', () => {
    const result = parseSeasonParam(null);
    expect(result).toEqual({ ok: true, value: new Date().getFullYear() });
  });

  it('accepts a valid season year', () => {
    expect(parseSeasonParam('2024')).toEqual({ ok: true, value: 2024 });
  });

  it('rejects non-numeric seasons', () => {
    const result = parseSeasonParam('20ab');
    expect(result.ok).toBe(false);
  });

  it('rejects out-of-range seasons', () => {
    const result = parseSeasonParam('1800');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain(String(getMaxSeason()));
    }
  });
});

describe('parseRoundParam', () => {
  it('returns null when omitted', () => {
    expect(parseRoundParam(null)).toBeNull();
  });

  it('accepts a valid round', () => {
    expect(parseRoundParam('12')).toEqual({ ok: true, value: 12 });
  });

  it('rejects invalid round strings', () => {
    const result = parseRoundParam('abc');
    expect(result?.ok).toBe(false);
  });
});
