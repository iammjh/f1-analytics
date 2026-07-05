# F1 Analytics Hub

Full-stack Formula 1 analytics platform with dashboards, live race views, and personalized watchlists.

## About

F1 Analytics Hub is built to make race data easier to explore for both casual fans and data-focused users. It combines historical championship data with near real-time updates so users can move from season trends to live context in one place.

The project is organized as a modern web app (`next-app`) plus a backend service (`server`) for authentication, watchlist workflows, polling, and notifications. It is designed around practical usage: sign in, follow drivers/teams/races, and monitor updates without digging across multiple external data sources.

## Current Architecture Direction

- `next-app` is the application for auth, watchlists, dashboards, and API routes.
- `server` runs background support services only (Redis polling, email notifications).

### What this project focuses on
- Clear race and standings insights
- Fast access to live and historical data
- Personal watchlists and user-specific tracking
- Extensible architecture for new analytics modules

## Key Features
- Driver and constructor standings
- Race results and analytics views
- Live dashboard and telemetry-oriented pages
- User authentication and protected routes
- Watchlists with notification-ready backend services

## Tech Stack
- Frontend: Next.js, React, Tailwind CSS, NextAuth
- Backend: Node.js, Express, MongoDB, Redis
- Data: JOLPICA/Ergast F1 API + internal API routes

## Quick Start

### 1) Run backend support services
```bash
cd server
npm install
npm start
```

### 2) Run frontend
```bash
cd next-app
npm install
npm run dev
```

Frontend: `http://localhost:3000`

For backend environment setup, see [server/SETUP.md](server/SETUP.md).
For user-facing auth/watchlist flows, start in `next-app`.

## Project Structure
```
f1-analytics/
├── next-app/    # Next.js frontend
├── server/      # Express backend
├── docker-compose.yml
└── README.md
```

## Environment Notes
- Backend uses a `.env` file for database, auth, Redis, and email settings.
- Frontend consumes API/auth configuration from the Next.js app setup.

## Status
Active development.
