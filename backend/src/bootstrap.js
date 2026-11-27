import { loadConfig } from './config/index.js';
import { createApp } from './app.js';
import { createRouteService } from './services/routeService.js';
import { createSupabaseClients, createSupabaseStore } from './stores/supabaseStore.js';
import { createSupabaseTokenVerifier } from './middleware/auth.js';

/**
 * Build the real app from environment variables. Shared by:
 *  - src/server.js  (a normal long-running server: `npm start`)
 *  - api/index.js   (Vercel serverless functions)
 * Returns { config, missing } plus { app, dispatchService, supportService } when the config is complete.
 */
export function buildFromEnv({ housekeeping = false } = {}) {
  const config = loadConfig();
  const missing = [
    ['SUPABASE_URL', config.supabase.url],
    ['SUPABASE_PUBLISHABLE_KEY', config.supabase.publishableKey],
    ['SUPABASE_SECRET_KEY', config.supabase.secretKey],
  ].filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) return { config, missing };

  if (config.maps.provider === 'google' && !config.maps.serverKey) {
    console.warn('[warn] GOOGLE_MAPS_SERVER_KEY is not set: fare estimates will fail until it is. '
      + 'Set ROUTES_PROVIDER=mock to use straight-line estimates instead.');
  }

  const { authClient, adminClient } = createSupabaseClients(config.supabase);
  const store = createSupabaseStore(adminClient);
  const routeService = createRouteService({
    apiKey: config.maps.serverKey, provider: config.maps.provider, timeoutMs: config.maps.timeoutMs,
  });
  const built = createApp({
    config, store, routeService, verifyToken: createSupabaseTokenVerifier(authClient), housekeeping,
  });
  return { config, missing, ...built };
}
