# Testing

## Automated checks

```powershell
cd backend;  npm test          # 73 tests
cd backend;  npm run lint
cd frontend; npm run lint
cd frontend; npm run build
```

The backend tests run the project's **real SQL migrations** on an in-process PostgreSQL (PGlite) with a small stand-in for Supabase Auth, then exercise the whole HTTP API. Files:

| File | Covers |
|---|---|
| `tests/unit.test.js` | Fare maths, Routes API client, distance and ranking, ride state machine |
| `tests/sql.test.js` | Database rules: Row Level Security, grants, role can't change, state-transition trigger |
| `tests/dispatch.test.js` | Matching: 5 km â†’ 10 km, stale / offline / busy drivers skipped, reject and expiry â†’ next driver, many riders at once, two drivers racing for one ride |
| `tests/api.test.js` | Sign-in, role checks, someone else's ride (404/403), validation, Google down (502), database down (503), double clicks, phone privacy, onboarding |
| `tests/phase2.test.js` | Arrival + automated message, chat rules, `ride_log`, throttled tracking, deviation and long-stop alerts, share links (no phones, revocable, dead after the trip), contacts and saved places privacy, support ticket lifecycle |

## End-to-end check against your real Supabase

With the backend running and the demo accounts seeded:
```powershell
cd backend
npm run e2e
```
It books a ride as the demo rider, accepts it as `driver1`, checks `ride_log`, chats both ways, checks the live location and ETA, marks arrival, confirms the automated message, then starts and completes the trip. It leaves one completed demo ride in the database.

## Investor demo (one window, autopilot)

With `DEMO_AUTOPILOT=on` (already on for the live site), you only need the rider app:

1. Sign in as `passenger@demo.ridehail.test` (password `DemoPass#2025`), choose a pickup and drop-off **anywhere**, tap **Find driver**.
2. Within ~15 s an autopilot demo driver (Ravi or Meera) accepts and says hello in the chat. A message notification appears.
3. Watch the car drive to you on the map with a live ETA (~1 min), then the **"has arrived"** alert and message.
4. About 10 s later the trip starts; the car drives the route to the drop-off (the planned trip sped up ~10Ã—, 45â€“90 s) and completes.
5. Open the trip from **Activity** to show the full record and the driven path. Meanwhile try **Chat**, **Safety & share** (open the share link on another device), or **Call 112** on screen.

How it works: autopilot drivers stay **offline** until a ride finds no other driver, then one appears ~1.2 km from the pickup and goes through the same accept â†’ arrive â†’ start â†’ complete steps as a real driver (`backend/src/services/demoService.js`). They go off duty again after each trip. A real driver online nearby (e.g. `driver1`) always gets the request first, so you can also demo the driver app.

## Manual demo (two windows)

1. `cd backend; npm run seed:demo -- --watch`
2. **Window 1 (rider):** log in as `passenger@demo.ridehail.test` (password `DemoPass#2025`). Pick a pickup and drop-off, check the fare, tap **Find driver**.
3. **Window 2 (driver, private window):** log in as `driver1@demo.ridehail.test`. If GPS isn't available, set *Account â†’ Location source â†’ Demo*. Go online and accept the request.
4. Driver: slide **Arrived**. The rider gets an alert and a chat message.
5. Try **Chat** both ways, **Safety & share** â†’ share link (open it in a third window, signed out).
6. Driver: slide **Start**, watch the car move on the rider's map (Demo source), then **Complete**.
7. Open the trip from **Activity** / **Earnings** to see the full record and driven path. Check Supabase â†’ Table Editor â†’ `ride_log`.

The nearest online driver gets the request first. If several drivers are online, use the one closest to the pickup, or reject on the others.

## Manual checks that the automated tests don't cover

- Real phone GPS and location permissions (desktop browsers often block or approximate them).
- The interactive Google map and Google place suggestions (need a browser key).
- Google sign-in end to end (needs the OAuth setup in docs/SETUP.md).
