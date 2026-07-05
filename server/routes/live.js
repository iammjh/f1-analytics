import express from "express";
import authenticateToken from "../middleware/auth.js";
import * as pollingService from "../services/pollingService.js";

const router = express.Router();

// H1 FIX: safe error helper
const isDev = () => process.env.NODE_ENV === "development";
const safeErr = (err, fallback) => (isDev() ? err.message : fallback);

// M3 FIX: validate and parse season query param
const parseSeason = (raw) => {
  const year = parseInt(raw, 10);
  const current = new Date().getFullYear();
  if (!raw) return current;
  if (isNaN(year) || year < 1950 || year > current + 1) return null;
  return year;
};

// Get live race data
router.get("/race", authenticateToken, async (req, res) => {
  const season = parseSeason(req.query.season);
  if (season === null) {
    return res.status(400).json({ error: "Invalid season. Must be a year between 1950 and current." });
  }
  try {
    const liveRace = await pollingService.getLiveRaceData(season);
    if (!liveRace) {
      const data = await pollingService.fetchAndCacheRaceData(season);
      res.json(data?.liveRace || null);
    } else {
      res.json(liveRace);
    }
  } catch (err) {
    console.error("[live GET /race]", err);
    res.status(500).json({ error: safeErr(err, "Failed to fetch live race data") });
  }
});

// Get all races for season
router.get("/races", authenticateToken, async (req, res) => {
  const season = parseSeason(req.query.season);
  if (season === null) {
    return res.status(400).json({ error: "Invalid season. Must be a year between 1950 and current." });
  }
  try {
    const races = await pollingService.getCachedRaceData(season);
    if (!races) {
      const data = await pollingService.fetchAndCacheRaceData(season);
      res.json(data?.races || []);
    } else {
      res.json(races);
    }
  } catch (err) {
    console.error("[live GET /races]", err);
    res.status(500).json({ error: safeErr(err, "Failed to fetch season races") });
  }
});

// Get race results for specific race
router.get("/race/:raceRound/results", authenticateToken, async (req, res) => {
  const season = parseSeason(req.query.season);
  if (season === null) {
    return res.status(400).json({ error: "Invalid season. Must be a year between 1950 and current." });
  }

  // M2 FIX: validate raceRound
  const raceRound = parseInt(req.params.raceRound, 10);
  if (isNaN(raceRound) || raceRound < 1 || raceRound > 30) {
    return res.status(400).json({ error: "Invalid race round. Must be a number between 1 and 30." });
  }

  try {
    const results = await pollingService.fetchAndCacheRaceResults(season, raceRound);
    res.json(results || {});
  } catch (err) {
    console.error("[live GET /race/:raceRound/results]", err);
    res.status(500).json({ error: safeErr(err, "Failed to fetch race results") });
  }
});

export default router;

