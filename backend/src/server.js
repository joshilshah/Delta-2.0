import { loadConfig } from './config/index.js';
import { createApp } from './app.js';
import { createRouteService } from './services/routeService.js';
import { createSupabaseClients, createSupabaseStore } from './stores/supabaseStore.js';
import { createSupabaseTokenVerifier } from './middleware/auth.js';

const config = loadConfig();

const missing = [
  ['SUPABASE_URL', config.supabase.url],
  ['SUPABASE_PUBLISHABLE_KEY', config.supabase.publishableKey],
  ['SUPABASE_SECRET_KEY', config.supabase.secretKey],
].filter(([, v]) => !v).map(([k]) => k);

if (missing.length) {
  console.error(`\nMissing required environment variables: ${missing.join(', ')}`);
  console.error('Copy backend/.env.example to backend/.env and fill them in (see README, "Supabase configuration").\n');
  process.exit(1);
}
if (config.maps.provider === 'google' && !config.maps.serverKey) {
  console.warn('[warn] GOOGLE_MAPS_SERVER_KEY is not set: fare estimates will fail until it is. ' +
    'For offline development only you may set ROUTES_PROVIDER=mock.');
}
if (config.maps.provider === 'mock') {
  console.warn('[warn] ROUTES_PROVIDER=mock: distances are straight-line estimates, NOT Google Routes data.');
}

const { authClient, adminClient } = createSupabaseClients(config.supabase);
const store = createSupabaseStore(adminClient);
const routeService = createRouteService({
  apiKey: config.maps.serverKey, provider: config.maps.provider, timeoutMs: config.maps.timeoutMs,
});

const { app, dispatchService, supportService } = createApp({
  config, store, routeService, verifyToken: createSupabaseTokenVerifier(authClient),
});

// Server-side offer expiry + dispatch recovery. Does not depend on any browser being open.
dispatchService.startWorker({ intervalMs: config.matching.workerIntervalMs });

// Demo support desk automation: acknowledge new tickets after a minute (see supportService).
let triageWarned = false;
setInterval(() => supportService.autoTriage().catch((err) => {
  if (!triageWarned) { console.warn(`[support] triage skipped: ${err.message}`); triageWarned = true; }
}), 30_000).unref();

app.listen(config.port, () => {
  console.log(`Ride-hailing API listening on http://localhost:${config.port}`);
  console.log(`Offer TTL ${config.matching.offerTtlSeconds}s | radii ${config.matching.radiiKm.join('/')} km | ` +
    `routes: ${config.maps.provider}`);
});
