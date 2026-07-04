import axios from 'axios';

const OPENF1_API = process.env.OPENF1_API || 'https://api.openf1.org/v1';
const ERGAST_API = process.env.ERGAST_API || 'https://ergast.com/api/f1';

type OpenF1Primitive = string | number | boolean | undefined | null;
type OpenF1Params = Record<string, OpenF1Primitive>;

function normalizeParams(
  value?: number | string | OpenF1Params,
  defaultKey?: string
): OpenF1Params {
  if (value === undefined || value === null) {
    return {};
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }

  if (!defaultKey) {
    return {};
  }

  return { [defaultKey]: value as OpenF1Primitive };
}

export const openF1 = axios.create({
  baseURL: OPENF1_API,
  timeout: 10000,
});

export const ergast = axios.create({
  baseURL: ERGAST_API,
  timeout: 10000,
});

// OpenF1 endpoints
export const f1Api = {
  // Live telemetry
  meetings: async (params?: number | string | OpenF1Params) => {
    return openF1.get('/meetings', { params: normalizeParams(params, 'year') });
  },
  
  sessions: async (params?: number | string | OpenF1Params) => {
    return openF1.get('/sessions', { params: normalizeParams(params, 'meeting_key') });
  },

  drivers: async (params?: number | string | OpenF1Params) => {
    return openF1.get('/drivers', { params: normalizeParams(params, 'session_key') });
  },

  laps: async (
    paramsOrSessionKey?: number | string | OpenF1Params,
    driverNumber?: number | string
  ) => {
    const params =
      typeof paramsOrSessionKey === 'object' && paramsOrSessionKey !== null
        ? paramsOrSessionKey
        : {
            ...normalizeParams(paramsOrSessionKey, 'session_key'),
            ...(driverNumber !== undefined ? { driver_number: driverNumber } : {}),
          };
    return openF1.get('/laps', { params });
  },

  positions: async (params?: number | string | OpenF1Params) => {
    return openF1.get('/position', { params: normalizeParams(params, 'session_key') });
  },

  pitstops: async (params?: number | string | OpenF1Params) => {
    return openF1.get('/pit', { params: normalizeParams(params, 'session_key') });
  },

  carData: async (params?: number | string | OpenF1Params) => {
    return openF1.get('/car_data', { params: normalizeParams(params, 'session_key') });
  },

  // Historical (Ergast fallback)
  races: async (year: number) => {
    return ergast.get(`/${year}.json`);
  },

  results: async (year: number, round: string) => {
    return ergast.get(`/${year}/${round}/results.json`);
  },

  standings: async (year: number, round?: string) => {
    const path = round ? `/${year}/${round}/driverStandings.json` : `/${year}/driverStandings.json`;
    return ergast.get(path);
  },

  driversHistorical: async (year: number) => {
    return ergast.get(`/${year}/drivers.json`);
  },

  constructors: async (year: number) => {
    return ergast.get(`/${year}/constructors.json`);
  },
};
