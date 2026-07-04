import express from "express";
import authenticateToken from "../middleware/auth.js";
import * as pollingService from "../services/pollingService.js";

const router = express.Router();

// Get live race data
router.get("/race", authenticateToken, async (req, res) => {
  try {
    const season = req.query.season || new Date().getFullYear();
    const liveRace = await pollingService.getLiveRaceData(season);
    
    if (!liveRace) {
      // Fetch fresh data if not cached
      const data = await pollingService.fetchAndCacheRaceData(season);
      res.json(data?.liveRace || null);
    } else {
      res.json(liveRace);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all races for season
router.get("/races", authenticateToken, async (req, res) => {
  try {
    const season = req.query.season || new Date().getFullYear();
    const races = await pollingService.getCachedRaceData(season);
    
    if (!races) {
      const data = await pollingService.fetchAndCacheRaceData(season);
      res.json(data?.races || []);
    } else {
      res.json(races);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get race results for specific race
router.get("/race/:raceRound/results", authenticateToken, async (req, res) => {
  try {
    const season = req.query.season || new Date().getFullYear();
    const raceRound = req.params.raceRound;
    
    const results = await pollingService.fetchAndCacheRaceResults(season, raceRound);
    res.json(results || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
