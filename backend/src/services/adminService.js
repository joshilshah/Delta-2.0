import { AppError } from '../errors.js';

const LIVE = ['requested', 'searching', 'accepted', 'in_progress'];
const RIDE_FILTERS = {
  live: LIVE,
  completed: ['completed'],
  cancelled: ['cancelled', 'unmatched'],
  all: null,
};
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };

/**
 * Admin dashboard. Every method is only reachable through the requireAdmin middleware (app_admins table).
 * Admins can see contact details (they run the service); that's why /admin is never open to normal users.
 */
export function createAdminService({ store, demoService, supportService }) {
  return {
    async overview() {
      const [riders, drivers, online, live, searching, openTickets, today, autopilot] = await Promise.all([
        store.countWhere('profiles', { role: 'passenger' }),
        store.countWhere('profiles', { role: 'driver' }),
        store.countWhere('drivers', { is_online: true }),
        store.countWhere('rides', { status: { in: ['accepted', 'in_progress'] } }),
        store.countWhere('rides', { status: { in: ['requested', 'searching'] } }),
        store.countWhere('support_tickets', { status: { in: ['open', 'in_review'] } }),
        store.listRideStatsRows({ created_at: { gte: startOfToday() } }),
        demoService.status(),
      ]);
      const done = today.filter((r) => r.status === 'completed');
      return {
        users: { riders, drivers },
        drivers_online: online,
        rides_live: live,
        rides_searching: searching,
        today: {
          booked: today.length,
          completed: done.length,
          cancelled: today.filter((r) => ['cancelled', 'unmatched'].includes(r.status)).length,
          fares: Math.round(done.reduce((a, r) => a + Number(r.estimated_fare), 0)),
          distance_km: Math.round(done.reduce((a, r) => a + Number(r.distance_km), 0) * 10) / 10,
        },
        support_open: openTickets,
        autopilot,
        currency: 'INR',
      };
    },

    async rides(filter = 'live') {
      if (!(filter in RIDE_FILTERS)) throw new AppError(400, 'VALIDATION_ERROR', 'Unknown ride filter.');
      return { rides: await store.rideLog({ statuses: RIDE_FILTERS[filter], limit: filter === 'live' ? 100 : 60 }) };
    },

    /** Cancel a ride that hasn't started, or force-complete a stuck trip. */
    async rideAction(rideId, action) {
      const ride = await store.getRide(rideId);
      if (!ride) throw new AppError(404, 'RIDE_NOT_FOUND', 'Ride not found.');
      if (action === 'cancel') await store.adminCancelRide(ride.id);
      else if (action === 'complete') {
        if (ride.status !== 'in_progress') throw new AppError(409, 'INVALID_TRANSITION', 'Only a trip in progress can be completed.');
        await store.completeRide(ride.id, ride.driver_id);
      } else throw new AppError(400, 'VALIDATION_ERROR', 'Unknown action.');
      return { ride: await store.getRide(ride.id) };
    },

    async drivers() {
      const rows = await store.listAllDrivers();
      const ids = rows.map((d) => d.id);
      const [profiles, locations] = await Promise.all([
        store.listProfilesByIds(rows.map((d) => d.profile_id)),
        store.listDriverLocations(ids),
      ]);
      const autopilot = new Set((await demoService.status()).drivers.map((d) => d.id));
      return {
        drivers: rows.map((d) => {
          const p = profiles.find((x) => x.id === d.profile_id);
          const loc = locations.find((l) => l.driver_id === d.id);
          return {
            id: d.id, name: p?.full_name, email: p?.email, phone: p?.phone,
            vehicle_model: d.vehicle_model, vehicle_registration: d.vehicle_registration,
            is_online: d.is_online, is_verified: d.is_verified, autopilot: autopilot.has(d.id),
            location_updated_at: loc?.updated_at ?? null,
          };
        }),
      };
    },

    async setDriverOffline(driverId) {
      const d = await store.getDriverById(driverId);
      if (!d) throw new AppError(404, 'DRIVER_NOT_FOUND', 'Driver not found.');
      await store.setDriverOnline(driverId, false); // refuses if the driver is on a trip
      return { ok: true };
    },

    async users() {
      const [profiles, admins] = await Promise.all([store.listRecentProfiles(300), store.listAdminIds()]);
      const adminSet = new Set(admins);
      return {
        users: profiles.map((p) => ({
          id: p.id, name: p.full_name, email: p.email, phone: p.phone, role: p.role,
          needs_onboarding: Boolean(p.needs_onboarding), is_admin: adminSet.has(p.id), created_at: p.created_at,
        })),
      };
    },

    async tickets(filter = 'active') {
      const statuses = filter === 'active' ? ['open', 'in_review'] : filter === 'all' ? null : [filter];
      const rows = await store.listAllTickets({ statuses });
      const people = await store.listProfilesByIds([...new Set(rows.map((t) => t.user_id))]);
      return {
        tickets: rows.map((t) => {
          const p = people.find((x) => x.id === t.user_id);
          return { ...t, user: p ? { name: p.full_name, email: p.email, role: p.role } : null };
        }),
      };
    },

    async ticket(id) {
      const t = await store.getTicket(id);
      if (!t) throw new AppError(404, 'TICKET_NOT_FOUND', 'Support request not found.');
      const [[p], updates] = await Promise.all([store.listProfilesByIds([t.user_id]), store.listTicketUpdates(t.id)]);
      return { ticket: { ...t, user: p ? { name: p.full_name, email: p.email, phone: p.phone, role: p.role } : null }, updates };
    },

    /** Reply as support and/or change the status. The user sees it live on their request. */
    async respond(id, { status, message }) {
      const t = await store.getTicket(id);
      if (!t) throw new AppError(404, 'TICKET_NOT_FOUND', 'Support request not found.');
      await supportService.staffUpdate(id, status ?? t.status, message);
      return this.ticket(id);
    },

    settings: () => demoService.status().then((autopilot) => ({ autopilot })),
    setAutopilot: (enabled, user) => demoService.setEnabled(enabled, user.id).then((autopilot) => ({ autopilot })),
  };
}
