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

// Polling service - runs every X minutes
export const startPollingService = (intervalMinutes = 5) => {
  const season = new Date().getFullYear();

  setInterval(async () => {
    console.log(`🔄 Polling race data [${new Date().toLocaleTimeString()}]`);
    const data = await fetchAndCacheRaceData(season);
    
    if (data && data.liveRace) {
      console.log(`📍 Live race detected: ${data.liveRace.name}`);
    }
  }, intervalMinutes * 60 * 1000);

  console.log(`✓ Polling service started (interval: ${intervalMinutes} min)`);
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
  startPollingService,
  getCachedRaceData,
  getLiveRaceData
};
