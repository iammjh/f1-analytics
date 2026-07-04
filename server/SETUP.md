# F1 Analytics Hub - Phase 3 Setup Guide

> Note: `next-app` is now the preferred path for user-facing auth and watchlist work. This Express backend is mainly kept for legacy JWT flows, live-data polling, and related support services.

## Project Structure
```
f1-analytics/
├── server/                    # Backend (Node.js/Express)
│   ├── config/
│   │   ├── database.js       # MongoDB connection
│   │   └── redis.js          # Redis connection
│   ├── models/
│   │   ├── User.js          # User model with auth
│   │   └── Watchlist.js     # Watchlist model
│   ├── middleware/
│   │   └── auth.js          # JWT authentication
│   ├── routes/
│   │   ├── auth.js          # Auth endpoints
│   │   ├── watchlist.js     # Watchlist CRUD
│   │   └── live.js          # Live race data
│   ├── services/
│   │   ├── emailService.js  # Email notifications
│   │   └── pollingService.js # Redis polling
│   ├── .env                 # Environment variables
│   ├── package.json
│   └── server.js            # Main server file
└── next-app/                # Preferred frontend / full-stack app
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
MONGODB_URI=mongodb://localhost:27017/f1-analytics
JWT_SECRET=your_super_secret_jwt_key_change_this
JWT_EXPIRY=7d
REDIS_HOST=localhost
REDIS_PORT=6379
EMAIL_USER=your_email@gmail.com
EMAIL_PASSWORD=your_app_password
EMAIL_SERVICE=gmail
FRONTEND_URL=http://localhost:3000
```

### 3. Start MongoDB (if local)
```bash
# Windows
# Extract MongoDB and add to system PATH, then:
mongod

# Or use MongoDB Atlas (cloud)
# Update MONGODB_URI in .env with your Atlas connection string
```

### 4. Start Redis (if local)
```bash
# Windows
# Download Redis from https://github.com/microsoftarchive/redis/releases
redis-server

# Or use Redis Cloud
# Update Redis config in server/config/redis.js
```

### 5. Start Backend Server
```bash
npm start
# Or for development with auto-reload:
npm run dev
```

Expected output:
```
✓ MongoDB connected
✓ Redis connected
╔════════════════════════════════════╗
║  F1 ANALYTICS HUB - BACKEND       ║
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
- Prefer `next-app/app/api/auth` and `next-app/app/api/watchlist` for new auth/watchlist work.
- Use this Express backend when you need the legacy JWT endpoints or live-data support routes in `server/routes/live.js`.

## API Endpoints

### Authentication (legacy JWT backend)
- **POST** `/api/auth/register` - Create new account
- **POST** `/api/auth/login` - Login with email/password
- **GET** `/api/auth/profile` - Get user profile (requires auth)
- **PUT** `/api/auth/preferences` - Update user preferences

### Watchlist (legacy JWT backend)
- **GET** `/api/watchlist` - Get all watchlists
- **POST** `/api/watchlist` - Create new watchlist
- **PUT** `/api/watchlist/:id` - Update watchlist
- **POST** `/api/watchlist/:id/add` - Add item (driver/team/race)
- **POST** `/api/watchlist/:id/remove` - Remove item
- **DELETE** `/api/watchlist/:id` - Delete watchlist

### Live Data
- **GET** `/api/live/race` - Get current/upcoming race
- **GET** `/api/live/races` - Get all races for season
- **GET** `/api/live/race/:raceRound/results` - Get race results

All endpoints (except auth/register & auth/login) require `Authorization: Bearer <token>` header.
For the primary user-facing watchlist flow in the current app, use the authenticated Next.js routes instead.

## Features Implemented

### Phase 3 - Live & Auth (Current)
✅ User authentication (register/login with JWT)
✅ Personal profile management
✅ Watchlist creation and management (drivers, teams, races)
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

Use these to test login:
- Email: test@example.com
- Password: testpass123

(Note: Create an account first via register)

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
