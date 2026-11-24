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

/**
 * Wire everything together from injected dependencies (store, routeService, verifyToken),
 * so the whole HTTP stack can be exercised in tests without Supabase or Google.
 */
export function createApp({ config, store, routeService, verifyToken, logger = console }) {
  const fareService = createFareService({ routeService, pricing: config.pricing });
  const dispatchService = createDispatchService({ store, matching: config.matching, logger });
  const rideService = createRideService({
    store, fareService, dispatchService, minTripMeters: config.minTripMeters,
  });
  const trackingService = createTrackingService({ store, tracking: config.tracking, logger });
  const driverService = createDriverService({
    store, dispatchService, staleSeconds: config.matching.locationStaleSeconds, trackingService, logger,
  });
  const placesService = createPlacesService({ store });
  const activityService = createActivityService({ store });
  const supportService = createSupportService({ store, triageAfterSeconds: config.support?.triageAfterSeconds ?? 60 });
  const safetyService = createSafetyService({ store, supportService });
  const controllers = createControllers({
    rideService, driverService, placesService, activityService, trackingService, safetyService, supportService, store,
  });
  const auth = createAuthMiddleware({ verifyToken, store });

  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: config.frontendOrigin, credentials: false }));
  app.use(express.json({ limit: '20kb' }));

  app.get('/health', async (_req, res) => {
    try {
      await store.ping();
      res.json({ status: 'ok', database: 'up' });
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

  app.use('/api', createRouter({ controllers, auth }));
  app.use(notFound);
  app.use(errorHandler(logger));

  return { app, dispatchService, supportService, trackingService };
}
