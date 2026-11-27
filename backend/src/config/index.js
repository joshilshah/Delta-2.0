// Central, environment-driven configuration. Pricing and matching knobs live here
// so they can be tuned without touching business logic.

const num = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

export function loadConfig(env = process.env) {
  return {
    nodeEnv: env.NODE_ENV ?? 'development',
    port: num(env.PORT, 3000),
    frontendOrigin: env.FRONTEND_ORIGIN ?? 'http://localhost:5173',

    supabase: {
      url: env.SUPABASE_URL ?? '',
      publishableKey: env.SUPABASE_PUBLISHABLE_KEY ?? '',
      secretKey: env.SUPABASE_SECRET_KEY ?? '',
    },

    maps: {
      serverKey: env.GOOGLE_MAPS_SERVER_KEY ?? '',
      // 'google' (default) or 'mock' (offline dev only: straight-line x 1.3, 25 km/h; clearly flagged in responses)
      provider: env.ROUTES_PROVIDER ?? 'google',
      timeoutMs: num(env.ROUTES_TIMEOUT_MS, 8000),
    },

    pricing: {
      currency: 'INR',
      baseFare: num(env.BASE_FARE, 40),
      perKmRate: num(env.PER_KM_RATE, 12),
      perMinuteRate: num(env.PER_MINUTE_RATE, 2),
    },

    matching: {
      radiiKm: [num(env.INITIAL_RADIUS_KM, 5), num(env.EXPANDED_RADIUS_KM, 10)],
      offerTtlSeconds: num(env.OFFER_TTL_SECONDS, 30),
      locationStaleSeconds: num(env.LOCATION_STALE_SECONDS, 120),
      workerIntervalMs: num(env.WORKER_INTERVAL_MS, 2000),
      rankingStrategy: env.RANKING_STRATEGY ?? 'proximity',
    },

    minTripMeters: num(env.MIN_TRIP_METERS, 100),

    // Live trip tracking + monitoring (see services/trackingService.js).
    tracking: {
      minMoveMeters: num(env.TRACK_MIN_MOVE_METERS, 25),
      maxSilenceSeconds: num(env.TRACK_MAX_SILENCE_SECONDS, 30),
      deviationMinKm: num(env.ALERT_DEVIATION_MIN_KM, 1.2),
      stopMinutes: num(env.ALERT_STOP_MINUTES, 5),
    },
    support: { triageAfterSeconds: num(env.SUPPORT_TRIAGE_SECONDS, 60) },

    // Demo autopilot drivers for live demos (see services/demoService.js). Off unless DEMO_AUTOPILOT=on.
    demo: {
      enabled: env.DEMO_AUTOPILOT === 'on',
      ...(env.DEMO_AUTOPILOT_EMAILS ? { emails: env.DEMO_AUTOPILOT_EMAILS.split(',').map((s) => s.trim()).filter(Boolean) } : {}),
    },
  };
}
