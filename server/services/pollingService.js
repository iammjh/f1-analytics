import axios from "axios";
import redisClient from "../config/redis.js";
import dotenv from "dotenv";

dotenv.config();

const JOLPICA_API = process.env.JOLPICA_API || "https://api.jolpi.ca/ergast/f1";

// Fetch and cache race data
export const fetchAndCacheRaceData = async (season = new Date().getFullYear()) => {
  try {
    // Fetch current season races
    const racesRes = await axios.get(`${JOLPICA_API}/${season}.json`);
    const races = racesRes.data.MRData.RaceTable.Races;

    // Cache races data for 1 hour
    await redisClient.setEx(
      `races:${season}`,
      3600,
      JSON.stringify(races)
    );

    // Identify upcoming/live race
    const now = new Date();
    let liveRace = null;
    let nextRace = null;

    for (const race of races) {
      const raceDate = new Date(race.date + "T" + (race.time || "15:00:00Z"));
      const hoursBefore = (raceDate - now) / (1000 * 60 * 60);

      if (hoursBefore > 0 && hoursBefore <= 24) {
        liveRace = { ...race, status: "upcoming", hoursUntilStart: Math.round(hoursBefore) };
        break;
      }
      if (hoursBefore > 24 && !nextRace) {
        nextRace = { ...race, hoursUntilStart: Math.round(hoursBefore) };
      }
    }

    if (liveRace) {
      await redisClient.setEx(
        `live:race:${season}`,
        600,
        JSON.stringify(liveRace)
      );
    }

    return { races, liveRace, nextRace };
  } catch (err) {
    console.error("✗ Race data fetch failed:", err.message);
    return null;
  }
};

// Fetch race results with real-time updates
export const fetchAndCacheRaceResults = async (season = new Date().getFullYear(), raceRound) => {
  try {
    const resultsRes = await axios.get(`${JOLPICA_API}/${season}/${raceRound}/results.json`);
    const results = resultsRes.data.MRData.RaceTable.Races[0];

    // Cache for 30 minutes
    await redisClient.setEx(
      `race:results:${season}:${raceRound}`,
      1800,
      JSON.stringify(results)
    );

    return results;
  } catch (err) {
    console.error("✗ Race results fetch failed:", err.message);
    return null;
  }
};

// Polling service - runs every X minutes when enabled via env
export function resolvePollingConfig() {
  const enabled = process.env.POLLING_ENABLED !== "false";
  const parsedInterval = Number.parseInt(process.env.POLL_INTERVAL_MINUTES ?? "5", 10);
  const intervalMinutes = Number.isFinite(parsedInterval)
    ? Math.min(Math.max(parsedInterval, 1), 1440)
    : 5;

  return { enabled, intervalMinutes };
}

export const startPollingService = (intervalMinutes = resolvePollingConfig().intervalMinutes) => {
  const config = resolvePollingConfig();
  if (!config.enabled) {
    console.log("○ Polling service disabled (POLLING_ENABLED=false)");
    return null;
  }

  const season = new Date().getFullYear();
  const intervalMs = intervalMinutes * 60 * 1000;

  const poll = async () => {
    console.log(`🔄 Polling race data [${new Date().toLocaleTimeString()}]`);
    const data = await fetchAndCacheRaceData(season);

    if (data?.liveRace) {
      console.log(`📍 Live race detected: ${data.liveRace.name}`);
    }
  };

  poll();
  const timer = setInterval(poll, intervalMs);

  console.log(`✓ Polling service started (interval: ${intervalMinutes} min)`);
  return timer;
};

// Get cached race data
export const getCachedRaceData = async (season) => {
  try {
    const cached = await redisClient.get(`races:${season}`);
    return cached ? JSON.parse(cached) : null;
  } catch (err) {
    console.error("✗ Cache retrieval failed:", err.message);
    return null;
  }
};

// Get live race data
export const getLiveRaceData = async (season) => {
  try {
    const cached = await redisClient.get(`live:race:${season}`);
    return cached ? JSON.parse(cached) : null;
  } catch (err) {
    console.error("✗ Live race retrieval failed:", err.message);
    return null;
  }
};

export default {
  fetchAndCacheRaceData,
  fetchAndCacheRaceResults,
  resolvePollingConfig,
  startPollingService,
  getCachedRaceData,
  getLiveRaceData
};
