# Architecture

## The big picture

```
 Browser (React)                    Backend (Express)                  Supabase
 ───────────────                    ─────────────────                  ────────
 pages / components  ──REST──▶  routes → controllers → services ──▶  PostgreSQL
 services/api.js     ◀─JSON──      (auth, validation, rules)   stores    (tables, SQL functions,
        ▲                                                                  Row Level Security)
        └──────────── Supabase Realtime (read-only, own rows) ◀──────────  Realtime
```

- **The browser never writes to the database.** Every change (booking, accepting, chat, support…) goes through the backend, which checks the signed-in user first.
- **The browser only reads its own rows**, and only to hear about changes instantly through Supabase Realtime. Every screen also polls the API every few seconds, so a dropped connection, a refresh or a reconnect always recovers the true state.
- The backend uses the Supabase **secret** key (bypasses RLS), so the backend services are where access decisions are made.

### Backend layers

| Layer | Folder | Job |
|---|---|---|
| Routes | `src/routes/` | URL → controller, plus role checks (`passenger`, `driver`, `anyRole`) |
| Middleware | `src/middleware/` | Verify the Supabase sign-in token; turn errors into JSON |
| Controllers | `src/controllers/` | Validate input with zod (`src/validation/schemas.js`), call a service, send the response |
| Services | `src/services/` | Business rules: fares, rides, dispatch, drivers, tracking, safety, support, activity |
| Stores | `src/stores/` | All database access. `supabaseStore.js` (RPC + tables) and `phase2Store.js` (simple table reads and writes) |
| Matching | `src/matching/` | Haversine distance, route-deviation maths, ETA estimate, driver ranking |

`src/app.js` wires these together from injected dependencies, so the tests run the whole HTTP stack against a real Postgres (PGlite) without Supabase or Google.

## Booking and matching

- **Fare:** `base ₹40 + distance_km × ₹12 + minutes × ₹2`, always computed on the server from Google Routes (or the labelled `mock` estimate). Numbers sent by the browser are ignored. The breakdown is saved with the ride.
- **Matching** is done by SQL functions in one transaction each, called only by the backend:
  1. `find_eligible_drivers`: online, location under 2 minutes old, no active ride, no pending offer, within 5 km (then 10 km), nearest first.
  2. `create_offer`: one pending offer per ride and per driver (unique indexes make two offers impossible).
  3. `accept_offer`: locks ride → offer → driver, re-checks everything, assigns the ride.
  4. A worker in the API process (every 2 s) expires 30-second offers and moves to the next driver, so expiry never depends on a browser being open.
  5. Nobody left → the ride becomes `unmatched`.
- **No double-booking:** a unique index allows one active ride per driver, and one open ride per passenger. Repeated clicks reuse the same booking (idempotency key).

### Ride states

```
requested → searching → accepted ──(driver arrives: arrived_at set)──▶ in_progress → completed
                │            │
                ▼            ▼
            unmatched    cancelled  (rider before the trip starts; driver while accepted)
```
A database trigger rejects any other transition. "Arrived" is a timestamp inside `accepted`, not a separate state.

## Live trip

- **Driver GPS:** the driver's browser sends a fix every 6 s during a ride (30 s when idle) to `POST /api/drivers/location`. The latest position updates `driver_locations`. During a ride the backend also appends to `ride_tracking_events`, but only when the driver moved 25 m or 30 s passed (fewer writes).
- **To the rider:** Realtime pushes each new tracking event and ride change. The app refetches the ride, which includes the driver's position and an **ETA** (straight line × 1.3 at 24 km/h, marked as an estimate). The map marker glides to the new position.
- **Arrival:** `mark_arrived()` sets `arrived_at` and inserts an automated chat message for the rider in the same transaction.
- **Chat:** `ride_messages`, only between the two participants, only while the ride is active. Readable afterwards in trip details.
- **Monitoring:** during the trip `trackingService` raises a *possible* alert when the car is far off the straight pickup→drop-off line, or hasn't moved for 5 minutes away from the destination. Riders review alerts ("I'm OK" / "Get help"). Nothing is escalated automatically.
- **Connection:** a banner appears when the device is offline or live updates drop; polling continues and the app catches up on reconnect.

## Privacy rules

| Data | Who can see it |
|---|---|
| Phone numbers | Only the matched rider / driver, only while the ride is `accepted` or `in_progress` |
| Names and car | The matched pair, also in trip history (never phones) |
| Driver's live position | That ride's rider, only while the ride is active |
| Offers shown to drivers | No rider identity at all |
| Trip share link | Anyone with the link: first names, car, route, live position. No phones. Dies when the trip ends, after 8 h, or when revoked. Only a hash of the token is stored. |
| Saved places, contacts, tickets | Only their owner |
| `ride_log` view | Only the project owner (Supabase dashboard / backend); no browser access |

