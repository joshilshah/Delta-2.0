import { createHash, randomBytes } from 'node:crypto';
import { AppError } from '../errors.js';
import { estimateEta } from '../matching/geo.js';

const ACTIVE = ['accepted', 'in_progress'];
const MAX_CONTACTS = 5;
const SHARE_HOURS = 8;
const hash = (token) => createHash('sha256').update(token).digest('hex');
const firstName = (name) => String(name ?? '').replace(/\s*\(.*\)\s*$/, '').split(/\s+/)[0] || 'Your driver';
const contactView = (c) => ({ id: c.id, name: c.name, phone: c.phone, relationship: c.relationship ?? null, created_at: c.created_at });
const alertView = (a) => ({
  id: a.id, kind: a.kind, message: a.message, status: a.status, created_at: a.created_at, resolved_at: a.resolved_at,
  location: a.latitude != null ? { latitude: a.latitude, longitude: a.longitude } : null,
});

/** Emergency contacts, trip sharing links and trip-monitoring alerts. */
export function createSafetyService({ store, supportService }) {
  async function passengerRide(user, rideId) {
    const ride = await store.getRide(rideId);
    if (!ride || user.role !== 'passenger' || ride.passenger_id !== user.id) throw new AppError(404, 'RIDE_NOT_FOUND', 'Ride not found.');
    return ride;
  }

  return {
    // ---- emergency contacts (each user manages only their own) ----
    async listContacts(user) {
      return { contacts: (await store.listEmergencyContacts(user.id)).map(contactView) };
    },
    async addContact(user, body) {
      const existing = await store.listEmergencyContacts(user.id);
      if (existing.length >= MAX_CONTACTS) throw new AppError(409, 'LIMIT_REACHED', `You can add up to ${MAX_CONTACTS} emergency contacts.`);
      if (existing.some((c) => c.phone === body.phone)) throw new AppError(409, 'CONTACT_EXISTS', 'That number is already one of your contacts.');
      return { contact: contactView(await store.insertEmergencyContact({ user_id: user.id, ...body })) };
    },
    async updateContact(user, id, body) {
      if (body.phone) {
        const dupe = (await store.listEmergencyContacts(user.id)).find((c) => c.phone === body.phone && c.id !== id);
        if (dupe) throw new AppError(409, 'CONTACT_EXISTS', 'That number is already one of your contacts.');
      }
      const c = await store.updateEmergencyContact(user.id, id, body);
      if (!c) throw new AppError(404, 'CONTACT_NOT_FOUND', 'Contact not found.');
      return { contact: contactView(c) };
    },
    async removeContact(user, id) {
      if (!(await store.deleteEmergencyContact(user.id, id))) throw new AppError(404, 'CONTACT_NOT_FOUND', 'Contact not found.');
      return { deleted: true };
    },

    // ---- trip sharing ----
    /** A random, unguessable link token. Only its hash is stored; the raw token is returned once. */
    async createShare(user, rideId) {
      const ride = await passengerRide(user, rideId);
      if (!ACTIVE.includes(ride.status)) throw new AppError(409, 'SHARE_UNAVAILABLE', 'You can share a trip once a driver is on the way.');
      const token = randomBytes(24).toString('base64url');
      const expires = new Date(Date.now() + SHARE_HOURS * 3600 * 1000).toISOString();
      const share = await store.insertTripShare({ ride_id: ride.id, created_by: user.id, token_hash: hash(token), expires_at: expires });
      return { share: { id: share.id, token, expires_at: share.expires_at } };
    },
    async listShares(user, rideId) {
      await passengerRide(user, rideId);
      return { shares: await store.listTripShares(rideId, user.id) };
    },
    async revokeShare(user, id) {
      const s = await store.revokeTripShare(user.id, id);
      if (!s) throw new AppError(404, 'SHARE_NOT_FOUND', 'Share link not found or already turned off.');
      return { revoked: true };
    },

    /**
     * Public view for someone holding a share link. Deliberately minimal: no phone numbers, first names only,
     * and the live location only while the trip is active. Expired or revoked links reveal nothing.
     */
    async publicShare(token) {
      const gone = new AppError(404, 'SHARE_NOT_FOUND', 'This trip link has expired or was turned off.');
      if (!/^[A-Za-z0-9_-]{20,64}$/.test(token ?? '')) throw gone;
      const share = await store.getTripShareByHash(hash(token));
      if (!share || share.revoked_at || new Date(share.expires_at) <= new Date()) throw gone;
      const ride = await store.getRide(share.ride_id);
      if (!ride) throw gone;
      const { passenger, driver } = await store.getRideParties(ride);
      const live = ACTIVE.includes(ride.status);
      const loc = live && driver?.location ? driver.location : null;
      const target = ride.status === 'accepted'
        ? { latitude: ride.pickup_latitude, longitude: ride.pickup_longitude }
        : { latitude: ride.destination_latitude, longitude: ride.destination_longitude };
      return {
        status: ride.status,
        passenger_first_name: firstName(passenger?.full_name),
        pickup: { address: ride.pickup_address, latitude: ride.pickup_latitude, longitude: ride.pickup_longitude },
        destination: { address: ride.destination_address, latitude: ride.destination_latitude, longitude: ride.destination_longitude },
        driver: driver ? {
          first_name: firstName(driver.full_name), vehicle_model: driver.vehicle_model, vehicle_registration: driver.vehicle_registration,
          is_verified: Boolean(driver.is_verified),
          location: loc ? { latitude: loc.latitude, longitude: loc.longitude, updated_at: loc.updated_at } : null,
        } : null,
        eta: loc ? { target: ride.status === 'accepted' ? 'pickup' : 'destination', ...estimateEta(loc, target), source: 'estimate' } : null,
        accepted_at: ride.accepted_at, arrived_at: ride.arrived_at ?? null, started_at: ride.started_at,
        completed_at: ride.completed_at, cancelled_at: ride.cancelled_at,
        link_expires_at: share.expires_at,
      };
    },

    // ---- trip monitoring alerts (passenger reviews them; nothing is escalated automatically) ----
    async listAlerts(user, rideId) {
      await passengerRide(user, rideId);
      return { alerts: (await store.listSafetyAlerts(rideId)).map(alertView) };
    },
    async resolveAlert(user, alertId, action) {
      const alert = await store.getSafetyAlert(alertId);
      const ride = alert && await store.getRide(alert.ride_id);
      if (!alert || !ride || user.role !== 'passenger' || ride.passenger_id !== user.id) {
        throw new AppError(404, 'ALERT_NOT_FOUND', 'Alert not found.');
      }
      if (alert.status !== 'open') return { alert: alertView(alert) };
      const updated = await store.updateSafetyAlert(alert.id, {
        status: action === 'help' ? 'help_requested' : 'dismissed', resolved_at: new Date().toISOString(),
      });
      let ticket = null;
      if (action === 'help') {
        // "Get help" opens a safety ticket so the request is on record; the UI also offers 112 and contacts.
        ticket = (await supportService.create(user, {
          category: 'safety', ride_id: ride.id, subject: 'Safety help requested during a trip',
          description: `Help requested from a trip alert: ${alert.message}`,
        })).ticket;
      }
      return { alert: alertView(updated), ticket };
    },
  };
}
