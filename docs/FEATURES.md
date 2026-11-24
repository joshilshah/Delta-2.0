# Features and screens

## Public pages

| Page | Path | What's there |
|---|---|---|
| Landing | `/` | Live tour of real Bengaluru routes on a night map, tilting fare ticket, quick facts, how-it-works story, fare calculator on the live rates, driver section, footer |
| Our story | `/story` | Why Delta exists, a day in the city, what we believe, what the mark means |
| Shared trip | `/share/<token>` | What a trusted contact sees from a share link |
| Log in / Sign up | `/login`, `/signup` | Email or Google; new Google users choose a role once on `/onboarding` |

## Rider app

| Tab | Path | What's there |
|---|---|---|
| **Ride** | `/passenger/dashboard` (same as `/passenger/book`) | Map-first booking: your location as pickup, place search, tap the map, swap ends, saved and recent places, itemised fare, "Find driver" |
| Live ride | `/passenger/ride/<id>` | Matching radar and countdown → driver card, live marker and ETA, "has arrived" alert, Call / Chat / SMS, Safety & share, 112, cancel |
| **Activity** | `/passenger/activity` | Past trips with filters, totals, "Book again" |
| Trip details | `/passenger/trips/<id>` | Date and time, driver and car, final fare, real ride time, timeline, driven path, chat transcript, "Get help" |
| **Account** | `/passenger/account` | Activity numbers, profile, saved places, safety (trusted contacts), appearance, default map, help, Support |
| Support | `/passenger/support` | Report a problem, follow its status live, reply or close |

## Driver app

| Tab | Path | What's there |
|---|---|---|
| **Drive** | `/driver/dashboard` | Night cockpit: slide to go online, location status, settings. A new request takes over any screen with a mini map, countdown, chime and vibration |
| Active trip | `/driver/ride/<id>` | ETA to pickup, "Navigate in Google Maps", slide **Arrived** (rider is notified) → slide **Start** → slide **Complete**, Call / Chat / SMS |
| **Earnings** | `/driver/earnings` | 7-day chart, today's total, recent trips (each opens trip details) |
| **Account** | `/driver/account` | Availability, completed trips and earnings, profile and vehicle, trusted contacts, request sound, location source (Device / Demo), Support |

**Demo location source:** with *Account → Location source → Demo*, the car starts at a Bengaluru point and drives itself about 150 m every 6 s toward the pickup, then the drop-off. Use it when real GPS isn't available.

## Design language

- **Map-first.** On ride screens the map is the stage and the controls sit on a sheet (left on desktop, sliding up on phones).
- **Brand.** The mark is a "D" with a road winding through it; the wordmark is DELTΛ with an open, forward-pointing A; the tagline is *Move smarter*. Δ (delta, the symbol for change) shows up in map pins and progress steps.
- **Themes.** Light, Dark (grey or AMOLED black) or System, from the appearance button or Account. Riders start on System, drivers on Dark. All colours come from CSS variables in `frontend/src/index.css`, so every component and map follows the theme.
- **Type.** Geist for the interface, *Instrument Serif* italic for personality, Geist Mono for numbers and plates.
- **Colour.** Ink and paper, Delta blue `#2F5BFF` for action, lime `#D7FF3C` for anything live (on dark surfaces only). Muted text meets WCAG AA contrast in every theme.
- **Safe interactions.** Going online, arriving, starting and completing trips are slide-to-confirm (Enter for keyboard users).
- **Motion** is short and turned off for people who ask their device for reduced motion.
- **Responsive.** Every page is checked at phone width (375 px); large screens use the extra width instead of leaving it empty.

## Maps

- **Delta map** (default, no key): Leaflet + OpenStreetMap tiles, live markers, searching radar, tap-to-pick, driven path. For heavy production use, switch the tile server in `LiveMap.jsx` to a commercial provider.
- **Google Maps** switch on every map: without a key it's Google's public embed (a route view); with `VITE_GOOGLE_MAPS_BROWSER_KEY` it becomes an interactive Google map with live markers, the road route and Google's ETA.
- **Place search:** Google suggestions with a browser key, otherwise OpenStreetMap (Photon). "Choose on map" works for places no search knows, like a hostel gate.
- **Your location** is read once with permission and turned into an address by OpenStreetMap's Nominatim. That sends the coordinates to that service.
