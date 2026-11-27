import { Router } from 'express';
import { asyncHandler as h } from '../middleware/errorHandler.js';
import { AppError } from '../errors.js';

export function createRouter({ controllers: c, auth, store }) {
  const router = Router();
  const { authenticate, requireRole } = auth;
  const passenger = requireRole('passenger');
  const driver = requireRole('driver');
  const anyRole = requireRole('passenger', 'driver');

  router.use(authenticate); // every route below requires a verified Supabase session

  // Authentication and profiles
  router.get('/me', h(c.getMe));
  router.get('/me/profile', h(c.getProfile));
  router.post('/me/onboarding', h(c.completeOnboarding));

  // Social sign-ins must finish registration (role, phone) before using anything else.
  router.use((req, _res, next) => (req.user.profile.needs_onboarding
    ? next(new AppError(403, 'ONBOARDING_REQUIRED', 'Finish setting up your account first.'))
    : next()));

  // Admin dashboard: only accounts listed in app_admins (checked on every request).
  const admin = async (req, _res, next) => {
    const ok = await store.isAdmin(req.user.id).catch(() => false);
    next(ok ? undefined : new AppError(403, 'ADMIN_ONLY', 'This area is for Delta admins only.'));
  };
  router.get('/admin/overview', admin, h(c.adminOverview));
  router.get('/admin/rides', admin, h(c.adminRides));
  router.post('/admin/rides/:id/action', admin, h(c.adminRideAction));
  router.get('/admin/drivers', admin, h(c.adminDrivers));
  router.post('/admin/drivers/:id/offline', admin, h(c.adminDriverOffline));
  router.get('/admin/users', admin, h(c.adminUsers));
  router.get('/admin/support/tickets', admin, h(c.adminTickets));
  router.get('/admin/support/tickets/:id', admin, h(c.adminTicket));
  router.post('/admin/support/tickets/:id/respond', admin, h(c.adminRespond));
  router.get('/admin/settings', admin, h(c.adminSettings));
  router.put('/admin/settings/autopilot', admin, h(c.adminSetAutopilot));

  // Fare calculation (passengers)
  router.post('/fares/estimate', passenger, h(c.estimateFare));

  // Account, Activity and Earnings
  router.patch('/me/profile', h(c.updateProfile));
  router.get('/rides/history', anyRole, h(c.rideHistory)); // must precede /rides/:id
  router.get('/drivers/earnings', driver, h(c.driverEarnings));

  router.get('/me/overview', anyRole, h(c.overview));

  // Recent and saved places (passengers)
  router.get('/places/recent', passenger, h(c.recentPlaces));
  router.get('/places/saved', passenger, h(c.listSaved));
  router.post('/places/saved', passenger, h(c.savePlace));
  router.patch('/places/saved/:id', passenger, h(c.updatePlace));
  router.delete('/places/saved/:id', passenger, h(c.deletePlace));

  // Safety: emergency contacts, trip shares, monitoring alerts
  router.get('/safety/contacts', anyRole, h(c.listContacts));
  router.post('/safety/contacts', anyRole, h(c.addContact));
  router.patch('/safety/contacts/:id', anyRole, h(c.updateContact));
  router.delete('/safety/contacts/:id', anyRole, h(c.deleteContact));
  router.post('/safety/alerts/:id', passenger, h(c.resolveAlert));
  router.delete('/shares/:id', passenger, h(c.revokeShare));

  // Support tickets
  router.get('/support/tickets', anyRole, h(c.listTickets));
  router.post('/support/tickets', anyRole, h(c.createTicket));
  router.get('/support/tickets/:id', anyRole, h(c.getTicket));
  router.post('/support/tickets/:id/messages', anyRole, h(c.replyTicket));
  router.post('/support/tickets/:id/close', anyRole, h(c.closeTicket));

  // Rides
  router.post('/rides', passenger, h(c.createRide));
  router.get('/rides/active', anyRole, h(c.getActiveRide)); // must precede /rides/:id
  router.get('/rides/:id', anyRole, h(c.getRide));
  router.post('/rides/:id/cancel', anyRole, h(c.cancelRide));
  router.post('/rides/:id/start', driver, h(c.startRide));
  router.post('/rides/:id/complete', driver, h(c.completeRide));
  router.post('/rides/:id/arrived', driver, h(c.markArrived));
  router.get('/rides/:id/messages', anyRole, h(c.listMessages));
  router.post('/rides/:id/messages', anyRole, h(c.sendMessage));
  router.get('/rides/:id/path', anyRole, h(c.ridePath));
  router.get('/rides/:id/alerts', passenger, h(c.listAlerts));
  router.get('/rides/:id/shares', passenger, h(c.listShares));
  router.post('/rides/:id/shares', passenger, h(c.createShare));

  // Driver
  router.patch('/drivers/availability', driver, h(c.setAvailability));
  router.post('/drivers/location', driver, h(c.updateLocation));
  router.get('/drivers/offers', driver, h(c.listOffers));
  router.post('/offers/:id/accept', driver, h(c.acceptOffer));
  router.post('/offers/:id/reject', driver, h(c.rejectOffer));

  return router;
}
