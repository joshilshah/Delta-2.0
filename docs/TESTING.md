# Testing

## Automated checks

```powershell
cd backend;  npm test          # 69 tests
cd backend;  npm run lint
cd frontend; npm run lint
cd frontend; npm run build
```

The backend tests run the project's **real SQL migrations** on an in-process PostgreSQL (PGlite) with a small stand-in for Supabase Auth, then exercise the whole HTTP API. Files:

| File | Covers |
|---|---|
| `tests/unit.test.js` | Fare maths, Routes API client, distance and ranking, ride state machine |
| `tests/sql.test.js` | Database rules: Row Level Security, grants, role can't change, state-transition trigger |
| `tests/dispatch.test.js` | Matching: 5 km → 10 km, stale / offline / busy drivers skipped, reject and expiry → next driver, many riders at once, two drivers racing for one ride |
| `tests/api.test.js` | Sign-in, role checks, someone else's ride (404/403), validation, Google down (502), database down (503), double clicks, phone privacy, onboarding |
| `tests/phase2.test.js` | Arrival + automated message, chat rules, `ride_log`, throttled tracking, deviation and long-stop alerts, share links (no phones, revocable, dead after the trip), contacts and saved places privacy, support ticket lifecycle |

## End-to-end check against your real Supabase

With the backend running and the demo accounts seeded:
```powershell
cd backend
npm run e2e
```
It books a ride as the demo rider, accepts it as `driver1`, checks `ride_log`, chats both ways, checks the live location and ETA, marks arrival, confirms the automated message, then starts and completes the trip. It leaves one completed demo ride in the database.

## Manual demo (two windows)

1. `cd backend; npm run seed:demo -- --watch`
2. **Window 1 (rider):** log in as `passenger@demo.ridehail.test` (password `DemoPass#2025`). Pick a pickup and drop-off, check the fare, tap **Find driver**.
3. **Window 2 (driver, private window):** log in as `driver1@demo.ridehail.test`. If GPS isn't available, set *Account → Location source → Demo*. Go online and accept the request.
4. Driver: slide **Arrived**. The rider gets an alert and a chat message.
5. Try **Chat** both ways, **Safety & share** → share link (open it in a third window, signed out).
6. Driver: slide **Start**, watch the car move on the rider's map (Demo source), then **Complete**.
7. Open the trip from **Activity** / **Earnings** to see the full record and driven path. Check Supabase → Table Editor → `ride_log`.

The nearest online driver gets the request first. If several drivers are online, use the one closest to the pickup, or reject on the others.

## Manual checks that the automated tests don't cover

- Real phone GPS and location permissions (desktop browsers often block or approximate them).
- The interactive Google map and Google place suggestions (need a browser key).
- Google sign-in end to end (needs the OAuth setup in docs/SETUP.md).
