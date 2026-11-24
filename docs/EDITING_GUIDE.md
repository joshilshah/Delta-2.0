# Editing guide

"I want to change X. Which file do I open?" Paths are relative to the project root.
After any frontend change the browser updates by itself (`npm run dev`). After a backend change, restart `npm start`.

## Look and brand

| I want to change… | Edit |
|---|---|
| Colours, light / dark / AMOLED themes | `frontend/src/index.css`: the `:root`, `.theme-night` and `.theme-amoled` blocks (`--c-bg`, `--c-fg`, `--c-live`…) and the fixed colours under `@theme` (`--color-accent` Delta blue, `--color-volt` lime) |
| Fonts | `frontend/index.html` (Google Fonts link) and `--font-sans / --font-serif / --font-mono` in `index.css` |
| Buttons, cards, inputs (shared styles) | `frontend/src/index.css` → `@layer components` (`.btn-primary`, `.btn-volt`, `.card`, `.input`…) |
| Page width on big screens | `.wrap` (content) and `.wrap-wide` (landing hero) in `index.css` |
| The logo mark | Replace `frontend/public/brand/delta-mark.png` (black shape on a transparent background; it's recoloured per theme automatically) |
| The browser-tab / app icon | `frontend/public/brand/icon-64.png`, `icon-192.png`, referenced in `frontend/index.html` |
| The "DELTΛ" wordmark or tagline | `Wordmark` in `frontend/src/components/Layout.jsx` |
| Default theme for riders / drivers | `frontend/src/context/ThemeContext.jsx` |
| Map look (tile colours) | Map CSS at the bottom of `index.css`; the tile server is `TILES` in `frontend/src/components/LiveMap.jsx` |

## Text and content

| I want to change… | Edit |
|---|---|
| Landing page headline, sections, ticker | `frontend/src/pages/Landing.jsx` (`PLACES` = the route tour, `TICKER` = the scrolling strip) |
| The Story page | `frontend/src/pages/Story.jsx` (`MOMENTS`, `PILLARS`, `MARK_PARTS` and the JSX below them) |
| Footer links and text | `frontend/src/components/SiteFooter.jsx` (`COLUMNS`) |
| Top menu on public pages | `frontend/src/components/PublicHeader.jsx` (`LINKS`) |
| App tabs (Ride / Activity / Account, Drive / Earnings / Account) | `useTabs` in `frontend/src/components/Layout.jsx` |
| Help FAQ | `FAQ` in `frontend/src/pages/Account.jsx` |
| Chat quick replies | `QUICK` in `frontend/src/components/RideChat.jsx` |
| The automated "driver has arrived" message | `mark_arrived` in `supabase/migrations/20250101000005_phase2.sql` (add a new migration with `create or replace function` to change it on an existing database) |
| Support categories | `CATEGORIES` in `frontend/src/pages/Support.jsx` **and** `ticketSchema` in `backend/src/validation/schemas.js` **and** the `category` check in the `support_tickets` table |
| Demo support auto-reply | `DEMO_TRIAGE_NOTE` in `backend/src/services/supportService.js` |
| Demo accounts, names, cars | `backend/scripts/seed-demo.js` |

## Business rules

| I want to change… | Edit |
|---|---|
| Prices (base, per km, per minute) | `backend/.env` (`BASE_FARE`, `PER_KM_RATE`, `PER_MINUTE_RATE`) or the defaults in `backend/src/config/index.js`. The landing page reads them live. |
| Fare formula itself | `backend/src/services/fareService.js` |
| Matching radius, offer time, location freshness | `backend/src/config/index.js` → `matching` (or the env variables) |
| How drivers are ranked | `backend/src/matching/ranker.js` (add a strategy and set `RANKING_STRATEGY`) |
| Ride states and who may cancel | `backend/src/services/rideStateMachine.js` **and** the `rides_before_update` trigger in migration 1 (both must agree) |
| What each person can see about the other (phones, names) | `backend/src/services/rideView.js` |
| Live tracking frequency, safety alert thresholds | `backend/src/config/index.js` → `tracking`; logic in `backend/src/services/trackingService.js` |
| Trip share link lifetime | `SHARE_HOURS` in `backend/src/services/safetyService.js` |
| Driver GPS update interval / demo drive speed | `frontend/src/context/LiveContext.jsx` (`intervalMs`) and `demoStepMeters` in `frontend/src/hooks/useDriverLocation.js` |

## Adding things

### A new page
1. Create `frontend/src/pages/MyPage.jsx` (copy a similar page, e.g. `Support.jsx`; wrap content in `<Page>` from `components/Layout.jsx`).
2. Add a route in `frontend/src/App.jsx`. Put it inside `<ProtectedRoute role="passenger">` or `role="driver"` if users must be signed in.
3. Link to it from a tab (`useTabs`), the Account page, or the footer.

### A new API endpoint
Follow the same four layers every endpoint uses:
1. **Route:** `backend/src/routes/index.js` (pick `passenger`, `driver` or `anyRole` for access).
2. **Controller:** `backend/src/controllers/index.js` (validate the body with a schema from `validation/schemas.js`).
3. **Service:** business logic in `backend/src/services/…`. Always use `req.user`, never an ID sent by the browser, to decide what someone may see.
4. **Store:** database access in `backend/src/stores/supabaseStore.js` (or `phase2Store.js` for simple table reads and writes).
Then call it from the frontend by adding one line to `frontend/src/services/api.js`, and add a test in `backend/tests/`.

### A database change
Never edit a migration that has already been run. Add a new file, e.g. `supabase/migrations/20250101000006_my_change.sql`, run it in the Supabase SQL editor, and:
- turn on Row Level Security for new tables and add a "read your own rows" policy (see migration 5 for examples);
- `grant all … to service_role` so the backend can use the table;
- add the table to the `supabase_realtime` publication if the app should update live.
Tests automatically run every migration in order, so `npm test` checks your new file too.

## Before you commit

```powershell
cd backend;  npm test; npm run lint
cd frontend; npm run lint; npm run build
```
And never commit a `.env` file.
