# Delta backend (Node.js + Express)

The API that holds all the business rules and talks to Supabase. Setup and env variables: [../docs/SETUP.md](../docs/SETUP.md).

```powershell
npm install
npm start              # http://localhost:3000  (health: /health)
npm test               # 69 tests on a real Postgres (PGlite)
npm run lint
npm run seed:demo      # demo rider + 3 drivers (add -- --watch during a demo)
npm run e2e            # end-to-end ride against the running API
```

| Folder | What's in it |
|---|---|
| `src/server.js` | Starts the API and the background workers |
| `src/app.js` | Wires services, controllers and routes together |
| `src/routes/` | Every URL and who may call it |
| `src/controllers/` | Request validation → service call → response |
| `src/services/` | Business logic, one file per area (fare, ride, dispatch, driver, tracking, safety, support, places, activity) |
| `src/stores/` | All database access |
| `src/matching/` | Distance maths and driver ranking |
| `src/validation/` | zod schemas for every request body |
| `src/config/` | Prices, matching and tracking settings (overridable from `.env`) |
| `scripts/` | Demo seeder and end-to-end check |
| `tests/` | Automated tests and their helpers |

How it fits together: [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md). Where to change things: [../docs/EDITING_GUIDE.md](../docs/EDITING_GUIDE.md).
