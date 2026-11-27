import {
  adminAutopilotSchema, adminRespondSchema, adminRideActionSchema, alertActionSchema, availabilitySchema, contactSchema, contactUpdateSchema, createRideSchema, estimateSchema,
  historyQuerySchema, idParamSchema, locationUpdateSchema, messageSchema, onboardingSchema, parse, profileUpdateSchema,
  savedPlaceSchema, savedPlaceUpdateSchema, ticketReplySchema, ticketSchema,
} from '../validation/schemas.js';
import { AppError } from '../errors.js';

// Controllers: validate input, call a service, shape the HTTP response. No business logic here.
export function createControllers({
  rideService, driverService, placesService, activityService, trackingService, safetyService, supportService, adminService, store,
}) {
  const id = (req) => parse(idParamSchema, req.params).id;

  return {
    // ----- admin (routes are behind requireAdmin) -----
    async adminOverview(_req, res) { res.json(await adminService.overview()); },
    async adminRides(req, res) { res.json(await adminService.rides(String(req.query.filter ?? 'live'))); },
    async adminRideAction(req, res) {
      res.json(await adminService.rideAction(id(req), parse(adminRideActionSchema, req.body).action));
    },
    async adminDrivers(_req, res) { res.json(await adminService.drivers()); },
    async adminDriverOffline(req, res) { res.json(await adminService.setDriverOffline(id(req))); },
    async adminUsers(_req, res) { res.json(await adminService.users()); },
    async adminTickets(req, res) { res.json(await adminService.tickets(String(req.query.filter ?? 'active'))); },
    async adminTicket(req, res) { res.json(await adminService.ticket(id(req))); },
    async adminRespond(req, res) {
      const body = parse(adminRespondSchema, req.body);
      const message = body.message || `Status changed to ${body.status.replace('_', ' ')}.`;
      res.json(await adminService.respond(id(req), { status: body.status, message }));
    },
    async adminSettings(_req, res) { res.json(await adminService.settings()); },
    async adminSetAutopilot(req, res) {
      res.json(await adminService.setAutopilot(parse(adminAutopilotSchema, req.body).enabled, req.user));
    },

    // ----- Phase 2: arrival, chat, tracking -----
    async markArrived(req, res) { res.json({ ride: await rideService.markArrived(req.user, id(req)) }); },
    async listMessages(req, res) { res.json(await rideService.listMessages(req.user, id(req))); },
    async sendMessage(req, res) {
      res.status(201).json(await rideService.sendMessage(req.user, id(req), parse(messageSchema, req.body).body));
    },
    async ridePath(req, res) {
      await rideService.getRide(req.user, id(req)); // participant check (404 otherwise)
      res.json({ points: await trackingService.path(id(req)) });
    },
    async overview(req, res) { res.json(await activityService.overview(req.user)); },

    // ----- saved places -----
    async listSaved(req, res) { res.json(await placesService.listSaved(req.user)); },
    async savePlace(req, res) { res.status(201).json(await placesService.save(req.user, parse(savedPlaceSchema, req.body))); },
    async updatePlace(req, res) { res.json(await placesService.update(req.user, id(req), parse(savedPlaceUpdateSchema, req.body))); },
    async deletePlace(req, res) { res.json(await placesService.remove(req.user, id(req))); },

    // ----- safety -----
    async listContacts(req, res) { res.json(await safetyService.listContacts(req.user)); },
    async addContact(req, res) { res.status(201).json(await safetyService.addContact(req.user, parse(contactSchema, req.body))); },
    async updateContact(req, res) { res.json(await safetyService.updateContact(req.user, id(req), parse(contactUpdateSchema, req.body))); },
    async deleteContact(req, res) { res.json(await safetyService.removeContact(req.user, id(req))); },
    async createShare(req, res) { res.status(201).json(await safetyService.createShare(req.user, id(req))); },
    async listShares(req, res) { res.json(await safetyService.listShares(req.user, id(req))); },
    async revokeShare(req, res) { res.json(await safetyService.revokeShare(req.user, id(req))); },
    async listAlerts(req, res) { res.json(await safetyService.listAlerts(req.user, id(req))); },
    async resolveAlert(req, res) {
      res.json(await safetyService.resolveAlert(req.user, id(req), parse(alertActionSchema, req.body).action));
    },

    // ----- support -----
    async listTickets(req, res) { res.json(await supportService.list(req.user)); },
    async createTicket(req, res) { res.status(201).json(await supportService.create(req.user, parse(ticketSchema, req.body))); },
    async getTicket(req, res) { res.json(await supportService.get(req.user, id(req))); },
    async replyTicket(req, res) { res.json(await supportService.reply(req.user, id(req), parse(ticketReplySchema, req.body).message)); },
    async closeTicket(req, res) { res.json(await supportService.close(req.user, id(req))); },

    // ----- me -----
    async getMe(req, res) {
      const { user } = req;
      const [driver, activeRide, isAdmin] = await Promise.all([
        user.driver ? driverService.getState(user.driver) : null,
        rideService.getActiveRide(user),
        store.isAdmin(user.id).catch(() => false), // false until migration 6 exists
      ]);
      res.json({
        user: { id: user.id, email: user.email, role: user.role, is_admin: isAdmin },
        profile: user.profile,
        driver,
        active_ride_id: activeRide?.id ?? null,
      });
    },

    async getProfile(req, res) {
      const { user } = req;
      const driver = user.driver ? await driverService.getState(user.driver) : null;
      res.json({ profile: user.profile, driver });
    },

    /** One-time registration step for social (Google) sign-ins: choose role, phone, vehicle. */
    async completeOnboarding(req, res) {
      if (!req.user.profile.needs_onboarding) {
        throw new AppError(409, 'ALREADY_ONBOARDED', 'Your account setup is already complete.');
      }
      const body = parse(onboardingSchema, req.body);
      const profile = await store.completeOnboarding(req.user.id, body);
      res.json({ profile });
    },

    // ----- fares -----
    async estimateFare(req, res) {
      res.json(await rideService.estimate(parse(estimateSchema, req.body)));
    },

    // ----- activity, earnings, profile -----
    async rideHistory(req, res) {
      res.json(await activityService.history(req.user, parse(historyQuerySchema, req.query)));
    },
    async driverEarnings(req, res) {
      res.json(await activityService.earnings(req.user.driver));
    },
    async updateProfile(req, res) {
      res.json(await activityService.updateProfile(req.user, parse(profileUpdateSchema, req.body)));
    },

    // ----- recent places (from the passenger's own booking history) -----
    async recentPlaces(req, res) {
      res.json(await placesService.recent(req.user));
    },

    // ----- rides -----
    async createRide(req, res) {
      const { ride, created } = await rideService.createRide(req.user, parse(createRideSchema, req.body));
      res.status(created ? 201 : 200).json({ ride });
    },
    async getActiveRide(req, res) {
      res.json({ ride: await rideService.getActiveRide(req.user) });
    },
    async getRide(req, res) {
      res.json({ ride: await rideService.getRide(req.user, id(req)) });
    },
    async cancelRide(req, res) {
      res.json({ ride: await rideService.cancelRide(req.user, id(req)) });
    },
    async startRide(req, res) {
      res.json({ ride: await rideService.startRide(req.user, id(req)) });
    },
    async completeRide(req, res) {
      res.json({ ride: await rideService.completeRide(req.user, id(req)) });
    },

    // ----- driver -----
    async setAvailability(req, res) {
      const { is_online } = parse(availabilitySchema, req.body);
      res.json({ driver: await driverService.setAvailability(req.user.driver, is_online) });
    },
    async updateLocation(req, res) {
      res.json({ driver: await driverService.updateLocation(req.user.driver, parse(locationUpdateSchema, req.body)) });
    },
    async listOffers(req, res) {
      res.json({ offers: await rideService.listOffers(req.user.driver), server_time: new Date().toISOString() });
    },
    async acceptOffer(req, res) {
      res.json({ ride: await rideService.acceptOffer(req.user.driver, id(req)) });
    },
    async rejectOffer(req, res) {
      res.json(await rideService.rejectOffer(req.user.driver, id(req)));
    },
  };
}
