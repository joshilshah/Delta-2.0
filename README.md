# DELTΛ — Move smarter

A real-time ride-hailing web app with a **rider app** and a **driver app**.
Riders see an itemised fare before booking, get matched with the nearest driver, follow the car live on a map, chat or call the driver, and share their trip.
Drivers go online, accept requests, navigate to the pickup, mark arrival, and track their earnings.

**Live demo:** https://delta-pi-ochre.vercel.app (deployment guide: [docs/SETUP.md § Deploy to Vercel](docs/SETUP.md#7-deploy-to-vercel))

> **Demo project.** Drivers are **unverified** (no licence or vehicle checks) and fares are estimates. Do not use it as a real transport service.

---

## What's inside

| | |
|---|---|
| **Booking** | Pickup from your location, place search, tap-the-map pins, saved places (Home / Work) and recent places |
| **Fares** | `₹40 base + ₹12/km + ₹2/min`, calculated on the server and shown line by line |
| **Matching** | Nearest driver first within 5 km, then 10 km; each driver gets 30 s; no double-booking (enforced in the database) |
| **Live trip** | Driver marker moving on the map, ETA, "driver has arrived" alert, in-app chat, call / SMS, driven path |
| **Safety** | Call 112, trusted contacts, revocable live trip-share link, alerts for route deviations and long stops |
| **Account** | Profile, ride activity, trip history with full trip details, support tickets with live status |
| **Driver** | Online / offline cockpit, full-screen requests, arrive / start / complete sliders, earnings |
| **Brand** | Light, dark (grey or AMOLED) themes, a Story page, landing page with a live route tour |

## Tech stack

| Part | Technology |
|---|---|
| Frontend | React 19, Vite, Tailwind CSS 4, React Router, Leaflet maps, Lucide icons |
| Backend | Node.js 20.6+ (Express 5, REST API, zod validation) |
| Database | Supabase: PostgreSQL, Auth, Row Level Security, Realtime |
| Maps | OpenStreetMap (no key needed); Google Maps / Places / Routes when keys are added |

## Quick start

You need **Node.js 20.6+** and a free **Supabase** project. Full details: [docs/SETUP.md](docs/SETUP.md).

1. **Database:** in Supabase → *SQL Editor*, run each file in [`supabase/migrations/`](supabase/migrations) in number order (1 → 5).
2. **Keys:** copy the example env files and fill them in (Supabase → *Project Settings → API Keys*):
   ```powershell
   Copy-Item backend\.env.example backend\.env
   Copy-Item frontend\.env.example frontend\.env
   ```
3. **Backend** (terminal 1):
   ```powershell
   cd backend; npm install; npm start
   ```
4. **Frontend** (terminal 2):
   ```powershell
   cd frontend; npm install; npm run dev
   ```
5. Open **http://localhost:5173**.

Optional demo accounts (rider + 3 drivers, password `DemoPass#2025`):
```powershell
cd backend; npm run seed:demo -- --watch
```
Rider: `passenger@demo.ridehail.test` · Drivers: `driver1@demo.ridehail.test` … `driver3@…`

## Project map

```
ride-hailing/
├── frontend/              React app (what users see)
│   ├── public/brand/      Logo mark and app icons
│   └── src/
│       ├── pages/         One file per screen (passenger/, driver/, shared pages)
│       ├── components/    Reusable UI pieces (maps, ride cards, chat, header, footer…)
│       ├── context/       App-wide state: signed-in user, live ride, theme
│       ├── hooks/         Live data, driver GPS, small helpers
│       ├── services/api.js  Every call to the backend, in one place
│       ├── lib/           Formatting, maps search, sounds, sharing
│       └── index.css      Colours, fonts, themes and shared styles
├── backend/               Node.js API (business rules + security)
│   ├── src/
│   │   ├── routes/        URL → controller (the full API list)
│   │   ├── controllers/   Validate the request, call a service
│   │   ├── services/      The business logic (fares, rides, dispatch, safety, support…)
│   │   ├── stores/        All database access
│   │   ├── matching/      Distance maths and driver ranking
│   │   ├── validation/    Request schemas (zod)
│   │   └── config/        Prices, matching radii, timings (env-configurable)
│   ├── scripts/           Demo data seeder and an end-to-end check
│   └── tests/             73 automated tests (run against real Postgres via PGlite)
├── supabase/
│   └── migrations/        Database schema, SQL functions, security rules (run in order)
└── docs/                  Setup, architecture, features, editing guide, testing
```

## Documentation

| Doc | Read it when you want to… |
|---|---|
| [docs/SETUP.md](docs/SETUP.md) | set up Supabase, Google keys, environment variables and run the app |
| [docs/EDITING_GUIDE.md](docs/EDITING_GUIDE.md) | change something: colours, prices, text, logo, a screen, an API |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | understand how booking, matching, live tracking and security work |
| [docs/FEATURES.md](docs/FEATURES.md) | see every screen and feature, and how the design works |
| [docs/TESTING.md](docs/TESTING.md) | run the tests or walk through a demo ride |

## Security

- **Never commit `.env` files.** They hold your keys; `.gitignore` already excludes them. Only the `.env.example` templates belong in Git.
- The Supabase **secret** key and any Google **server** key live only in `backend/.env`. The frontend only ever gets the **publishable** key.
- Every write goes through the backend, which checks who you are. Browser users can only read their own rows (Row Level Security).

## License

No license has been chosen yet. Add one (for example MIT) before others reuse the code.
