import express from "express";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Watchlist from "../models/Watchlist.js";
import authenticateToken from "../middleware/auth.js";

const router = express.Router();

const serializeWatchlist = (watchlist) => ({
  id: watchlist._id,
  userId: watchlist.userId,
  name: watchlist.name,
  drivers: watchlist.drivers,
  teams: watchlist.teams,
  races: watchlist.races,
  notifications: watchlist.notifications,
  createdAt: watchlist.createdAt
});

const serializeUser = (user, { includeWatchlist = false } = {}) => {
  const payload = {
    id: user._id,
    username: user.username,
    email: user.email,
    favoriteTeam: user.favoriteTeam,
    favoriteDriver: user.favoriteDriver,
    emailNotifications: user.emailNotifications,
    pushNotifications: user.pushNotifications,
    createdAt: user.createdAt
  };

  if (includeWatchlist) {
    payload.watchlist = Array.isArray(user.watchlist)
      ? user.watchlist.map(serializeWatchlist)
      : [];
  }

  return payload;
};

// Register
router.post("/register", async (req, res) => {
  try {
    const { email, username, password, favoriteTeam, favoriteDriver } = req.body;

    if (!email || !username || !password) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      return res.status(400).json({ error: "User already exists" });
    }

    const user = new User({
      email,
      username,
      password,
      favoriteTeam,
      favoriteDriver,
      emailNotifications: true,
      pushNotifications: true
    });

    await user.save();

    // Create default watchlist
    const watchlist = new Watchlist({
      userId: user._id,
      name: "My Favorites",
      notifications: {
        enabled: true,
        raceStart: true,
        qualifyingStart: true,
        practiceStart: false,
        driverIncident: true
      }
    });

    await watchlist.save();
    user.watchlist.push(watchlist._id);
    await user.save();

    const token = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRY }
    );

    res.status(201).json({
      message: "User registered successfully",
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    const user = await User.findOne({ email }).select("+password");
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRY }
    );

    res.json({
      message: "Login successful",
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        favoriteTeam: user.favoriteTeam,
        favoriteDriver: user.favoriteDriver
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get user profile
router.get("/profile", authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).populate("watchlist");
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json(serializeUser(user, { includeWatchlist: true }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update user preferences
router.put("/preferences", authenticateToken, async (req, res) => {
  try {
    const { favoriteTeam, favoriteDriver, emailNotifications, pushNotifications } = req.body;
    const updates = {
      ...(favoriteTeam !== undefined && { favoriteTeam }),
      ...(favoriteDriver !== undefined && { favoriteDriver }),
      ...(emailNotifications !== undefined && { emailNotifications }),
      ...(pushNotifications !== undefined && { pushNotifications })
    };

    const user = await User.findByIdAndUpdate(
      req.user.userId,
      updates,
      { new: true, runValidators: true }
    );

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json(serializeUser(user));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
