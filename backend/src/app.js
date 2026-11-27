import express from 'express';
import cors from 'cors';
import { createControllers } from './controllers/index.js';
import { createRouter } from './routes/index.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { createFareService } from './services/fareService.js';
import { createDispatchService } from './services/dispatchService.js';
import { createRideService } from './services/rideService.js';
import { createDriverService } from './services/driverService.js';
import { createPlacesService } from './services/placesService.js';
import { createActivityService } from './services/activityService.js';
import { createTrackingService } from './services/trackingService.js';
import { createSafetyService } from './services/safetyService.js';
import { createSupportService } from './services/supportService.js';
import { createDemoService } from './services/demoService.js';
import { createAdminService } from './services/adminService.js';

/**
 * Wire everything together from injected dependencies (store, routeService, verifyToken),
 * so the whole HTTP stack can be exercised in tests without Supabase or Google.
 */
export function createApp({
  config, store, routeService, verifyToken, logger = console, housekeeping = false, demoClock = () => Date.now(),
}) {
  const fareService = createFareService({ routeService, pricing: config.pricing });
  let demoService = null; // created below; dispatch only calls it when no driver is available
  const dispatchService = createDispatchService({
    store, matching: config.matching, logger, onNoDrivers: (ride) => demoService?.provideDriver(ride),
  });
  const rideService = createRideService({
    store, fareService, dispatchService, minTripMeters: config.minTripMeters,
  });
  const trackingService = createTrackingService({ store, tracking: config.tracking, logger });
  demoService = createDemoService({ store, trackingService, demo: config.demo, logger, now: demoClock });
  const driverService = createDriverService({
    store, dispatchService, staleSeconds: config.matching.locationStaleSeconds, trackingService, logger,
  });
  const placesService = createPlacesService({ store });
  const activityService = createActivityService({ store });
  const supportService = createSupportService({ store, triageAfterSeconds: config.support?.triageAfterSeconds ?? 60 });
  const safetyService = createSafetyService({ store, supportService });
  const adminService = createAdminService({ store, demoService, supportService });
  const controllers = createControllers({
    rideService, driverService, placesService, activityService, trackingService, safetyService, supportService, adminService, store,
  });
  const auth = createAuthMiddleware({ verifyToken, store });

  const app = express();
  app.disable('x-powered-by');
  // FRONTEND_ORIGIN may list several sites, comma-separated (e.g. the Vercel URL and localhost).
  const origins = String(config.frontendOrigin).split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
  app.use(cors({ origin: origins.length > 1 ? origins : origins[0], credentials: false }));
  app.use(express.json({ limit: '20kb' }));

  // Serverless hosts (Vercel) have no always-on process for the background workers, so the same jobs run
  // here instead, at most once per interval per instance, piggy-backing on the app's own polling
  // (the rider and driver screens poll every 2-3 s while a ride is being matched).
  // `housekeeping` is either true (await the jobs) or a function that keeps a promise alive after the response
  // is sent (Vercel's waitUntil). The deferred form never slows a request down.
  if (housekeeping) {
    const defer = typeof housekeeping === 'function' ? housekeeping : null;
    let lastSweep = 0;
    let lastTriage = 0;
    app.use(async (req, _res, next) => {
      if (req.path === '/health' || req.path.startsWith('/api/public/')) return next();
      const now = Date.now();
      const jobs = [];
      if (now - lastSweep >= config.matching.workerIntervalMs) {
        lastSweep = now;
        jobs.push(dispatchService.sweep().catch((err) => logger.error(`[housekeeping] sweep failed: ${err.message}`)));
        jobs.push(demoService.tick().catch((err) => logger.error(`[housekeeping] demo failed: ${err.message}`)));
      }
      if (now - lastTriage >= 30_000) {
        lastTriage = now;
        jobs.push(supportService.autoTriage().catch(() => {}));
      }
      if (jobs.length) {
        const all = Promise.all(jobs);
        if (defer) defer(all); else await all;
      }
      next();
    });
  }

  app.get('/health', async (_req, res) => {
    try {
      const t0 = Date.now();
      await store.ping();
      // db_ms = one database round trip from wherever this API runs (useful for picking the hosting region).
      res.json({ status: 'ok', database: 'up', db_ms: Date.now() - t0, region: process.env.VERCEL_REGION ?? 'local' });
    } catch {
      res.status(503).json({ status: 'degraded', database: 'down' });
    }
  });

  // Public, read-only: the published rates, so the landing page's fare calculator uses the real numbers.
  app.get('/api/public/pricing', (_req, res) => {
    const p = config.pricing;
    res.json({ currency: p.currency, base_fare: p.baseFare, per_km_rate: p.perKmRate, per_minute_rate: p.perMinuteRate });
  });

  // Public, read-only: a shared trip link. Access is the unguessable token itself; it expires, can be revoked,
  // and never reveals phone numbers. no-store so the live location is never cached by a proxy.
  app.get('/api/public/share/:token', async (req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store');
      res.json({ trip: await safetyService.publicShare(req.params.token) });
    } catch (err) { next(err); }
  });

  app.use('/api', createRouter({ controllers, auth, store }));
  app.use(notFound);
  app.use(errorHandler(logger));

  return { app, dispatchService, supportService, trackingService, demoService };
}
