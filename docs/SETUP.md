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
   | 6 | `supabase/migrations/20250101000006_admin.sql` | Admin accounts, live app settings (demo autopilot switch), admin ride cancel |
   | 7 | `supabase/migrations/20250101000007_ist_times.sql` | Show times in IST: dashboard sessions and the `ride_log` report |

   **Shortcut for a brand-new project:** `supabase/setup_all.sql` contains all of the files above in order, so you can paste and run that one file instead. (It's generated from `supabase/migrations/`; edit those, not it.)

   Supabase may warn that a query is "destructive". These scripts only drop and re-create their own security rules, so it's safe to click **Run query**.
   With the Supabase CLI you can instead run `supabase link` then `supabase db push`.
3. **Email sign-in:** *Authentication → Sign In / Providers → Email*. For a demo, turn **off** "Confirm email" so new accounts can log in immediately.
4. **Keys:** *Project Settings → API Keys*. Copy the **Project URL**, the **publishable** key (`sb_publishable_…`) and the **secret** key (`sb_secret_…`).
   The secret key goes **only** in `backend/.env`.

### Admin access

The admin dashboard lives at **`/admin`** (an *Admin* button appears in the app for admins). To make an account an admin:
1. Sign up in the app with that email (any role).
2. In Supabase → *SQL Editor*, run (with your email):
   ```sql
   insert into public.app_admins (user_id)
   select id from auth.users where email = 'you@example.com'
   on conflict do nothing;
   ```
3. Sign out and back in. To remove someone: `delete from public.app_admins where user_id = (select id from auth.users where email = '…');`

Admins see everyone's contact details, so never make the public demo accounts admins.

From the dashboard you can switch the **demo autopilot** on or off (takes effect within ~10 s, no redeploy), watch live and recent rides (cancel stuck rides, force-complete stuck trips), see drivers (take one offline), answer **support requests** (the user sees replies and status changes live), and browse users.

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
| `DEMO_AUTOPILOT` | no | `on` = autopilot demo drivers take rides when nobody else is available (for demos; see docs/TESTING.md). Default off. |
| `DEMO_AUTOPILOT_EMAILS` | no | Which demo accounts drive themselves (default `driver2@…` and `driver3@demo.ridehail.test`) |

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

## 7. Deploy to Vercel

Delta deploys as **two Vercel projects** from the same repo: the website (`frontend/`, a static Vite build) and the API (`backend/`, Express running as a serverless function through `backend/api/index.js`).

Live today: website **https://delta-pi-ochre.vercel.app**, API **https://delta-api-kappa.vercel.app** (team `the-pet-theory1`, projects `delta` and `delta-api`).

**Environment variables** (Vercel → project → *Settings → Environment Variables*, Production):

| Project | Variables |
|---|---|
| `delta-api` (backend) | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `FRONTEND_ORIGIN` (website URL; several allowed, comma-separated), `ROUTES_PROVIDER` (`mock` without a Google key) |
| `delta` (frontend) | `VITE_API_BASE_URL` (the API URL), `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` |

After changing any variable, **redeploy** that project (variables are read at build/start time).

**Deploying an update: just push to GitHub.** Both projects are connected to `github.com/joshilshah/Delta-2.0` (Vercel → project → *Settings → Git*; Root Directory `frontend` for `delta`, `backend` for `delta-api`). Every push to `main` deploys both to production; pushes to other branches get preview deployments.
```powershell
git add -A; git commit -m "Describe the change"; git push
```
Manual deploys still work if you ever need one (one-time `npx vercel login` first; in Windows PowerShell use `npx.cmd`):
```powershell
cd backend;  npx.cmd vercel deploy --prod
cd frontend; npx.cmd vercel deploy --prod
```

**Region matters most for speed.** Run the API in the Vercel region closest to your Supabase database, because one page needs several database queries. Your database is in Sydney (`ap-southeast-2`), so `backend/vercel.json` sets `"regions": ["syd1"]` (one query ≈ 20 ms instead of 250–780 ms from the US default). `GET /health` reports `db_ms` and `region` so you can check. If you create the Supabase project in another region, change `regions` to match (e.g. Mumbai `ap-south-1` → `bom1`, Singapore → `sin1`, US East → `iad1`).

**How it differs from a normal server:** Vercel has no always-on process, so the offer-expiry and support workers run inside API requests instead (throttled; see `housekeeping` in `backend/src/app.js`). The app polls every few seconds during matching, so offers still move on time. `.vercelignore` files keep `.env` files from ever being uploaded.

**On the live site:**
- `DEMO_AUTOPILOT=on` is set on `delta-api`, so a rider can book anywhere and an autopilot demo driver (Ravi or Meera) takes the ride by itself. To show the driver app instead, sign in as `driver1@demo.ridehail.test` and go online near the pickup: a real online driver always gets the request first. Remove the variable (and redeploy) to switch autopilot off.
- For Google sign-in, add `https://<your-site>.vercel.app/**` to Supabase → *Authentication → URL Configuration → Redirect URLs*.

## Troubleshooting

| Problem | Fix |
|---|---|
| `/health` says `database: down` | Check `SUPABASE_URL` and `SUPABASE_SECRET_KEY`, and that migration 3 ran (it grants the server access). |
| "This feature needs a database update" | Run `20250101000005_phase2.sql`. |
| SQL error *trailing junk after numeric literal* | You pasted the file **name** into the SQL editor. Paste the file's **contents**. |
| No drivers found | Drivers must be online with a location less than 2 minutes old and within 10 km. Run the seeder with `--watch`, or set the driver's *Location source* to *Demo* (Account → Preferences). |
| Fare estimate error | Add a Google server key, or set `ROUTES_PROVIDER=mock`. |
