const MIN_SEASON = 1950;

export function getMaxSeason(): number {
  return new Date().getFullYear() + 1;
}

type ParseOk<T> = { ok: true; value: T };
type ParseErr = { ok: false; error: string };

/** Validate ?season= — omit param to use the current F1 year. */
export function parseSeasonParam(
  raw: string | null,
): ParseOk<number> | ParseErr {
  if (raw === null || raw.trim() === '') {
    return { ok: true, value: new Date().getFullYear() };
  }

  const trimmed = raw.trim();
  if (!/^\d{4}$/.test(trimmed)) {
    return { ok: false, error: 'Invalid season. Must be a 4-digit year.' };
  }

  const season = Number(trimmed);
  const maxSeason = getMaxSeason();
  if (season < MIN_SEASON || season > maxSeason) {
    return {
      ok: false,
      error: `Invalid season. Must be between ${MIN_SEASON} and ${maxSeason}.`,
    };
  }

  return { ok: true, value: season };
}

/** Validate ?round= — returns null when omitted. */
export function parseRoundParam(
  raw: string | null,
): ParseOk<number> | ParseErr | null {
  if (raw === null || raw.trim() === '') {
    return null;
  }

  const trimmed = raw.trim();
  if (!/^\d{1,2}$/.test(trimmed)) {
    return { ok: false, error: 'Invalid round. Must be a numeric race round.' };
  }

  const round = Number(trimmed);
  if (round < 1 || round > 30) {
    return { ok: false, error: 'Invalid round. Must be between 1 and 30.' };
  }

  return { ok: true, value: round };
}