## Database

| Table / view | Purpose | Migration |
|---|---|---|
| `profiles` | Name, email, phone, role (role can't change after setup) | 1, 4 |
| `drivers`, `driver_locations` | Vehicle, online status, latest position | 1 |
| `rides` | Every booking: route, fare, status, timestamps, `arrived_at` | 1, 5 |
| `ride_offers` | Every offer made to a driver and its outcome | 1 |
| `ride_messages` | In-ride chat and automated messages | 5 |
| `ride_tracking_events` | Driver path during a ride | 5 |
| `safety_alerts` | Route-deviation and long-stop alerts | 5 |
| `trip_shares` | Share links (token hash, expiry, revoked) | 5 |
| `emergency_contacts`, `saved_places` | Per-user safety contacts and Home / Work / favourites | 5 |
| `support_tickets`, `support_ticket_updates` | Support requests and their status timeline | 5 |
| `ride_log` (view) | Readable report of every booking | 5 |
| `app_admins` | Accounts allowed into `/admin` (no browser access) | 6 |
| `app_settings` | Live switches set from the admin dashboard, e.g. `demo_autopilot` (no browser access) | 6 |

## API

All routes are under `/api` and need a Supabase sign-in token, except the `public` ones.

| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/health` | public | API and database status |
| GET | `/api/public/pricing` | public | Published fare rates |
| GET | `/api/public/share/:token` | public | Shared trip (limited data) |
| GET | `/me`, `/me/profile`, `/me/overview` | any | Account, profile, activity numbers |
| POST | `/me/onboarding` | any | One-time setup for Google sign-ups |
| PATCH | `/me/profile` | any | Edit name, phone (and vehicle for drivers) |
| POST | `/fares/estimate` | rider | Fare before booking |
| POST | `/rides` | rider | Book (idempotent) |
| GET | `/rides/active`, `/rides/history`, `/rides/:id` | any | Current ride, history, one ride |
| POST | `/rides/:id/cancel` | any | Cancel |
| POST | `/rides/:id/arrived`, `/start`, `/complete` | driver | Ride steps |
| GET / POST | `/rides/:id/messages` | any | Chat |
| GET | `/rides/:id/path` | any | Driven path |
| GET | `/rides/:id/alerts` | rider | Safety alerts |
| GET / POST | `/rides/:id/shares` | rider | List / create share links |
| DELETE | `/shares/:id` | rider | Turn a share link off |
| POST | `/safety/alerts/:id` | rider | Dismiss an alert or ask for help |
| GET / POST / PATCH / DELETE | `/safety/contacts[/:id]` | any | Trusted contacts |
| GET | `/places/recent` | rider | Recent places from past bookings |
| GET / POST / PATCH / DELETE | `/places/saved[/:id]` | rider | Saved places |
| GET / POST | `/support/tickets` | any | List / create support requests |
| GET | `/support/tickets/:id` | any | One request and its updates |
| POST | `/support/tickets/:id/messages`, `/close` | any | Reply / close |
| PATCH | `/drivers/availability` | driver | Go online / offline |
| POST | `/drivers/location` | driver | Share location |
| GET | `/drivers/offers`, `/drivers/earnings` | driver | Pending requests, earnings |
| POST | `/offers/:id/accept`, `/reject` | driver | Respond to a request |

**Admin** (`/api/admin/*`, only for accounts in `app_admins`; checked on every request): `GET overview`, `GET rides?filter=live|completed|cancelled|all`, `POST rides/:id/action` (`cancel` / `complete`), `GET drivers`, `POST drivers/:id/offline`, `GET users`, `GET support/tickets?filter=…`, `GET support/tickets/:id`, `POST support/tickets/:id/respond`, `GET settings`, `PUT settings/autopilot`.

Errors always look like `{ "error": { "code": "…", "message": "…" } }`.

## Known limitations

- Drivers are not verified and there are no payments; fares are estimates.
- Without Google keys, distances, ETAs and route-deviation checks use straight lines (clearly labelled).
- The interactive Google live map is built but untested, because it needs a browser key.
- The dispatch and support workers run inside the API process. That's safe (every step is atomic SQL) but a production setup would run them separately.
- Driver location is shared only while the app is open in the foreground; there is no background tracking.
- Support "staff" replies are a demo automation (`supportService.staffUpdate` / auto-acknowledge). There is no staff dashboard yet.
- No rate limiting.

## Roadmap

**Phase 3:** driver tips, add-on services, multiple stops, vehicle types with their own prices, traffic-aware ETAs and ranking (Routes matrix, plugged in via `registerStrategy('eta', …)` in `src/matching/ranker.js`), a support staff dashboard, payments.
