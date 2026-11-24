# Setup

Everything you need to run Delta on your own machine.

## 1. Prerequisites

- **Node.js 20.6 or newer** (developed on Node 26). Check with `node -v`.
- A free **Supabase** project: <https://supabase.com>.
- *Optional:* a **Google Cloud** project with billing, for Google place search, the interactive Google map and real road distances. Without it the app uses OpenStreetMap and clearly labelled estimates.

## 2. Supabase

1. Create a project at <https://supabase.com>.
2. **Create the database.** Open *SQL Editor → New query*. For each file below, open it, copy **all of its contents** (not the file name), paste, and click **Run**. Do them in this order:

   | # | File | What it adds |
   |---|---|---|
   | 1 | `supabase/migrations/20250101000001_schema.sql` | Tables: profiles, drivers, driver locations, rides, ride offers |
   | 2 | `supabase/migrations/20250101000002_dispatch_functions.sql` | Matching and ride-state SQL functions |
   | 3 | `supabase/migrations/20250101000003_rls.sql` | Security rules (Row Level Security) and Realtime |
   | 4 | `supabase/migrations/20250101000004_oauth_onboarding.sql` | Google sign-in support |
   | 5 | `supabase/migrations/20250101000005_phase2.sql` | Chat, arrival, live tracking, safety, support, saved places, the `ride_log` view |

   Supabase may warn that a query is "destructive". These scripts only drop and re-create their own security rules, so it's safe to click **Run query**.
   With the Supabase CLI you can instead run `supabase link` then `supabase db push`.
3. **Email sign-in:** *Authentication → Sign In / Providers → Email*. For a demo, turn **off** "Confirm email" so new accounts can log in immediately.
4. **Keys:** *Project Settings → API Keys*. Copy the **Project URL**, the **publishable** key (`sb_publishable_…`) and the **secret** key (`sb_secret_…`).
   The secret key goes **only** in `backend/.env`.

### See every booking

Supabase → *Table Editor* → **`ride_log`**: one readable row per booking with who booked it (name, email, phone), pickup → drop-off, the driver and car, status, fare, and the time of every step.

## 3. Environment variables

```powershell
Copy-Item backend\.env.example backend\.env
Copy-Item frontend\.env.example frontend\.env
```

**`backend/.env`**

| Variable | Required | What it is |
|---|---|---|
| `PORT` | yes | API port, `3000` |
| `SUPABASE_URL` | yes | Project URL, e.g. `https://abcd.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | yes | Used to verify sign-in tokens |
| `SUPABASE_SECRET_KEY` | yes | Server-only database access. **Never put this in the frontend.** |
| `FRONTEND_ORIGIN` | yes | Where the frontend runs, `http://localhost:5173` (CORS) |
| `GOOGLE_MAPS_SERVER_KEY` | no | Google Routes API for real road distance and time |
| `ROUTES_PROVIDER` | no | `google` (default) or `mock` = straight-line estimate, no key needed |
| `BASE_FARE`, `PER_KM_RATE`, `PER_MINUTE_RATE` | no | Prices (defaults 40 / 12 / 2) |
| `OFFER_TTL_SECONDS`, `INITIAL_RADIUS_KM`, `EXPANDED_RADIUS_KM`, `LOCATION_STALE_SECONDS` | no | Matching (defaults 30 / 5 / 10 / 120) |
| `TRACK_MIN_MOVE_METERS`, `TRACK_MAX_SILENCE_SECONDS` | no | How often the live path is saved (defaults 25 m / 30 s) |
| `ALERT_DEVIATION_MIN_KM`, `ALERT_STOP_MINUTES` | no | Safety alert thresholds (defaults 1.2 km / 5 min) |
| `SUPPORT_TRIAGE_SECONDS` | no | Demo auto-acknowledgement of support tickets (default 60 s) |
| `DEMO_PASSWORD` | no | Password for the demo accounts (default `DemoPass#2025`) |

If you have no Google server key, set `ROUTES_PROVIDER=mock`. Fares then use a straight-line estimate and the app labels it as such.

**`frontend/.env`**

| Variable | Required | What it is |
|---|---|---|
| `VITE_API_BASE_URL` | yes | Backend URL, `http://localhost:3000` |
| `VITE_SUPABASE_URL` | yes | Same Project URL as the backend |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | yes | The **publishable** key (safe for browsers) |
| `VITE_GOOGLE_MAPS_BROWSER_KEY` | no | Google place suggestions and the interactive Google live map |

Anything starting with `VITE_` is visible to anyone using the site, so only browser-safe keys go here.

## 4. Install and run

Terminal 1, the API (http://localhost:3000, health check at `/health`):
```powershell
cd backend
npm install
npm start
```
Terminal 2, the website (http://localhost:5173):
```powershell
cd frontend
npm install
npm run dev
```

On Windows, prefer `npm start` over `npm run dev` for the backend: the watch mode can restart the server in the middle of a request.

## 5. Demo accounts (optional)

```powershell
cd backend
npm run seed:demo -- --watch
```
Creates `passenger@demo.ridehail.test` and `driver1`–`driver3@demo.ridehail.test` (password `DemoPass#2025`), with unverified demo drivers online around central Bengaluru. `--watch` keeps their locations fresh; leave it running during a demo. It refuses to run when `NODE_ENV=production`.

## 6. Google (optional)

### Maps keys
In Google Cloud, enable **Maps JavaScript API**, **Places API (New)**, **Routes API** (and **Directions API** for the route line on the interactive Google map).
- **Browser key** → `VITE_GOOGLE_MAPS_BROWSER_KEY`. Restrict it to *HTTP referrers* (`http://localhost:5173/*` and your live site) and to Maps JavaScript + Places.
- **Server key** → `GOOGLE_MAPS_SERVER_KEY`. Restrict it to the Routes API (and your server's IP when deployed).

### Google sign-in
1. Google Cloud → *APIs and Services → Credentials → Create credentials → OAuth client ID* (Web application). Authorised redirect URI: `https://<your-project-ref>.supabase.co/auth/v1/callback`.
2. Supabase → *Authentication → Sign In / Providers → Google*: switch it on and paste the Client ID and Client secret.
3. Supabase → *Authentication → URL Configuration*: Site URL `http://localhost:5173`, and add `http://localhost:5173/**` to Redirect URLs.

New Google users choose their role and add a phone number once, on a setup screen.

## Troubleshooting

| Problem | Fix |
|---|---|
| `/health` says `database: down` | Check `SUPABASE_URL` and `SUPABASE_SECRET_KEY`, and that migration 3 ran (it grants the server access). |
| "This feature needs a database update" | Run `20250101000005_phase2.sql`. |
| SQL error *trailing junk after numeric literal* | You pasted the file **name** into the SQL editor. Paste the file's **contents**. |
| No drivers found | Drivers must be online with a location less than 2 minutes old and within 10 km. Run the seeder with `--watch`, or set the driver's *Location source* to *Demo* (Account → Preferences). |
| Fare estimate error | Add a Google server key, or set `ROUTES_PROVIDER=mock`. |
