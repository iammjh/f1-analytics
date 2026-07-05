import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import redisClient from "./config/redis.js";
import * as pollingService from "./services/pollingService.js";
// User auth, watchlists, and live HTTP APIs live in next-app (NextAuth + Prisma).

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;


const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS || process.env.FRONTEND_URL || 'http://localhost:3000'
)
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// Middleware
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (curl, server-to-server, Postman in dev)
      if (!origin) return callback(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin '${origin}' not allowed`));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: '50kb' })); // also cap request body size

// Connect to Redis
redisClient.connect();

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "✓ Server running", timestamp: new Date().toISOString() });
});

// Background race-data polling (disable with POLLING_ENABLED=false in server/.env)
pollingService.startPollingService();

// Error handling
app.use((err, req, res, next) => {
  console.error("Error:", err);
  const isDev = process.env.NODE_ENV === "development";
  res.status(500).json({ error: isDev ? err.message : "Internal server error" });
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════╗
║  F1 ANALYTICS HUB - SUPPORT SVC   ║
║  Status: Running                   ║
║  Port: ${PORT}                        ║
║  Environment: ${process.env.NODE_ENV}       ║
╚════════════════════════════════════╝
  `);
});
