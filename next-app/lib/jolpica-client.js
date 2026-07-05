export const JOLPICA_BASE_URL = "https://api.jolpi.ca/ergast/f1";

async function defaultFetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed Jolpica request (${res.status})`);
  }
  return res.json();
}

export function getDriverStandingsFromMrData(data) {
  return data?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings || [];
}

export function getConstructorStandingsFromMrData(data) {
  return data?.MRData?.StandingsTable?.StandingsLists?.[0]?.ConstructorStandings || [];
}

export function getRacesFromMrData(data) {
  return data?.MRData?.RaceTable?.Races || [];
}

export function getFirstRaceFromMrData(data) {
  return getRacesFromMrData(data)[0] || null;
}

export function getPitStopsFromMrData(data) {
  return getFirstRaceFromMrData(data)?.PitStops || [];
}

export function getCircuitsFromMrData(data) {
  return data?.MRData?.CircuitTable?.Circuits || [];
}

export async function fetchDriverStandings(season, { limit = 100, fetcher = defaultFetchJson } = {}) {
  const data = await fetcher(`${JOLPICA_BASE_URL}/${season}/driverStandings/?format=json&limit=${limit}`);
  return getDriverStandingsFromMrData(data);
}

export async function fetchConstructorStandings(season, { limit = 15, fetcher = defaultFetchJson } = {}) {
  const data = await fetcher(`${JOLPICA_BASE_URL}/${season}/constructorStandings/?format=json&limit=${limit}`);
  return getConstructorStandingsFromMrData(data);
}

export async function fetchSeasonRaces(season, { limit = 30, fetcher = defaultFetchJson } = {}) {
  const data = await fetcher(`${JOLPICA_BASE_URL}/${season}/races/?format=json&limit=${limit}`);
  return getRacesFromMrData(data);
}

export async function fetchSeasonResults(season, { limit = 100, fetcher = defaultFetchJson } = {}) {
  const pageSize = Math.min(limit, 100);
  const racesByRound = new Map();
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  const maxPages = Math.ceil(limit / pageSize) + 2;
  let pagesFetched = 0;

  while (offset < total) {
    if (pagesFetched >= maxPages) {
      break;
    }

    const data = await fetcher(
      `${JOLPICA_BASE_URL}/${season}/results/?format=json&limit=${pageSize}&offset=${offset}`
    );
    const races = getRacesFromMrData(data);
    const reportedTotal = Number(data?.MRData?.total);

    if (Number.isFinite(reportedTotal) && reportedTotal >= 0) {
      total = reportedTotal;
    }

    races.forEach((race) => {
      const key = `${race?.season || season}-${race?.round}`;
      if (!racesByRound.has(key)) {
        racesByRound.set(key, race);
      }
    });

    if (!races.length) {
      break;
    }

    offset += pageSize;
    pagesFetched += 1;
  }

  return [...racesByRound.values()].sort(
    (a, b) => Number(a?.round || 0) - Number(b?.round || 0)
  );
}

export async function fetchRoundResultRace(season, round, { limit = 25, fetcher = defaultFetchJson } = {}) {
  const data = await fetcher(`${JOLPICA_BASE_URL}/${season}/${round}/results/?format=json&limit=${limit}`);
  return getFirstRaceFromMrData(data);
}

export async function fetchRoundPitStops(season, round, { limit = 200, fetcher = defaultFetchJson } = {}) {
  const data = await fetcher(`${JOLPICA_BASE_URL}/${season}/${round}/pitstops/?format=json&limit=${limit}`);
  return getPitStopsFromMrData(data);
}

export async function fetchSeasonCircuits(season, { limit = 30, fetcher = defaultFetchJson } = {}) {
  const data = await fetcher(`${JOLPICA_BASE_URL}/${season}/circuits/?format=json&limit=${limit}`);
  return getCircuitsFromMrData(data);
}

export async function fetchCircuitResults(
  circuitId,
  { season, limit = 5, fetcher = defaultFetchJson } = {}
) {
  const seasonPrefix = season ? `/${season}` : "";
  const data = await fetcher(
    `${JOLPICA_BASE_URL}${seasonPrefix}/circuits/${circuitId}/results/?format=json&limit=${limit}`
  );
  return getRacesFromMrData(data);
}

export async function fetchSeasonStandingsBundle(
  season,
  { driverLimit = 100, constructorLimit = 15, fetcher = defaultFetchJson } = {}
) {
  const [drivers, constructors] = await Promise.all([
    fetchDriverStandings(season, { limit: driverLimit, fetcher }),
    fetchConstructorStandings(season, { limit: constructorLimit, fetcher }),
  ]);

  return { drivers, constructors };
}

export function getCompletedRaces(races, now = new Date()) {
  return races.filter((race) => {
    if (!race.date) return false;
    const timeStr = race.time ? (race.time.endsWith("Z") ? race.time : race.time + "Z") : "00:00:00Z";
    return new Date(`${race.date}T${timeStr}`) <= now;
  });
}

export function getUpcomingRaces(races, now = new Date()) {
  return races.filter((race) => {
    if (!race.date) return false;
    const timeStr = race.time ? (race.time.endsWith("Z") ? race.time : race.time + "Z") : "23:59:59Z";
    return new Date(`${race.date}T${timeStr}`) > now;
  });
}

export function findNextUpcomingRace(races, now = new Date()) {
  return getUpcomingRaces(races, now)[0] || null;
}
