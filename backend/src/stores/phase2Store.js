/**
 * Phase 2 data access (tracking, safety, saved places, support), written once against a tiny
 * table-operations interface so the Supabase store and the Postgres test store share the same code:
 *
 *   t.rows(table, { where, order: [column, 'asc'|'desc'], limit, columns })
 *   t.insert(table, row)            -> inserted row
 *   t.update(table, where, fields)  -> updated rows
 *   t.remove(table, where)          -> deleted rows
 *   t.count(table, where)           -> number
 *
 * `where` maps column -> value, or -> { in: [...] } | { gte: v } | { lt: v } | { is: null } | { neq: v }.
 * Authorisation is NOT done here: services always pass the authenticated user's id in `where`.
 */
export function createPhase2Store(t) {
  const first = async (table, opts) => (await t.rows(table, { ...opts, limit: 1 }))[0] ?? null;

  return {
    // ---- in-ride chat ----
    insertRideMessage: (row) => t.insert('ride_messages', row),
    listRideMessages: (rideId) => t.rows('ride_messages', { where: { ride_id: rideId }, order: ['created_at', 'asc'], limit: 300 }),

    // ---- live tracking ----
    insertTrackingEvent: (row) => t.insert('ride_tracking_events', row),
    lastTrackingEvent: (rideId) => first('ride_tracking_events', { where: { ride_id: rideId }, order: ['recorded_at', 'desc'] }),
    listTrackingEvents: (rideId, { sinceIso, limit = 500 } = {}) => t.rows('ride_tracking_events', {
      where: { ride_id: rideId, ...(sinceIso ? { recorded_at: { gte: sinceIso } } : {}) },
      order: ['recorded_at', 'asc'], limit,
    }),

    // ---- safety alerts ----
    insertSafetyAlert: (row) => t.insert('safety_alerts', row),
    listSafetyAlerts: (rideId) => t.rows('safety_alerts', { where: { ride_id: rideId }, order: ['created_at', 'desc'], limit: 50 }),
    latestSafetyAlert: (rideId, kind) => first('safety_alerts', { where: { ride_id: rideId, kind }, order: ['created_at', 'desc'] }),
    getSafetyAlert: (id) => first('safety_alerts', { where: { id } }),
    async updateSafetyAlert(id, fields) { return (await t.update('safety_alerts', { id }, fields))[0] ?? null; },

    // ---- saved places ----
    listSavedPlaces: (userId) => t.rows('saved_places', { where: { user_id: userId }, order: ['created_at', 'asc'], limit: 50 }),
    countSavedPlaces: (userId) => t.count('saved_places', { user_id: userId }),
    insertSavedPlace: (row) => t.insert('saved_places', row),
    async updateSavedPlace(userId, id, fields) { return (await t.update('saved_places', { id, user_id: userId }, fields))[0] ?? null; },
    async deleteSavedPlace(userId, id) { return (await t.remove('saved_places', { id, user_id: userId })).length > 0; },

    // ---- emergency contacts ----
    listEmergencyContacts: (userId) => t.rows('emergency_contacts', { where: { user_id: userId }, order: ['created_at', 'asc'], limit: 10 }),
    countEmergencyContacts: (userId) => t.count('emergency_contacts', { user_id: userId }),
    insertEmergencyContact: (row) => t.insert('emergency_contacts', row),
    async updateEmergencyContact(userId, id, fields) { return (await t.update('emergency_contacts', { id, user_id: userId }, fields))[0] ?? null; },
    async deleteEmergencyContact(userId, id) { return (await t.remove('emergency_contacts', { id, user_id: userId })).length > 0; },

    // ---- trip shares ----
    insertTripShare: (row) => t.insert('trip_shares', row),
    getTripShareByHash: (hash) => first('trip_shares', { where: { token_hash: hash } }),
    listTripShares: (rideId, userId) => t.rows('trip_shares', {
      where: { ride_id: rideId, created_by: userId }, order: ['created_at', 'desc'], limit: 20,
      columns: 'id, ride_id, expires_at, revoked_at, created_at',
    }),
    async revokeTripShare(userId, id) {
      return (await t.update('trip_shares', { id, created_by: userId, revoked_at: { is: null } }, { revoked_at: new Date().toISOString() }))[0] ?? null;
    },

    // ---- support ----
    insertTicket: (row) => t.insert('support_tickets', row),
    listTickets: (userId) => t.rows('support_tickets', { where: { user_id: userId }, order: ['created_at', 'desc'], limit: 100 }),
    getTicket: (id) => first('support_tickets', { where: { id } }),
    async updateTicket(id, fields) {
      return (await t.update('support_tickets', { id }, { ...fields, updated_at: new Date().toISOString() }))[0] ?? null;
    },
    insertTicketUpdate: (row) => t.insert('support_ticket_updates', row),
    listTicketUpdates: (ticketId) => t.rows('support_ticket_updates', { where: { ticket_id: ticketId }, order: ['created_at', 'asc'], limit: 200 }),
    listTicketsByStatus: (status, olderThanIso) => t.rows('support_tickets', {
      where: { status, updated_at: { lt: olderThanIso } }, order: ['updated_at', 'asc'], limit: 25,
    }),

    // ---- admin ----
    async isAdmin(userId) { return (await first('app_admins', { where: { user_id: userId } })) !== null; },
    listAdminIds: async () => (await t.rows('app_admins', { columns: 'user_id', limit: 500 })).map((r) => r.user_id),
    getSetting: (key) => first('app_settings', { where: { key } }),
    async setSetting(key, value, userId) {
      const fields = { value, updated_at: new Date().toISOString(), updated_by: userId ?? null };
      const [row] = await t.update('app_settings', { key }, fields);
      return row ?? t.insert('app_settings', { key, ...fields });
    },
    countWhere: (table, where) => t.count(table, where),
    rideLog: ({ statuses, limit = 50 } = {}) => t.rows('ride_log', {
      where: statuses ? { status: { in: statuses } } : {}, order: ['booked_at_ist', 'desc'], limit,
    }),
    listAllDrivers: () => t.rows('drivers', { order: ['created_at', 'desc'], limit: 300 }),
    listProfilesByIds: (ids) => (ids.length ? t.rows('profiles', { where: { id: { in: ids } } }) : []),
    listDriverLocations: (ids) => (ids.length ? t.rows('driver_locations', { where: { driver_id: { in: ids } } }) : []),
    listRecentProfiles: (limit = 300) => t.rows('profiles', { order: ['created_at', 'desc'], limit }),
    listAllTickets: ({ statuses, limit = 100 } = {}) => t.rows('support_tickets', {
      where: statuses ? { status: { in: statuses } } : {}, order: ['updated_at', 'desc'], limit,
    }),

    // ---- demo autopilot ----
    listProfilesByEmails: (emails) => t.rows('profiles', { where: { email: { in: emails } }, columns: 'id, email, full_name' }),
    listDriversByProfileIds: (ids) => t.rows('drivers', { where: { profile_id: { in: ids } } }),
    listPendingOffersForDriverIds: (ids) => (ids.length
      ? t.rows('ride_offers', { where: { driver_id: { in: ids }, status: 'pending' } }) : []),
    getDriverLocationRow: (driverId) => first('driver_locations', { where: { driver_id: driverId } }),
    firstTrackingEvent: (rideId) => first('ride_tracking_events', { where: { ride_id: rideId }, order: ['recorded_at', 'asc'] }),

    // ---- account overview ----
    listRideStatsRows: (where) => t.rows('rides', {
      where, columns: 'status, estimated_fare, distance_km, created_at', order: ['created_at', 'desc'], limit: 5000,
    }),
  };
}
