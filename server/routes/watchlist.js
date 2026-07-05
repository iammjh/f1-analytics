import express from "express";
import Watchlist from "../models/Watchlist.js";
import authenticateToken from "../middleware/auth.js";

const router = express.Router();
const VALID_ITEM_TYPES = new Set(["driver", "team", "race"]);
const WATCHLIST_ITEM_LIMIT = 50; // max items per bucket

// H1 FIX: safe error helper — never expose internals in production
const isDev = () => process.env.NODE_ENV === "development";
const safeErr = (err, fallback) => (isDev() ? err.message : fallback);

const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const findOwnedWatchlist = (watchlistId, userId) =>
  Watchlist.findOne({ _id: watchlistId, userId });

const normalizeItemValue = (type, value) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (type === "race") {
    const raceId = Number(value);
    return Number.isNaN(raceId) ? null : raceId;
  }
  return String(value);
};

// Get user watchlists
router.get("/", authenticateToken, async (req, res) => {
  try {
    const watchlists = await Watchlist.find({ userId: req.user.userId });
    res.json(watchlists);
  } catch (err) {
    console.error("[watchlist GET]", err);
    res.status(500).json({ error: safeErr(err, "Failed to fetch watchlists") });
  }
});

// Create watchlist
router.post("/", authenticateToken, async (req, res) => {
  try {
    const { name } = req.body;
    const watchlist = new Watchlist({
      userId: req.user.userId,
      name: name || "New Watchlist",
      drivers: [],
      teams: [],
      races: [],
      notifications: {
        enabled: true,
        raceStart: true,
        qualifyingStart: true,
        practiceStart: false,
        driverIncident: true
      }
    });
    await watchlist.save();
    res.status(201).json(watchlist);
  } catch (err) {
    console.error("[watchlist POST]", err);
    res.status(500).json({ error: safeErr(err, "Failed to create watchlist") });
  }
});

// Update watchlist
router.put("/:id", authenticateToken, async (req, res) => {
  try {
    const { name, drivers, teams, races, notifications } = req.body;
    const updates = {
      ...(name !== undefined && { name }),
      ...(Array.isArray(drivers) && { drivers }),
      ...(Array.isArray(teams) && { teams }),
      ...(Array.isArray(races) && { races }),
      ...(isObject(notifications) && { notifications })
    };

    const watchlist = await Watchlist.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.userId },
      updates,
      { new: true, runValidators: true }
    );

    if (!watchlist) {
      return res.status(404).json({ error: "Watchlist not found" });
    }

    res.json(watchlist);
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(404).json({ error: "Watchlist not found" });
    }
    console.error("[watchlist PUT]", err);
    res.status(500).json({ error: safeErr(err, "Failed to update watchlist") });
  }
});

// Add item to watchlist
router.post("/:id/add", authenticateToken, async (req, res) => {
  try {
    const { type, id } = req.body;

    if (!VALID_ITEM_TYPES.has(type)) {
      return res.status(400).json({ error: "Invalid item type" });
    }

    const itemValue = normalizeItemValue(type, id);
    if (itemValue === null) {
      return res.status(400).json({ error: "Invalid item id" });
    }

    const watchlist = await findOwnedWatchlist(req.params.id, req.user.userId);
    if (!watchlist) {
      return res.status(404).json({ error: "Watchlist not found" });
    }

    // H4 FIX: enforce size limit per bucket
    if (type === "driver") {
      if (watchlist.drivers.length >= WATCHLIST_ITEM_LIMIT) {
        return res.status(400).json({ error: `Driver limit reached (max ${WATCHLIST_ITEM_LIMIT})` });
      }
      if (!watchlist.drivers.includes(itemValue)) watchlist.drivers.push(itemValue);
    } else if (type === "team") {
      if (watchlist.teams.length >= WATCHLIST_ITEM_LIMIT) {
        return res.status(400).json({ error: `Team limit reached (max ${WATCHLIST_ITEM_LIMIT})` });
      }
      if (!watchlist.teams.includes(itemValue)) watchlist.teams.push(itemValue);
    } else if (type === "race") {
      if (watchlist.races.length >= WATCHLIST_ITEM_LIMIT) {
        return res.status(400).json({ error: `Race limit reached (max ${WATCHLIST_ITEM_LIMIT})` });
      }
      if (!watchlist.races.includes(itemValue)) watchlist.races.push(itemValue);
    }

    await watchlist.save();
    res.json(watchlist);
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(404).json({ error: "Watchlist not found" });
    }
    console.error("[watchlist add]", err);
    res.status(500).json({ error: safeErr(err, "Failed to add item") });
  }
});

// Remove item from watchlist
router.post("/:id/remove", authenticateToken, async (req, res) => {
  try {
    const { type, id } = req.body;

    if (!VALID_ITEM_TYPES.has(type)) {
      return res.status(400).json({ error: "Invalid item type" });
    }

    const itemValue = normalizeItemValue(type, id);
    if (itemValue === null) {
      return res.status(400).json({ error: "Invalid item id" });
    }

    const watchlist = await findOwnedWatchlist(req.params.id, req.user.userId);
    if (!watchlist) {
      return res.status(404).json({ error: "Watchlist not found" });
    }

    if (type === "driver") {
      watchlist.drivers = watchlist.drivers.filter(d => d !== itemValue);
    } else if (type === "team") {
      watchlist.teams = watchlist.teams.filter(t => t !== itemValue);
    } else if (type === "race") {
      watchlist.races = watchlist.races.filter(r => r !== itemValue);
    }

    await watchlist.save();
    res.json(watchlist);
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(404).json({ error: "Watchlist not found" });
    }
    console.error("[watchlist remove]", err);
    res.status(500).json({ error: safeErr(err, "Failed to remove item") });
  }
});

// Delete watchlist
router.delete("/:id", authenticateToken, async (req, res) => {
  try {
    const watchlist = await Watchlist.findOneAndDelete({
      _id: req.params.id,
      userId: req.user.userId
    });

    if (!watchlist) {
      return res.status(404).json({ error: "Watchlist not found" });
    }

    res.json({ message: "Watchlist deleted" });
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(404).json({ error: "Watchlist not found" });
    }
    console.error("[watchlist DELETE]", err);
    res.status(500).json({ error: safeErr(err, "Failed to delete watchlist") });
  }
});

export default router;
