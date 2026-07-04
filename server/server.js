import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import connectDB from "./config/database.js";
import redisClient from "./config/redis.js";
import * as pollingService from "./services/pollingService.js";
import authRoutes from "./routes/auth.js";
import watchlistRoutes from "./routes/watchlist.js";
import liveRoutes from "./routes/live.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Connect to MongoDB
connectDB();

// Connect to Redis
redisClient.connect();

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/watchlist", watchlistRoutes);
app.use("/api/live", liveRoutes);

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "✓ Server running", timestamp: new Date().toISOString() });
});

// Start polling service (every 5 minutes)
pollingService.startPollingService(5);

// Error handling
app.use((err, req, res, next) => {
  console.error("Error:", err);
  res.status(500).json({ error: err.message || "Server error" });
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════╗
║  F1 ANALYTICS HUB - BACKEND       ║
║  Status: Running                   ║
║  Port: ${PORT}                        ║
║  Environment: ${process.env.NODE_ENV}       ║
╚════════════════════════════════════╝
  `);
});
