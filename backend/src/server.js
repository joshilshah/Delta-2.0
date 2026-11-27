// Long-running server (local development, or any host that keeps a process running).
// For Vercel, see api/index.js instead.
import { buildFromEnv } from './bootstrap.js';

const { config, missing, app, dispatchService, supportService, demoService } = buildFromEnv();

if (missing.length) {
  console.error(`\nMissing required environment variables: ${missing.join(', ')}`);
  console.error('Copy backend/.env.example to backend/.env and fill them in (see docs/SETUP.md).\n');
  process.exit(1);
}
if (config.maps.provider === 'mock') {
  console.warn('[warn] ROUTES_PROVIDER=mock: distances are straight-line estimates, NOT Google Routes data.');
}

// Server-side offer expiry + dispatch recovery. Does not depend on any browser being open.
dispatchService.startWorker({ intervalMs: config.matching.workerIntervalMs });

// Demo support desk automation: acknowledge new tickets after a minute (see supportService).
let triageWarned = false;
setInterval(() => supportService.autoTriage().catch((err) => {
  if (!triageWarned) { console.warn(`[support] triage skipped: ${err.message}`); triageWarned = true; }
}), 30_000).unref();

// Demo autopilot drivers: accept, drive, arrive, start and complete on their own while switched on
// (admin dashboard switch, defaulting to DEMO_AUTOPILOT). The tick does nothing when it's off.
{
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try { await demoService.tick(); } catch (err) { console.warn(`[demo] ${err.message}`); } finally { busy = false; }
  }, 2000).unref();
}

app.listen(config.port, () => {
  console.log(`Ride-hailing API listening on http://localhost:${config.port}`);
  console.log(`Offer TTL ${config.matching.offerTtlSeconds}s | radii ${config.matching.radiiKm.join('/')} km | `
    + `routes: ${config.maps.provider}`);
});
