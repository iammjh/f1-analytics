# F1 Analytics Hub - Phase 3 Setup Guide

> Note: `next-app` owns all user auth, watchlists, and API routes. This Express service is background polling + Redis cache only.

## Project Structure
```
f1-analytics/
├── server/                    # Background support service
│   ├── config/
│   │   └── redis.js          # Redis connection
│   ├── services/
│   │   ├── emailService.js  # Email notifications
│   │   └── pollingService.js # Race data polling → Redis
│   ├── .env                 # Environment variables
│   ├── package.json
│   └── server.js            # Health check + polling worker
└── next-app/                # Next.js app (auth, watchlists, dashboards)
```

## Prerequisites
- Node.js 16+
- MongoDB (local or Atlas)
- Redis (local or Cloud)
- Gmail account (for email testing)

## Backend Setup

### 1. Install Dependencies
```bash
cd server
npm install
```

### 2. Configure Environment (.env)
```
PORT=5000
NODE_ENV=development
POLLING_ENABLED=true
POLL_INTERVAL_MINUTES=5
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
JOLPICA_API=https://api.jolpi.ca/ergast/f1
EMAIL_USER=your_email@gmail.com
EMAIL_PASSWORD=your_app_password
EMAIL_SERVICE=gmail
FRONTEND_URL=http://localhost:3000
ALLOWED_ORIGINS=http://localhost:3000
```

**Polling notes:**
- Set `POLLING_ENABLED=false` to run the support service without Jolpica background fetches.
- `POLL_INTERVAL_MINUTES` accepts 1–1440 (default 5).

**Redis password notes:**
- **Local dev, no Docker:** empty `REDIS_PASSWORD` is fine if Redis only listens on `127.0.0.1`.
- **Local dev with `docker-compose`:** Redis runs with `--requirepass` — set the same password in `server/.env` and root `.env` (`REDIS_PASSWORD=...`).
- **Production:** `REDIS_PASSWORD` is **required** — the support service refuses to start without it when `NODE_ENV=production`.

Auth and MongoDB are configured in `next-app/.env.local` (NextAuth + Prisma).

### 3. Start Redis (if local)
```bash
# Windows
# Download Redis from https://github.com/microsoftarchive/redis/releases
redis-server

# Or use Redis Cloud
# Update Redis config in server/config/redis.js
```

### 4. Start support service
```bash
npm start
# Or for development with auto-reload:
npm run dev
```

Expected output:
```
✓ Redis connected
╔════════════════════════════════════╗
║  F1 ANALYTICS HUB - SUPPORT SVC   ║
║  Status: Running                   ║
║  Port: 5000                        ║
║  Environment: development          ║
╚════════════════════════════════════╝

✓ Polling service started (interval: 5 min)
```

## Frontend Setup

### 1. Start the Next.js app
```bash
cd ../next-app
npm install
npm run dev
```

### 2. Open in Browser
```
http://localhost:3000
```

### 3. Development Direction
- **Auth and watchlists:** use Next.js only — `next-app/app/auth/signin` and `next-app/app/api/*`.
- **This Express service:** background race-data polling, Redis cache, and email notifications only.

## API Endpoints

### Express backend (support services)
- **GET** `/api/health` — server health check

### User-facing APIs (Next.js — port 3000)
- **NextAuth:** `/api/auth/*` — sign-in, sign-up (credentials + OAuth)
- **Watchlist:** `/api/watchlist` — CRUD (session cookie auth)
- **Live / telemetry:** `/api/live/race`, `/api/telemetry`, etc.

## Features Implemented

### Phase 3 - Live & Auth (Current)
✅ User authentication via NextAuth (Next.js) — credentials + OAuth
✅ Personal profile and preferences (Prisma)
✅ Watchlist creation and management (Next.js API routes)
✅ Email notifications for race alerts
✅ Redis-based race data polling (every 5 minutes)
✅ Live race dashboard showing upcoming/active races
✅ Push notification support (UI ready, hooks in place)

### Phase 2 - Analytics (Previous)
✅ Circuit explorer with sector data
✅ Pit stop strategy visualizer
✅ Driver head-to-head comparison

### Phase 1 - Fundamentals (Previous)
✅ Driver standings
✅ Constructor standings
✅ Race results with filtering
✅ Driver profiles
✅ Constructor profiles
✅ Points progression charts

## Testing Credentials

Create an account at `http://localhost:3000/auth/signin` (Create Account tab), or sign in with GitHub/Google if configured.

## Troubleshooting

**"Cannot connect to MongoDB"**
- Ensure MongoDB is running
- Check MONGODB_URI in .env is correct
- If using Atlas, ensure IP whitelist includes your IP

**"Cannot connect to Redis"**
- Ensure Redis server is running
- Check REDIS_HOST and REDIS_PORT in config
- Verify redis-server process is active

**"Email not sending"**
- Generate Gmail app-specific password: https://myaccount.google.com/apppasswords
- Update EMAIL_PASSWORD in .env with app password (not your Gmail password)
- Enable "Less secure app access" if needed

**"CORS errors in frontend"**
- Ensure FRONTEND_URL in .env matches your frontend URL
- Check that Express cors middleware is initialized

## Next Steps (Phase 4+)

- [ ] Real-time WebSocket updates (replace polling)
- [ ] Advanced push notifications with service workers
- [ ] Race telemetry (DRS, tire compounds, sector times)
- [ ] Prediction algorithms and odds
- [ ] Session playback and replay analysis
- [ ] Mobile app (React Native)
- [ ] PDF report export
- [ ] Dark mode toggle (already styled)

## Support

For issues, check:
1. Server logs in terminal
2. MongoDB connection status
3. Redis service status
4. Browser console for frontend errors
5. Network tab for API calls

---

**Last Updated:** March 2026
**Status:** Phase 3 - Live & Auth (In Progress)
