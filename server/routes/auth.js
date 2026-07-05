import express from "express";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import User from "../models/User.js";
import Watchlist from "../models/Watchlist.js";
import authenticateToken from "../middleware/auth.js";

const router = express.Router();

// ── Rate limiters ─────────────────────────────────────────────────────────────

// Strict limiter for login — prevent brute-force attacks
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15-minute window
  max: 10,                   // max 10 attempts per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again in 15 minutes." },
  skipSuccessfulRequests: true, // don't count successful logins toward limit
});

// Moderate limiter for registration — prevent account spam
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1-hour window
  max: 5,                    // max 5 accounts per IP per hour
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many accounts created from this IP. Please try again in 1 hour." },
});


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
router.post("/register", registerLimiter, async (req, res) => {
  try {
    const { email, username, password, favoriteTeam, favoriteDriver } = req.body;

    // H2 FIX: field-level validation with max lengths and stricter rules
    if (!email || !username || !password) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Max length guards — prevents DoS via large payloads
    if (typeof email !== "string" || email.length > 254) {
      return res.status(400).json({ error: "Invalid email" });
    }
    if (typeof username !== "string" || username.length < 2 || username.length > 30) {
      return res.status(400).json({ error: "Username must be 2–30 characters" });
    }
    if (typeof password !== "string" || password.length < 8 || password.length > 128) {
      return res.status(400).json({ error: "Password must be 8–128 characters" });
    }

    // Stricter email format check (RFC 5322 simplified)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: "Invalid email format" });
    }

    // Sanitize optional fields — strip to string and cap length
    const safeTeam   = typeof favoriteTeam   === "string" ? favoriteTeam.slice(0, 50)   : undefined;
    const safeDriver = typeof favoriteDriver === "string" ? favoriteDriver.slice(0, 50) : undefined;

    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      return res.status(400).json({ error: "An account with those details already exists" });
    }

    const user = new User({
      email: email.toLowerCase().trim(),
      username: username.trim(),
      password,
      favoriteTeam: safeTeam,
      favoriteDriver: safeDriver,
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
    console.error("[register]", err);
    const msg = process.env.NODE_ENV === "development" ? err.message : "Registration failed";
    res.status(500).json({ error: msg });
  }
});
router.post("/login", loginLimiter, async (req, res) => {
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
    console.error("[login]", err);
    const msg = process.env.NODE_ENV === "development" ? err.message : "Login failed";
    res.status(500).json({ error: msg });
  }
});
router.get("/profile", authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).populate("watchlist");
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json(serializeUser(user, { includeWatchlist: true }));
  } catch (err) {
    console.error("[profile]", err);
    const msg = process.env.NODE_ENV === "development" ? err.message : "Failed to fetch profile";
    res.status(500).json({ error: msg });
  }
});
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
    console.error("[preferences]", err);
    const msg = process.env.NODE_ENV === "development" ? err.message : "Failed to update preferences";
    res.status(500).json({ error: msg });
  }
});

export default router;
