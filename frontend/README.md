# Delta frontend (React + Vite + Tailwind)

The website and app screens for riders and drivers. Setup and env variables: [../docs/SETUP.md](../docs/SETUP.md).

```powershell
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/
npm run lint
```

| Folder / file | What's in it |
|---|---|
| `src/App.jsx` | Every page route (public, rider, driver) |
| `src/pages/` | One file per screen. `passenger/` and `driver/` hold role-specific screens; shared ones (Account, Support, TripDetail, Story, Landing…) sit at the top level |
| `src/components/` | Reusable pieces: `Layout` (app shell, logo, tabs), `LiveMap` / `MapView` (maps), `RideTracker` (live ride), `RideChat`, `Safety`, `PublicHeader`, `SiteFooter`, `ui.jsx` (small UI parts) |
| `src/context/` | App-wide state: `AuthContext` (who's signed in), `LiveContext` (active ride, driver status, chat), `ThemeContext` (light/dark) |
| `src/hooks/` | `useLive` (realtime + polling), `useDriverLocation` (GPS sharing), small helpers |
| `src/services/api.js` | Every backend call in one place |
| `src/lib/` | Formatting, place search, sounds, sharing, Supabase client |
| `src/index.css` | Colours, themes, fonts, shared styles |
| `public/brand/` | Logo mark and app icons |

Where to change things: [../docs/EDITING_GUIDE.md](../docs/EDITING_GUIDE.md).
