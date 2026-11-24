import { AppError } from '../errors.js';

/**
 * "Recent places" are derived from the passenger's own booking history (the rides table), so there is
 * nothing extra to keep in sync: every booking is automatically remembered, on any device.
 * Places are de-duplicated by address (case-insensitive) and ranked newest first.
 */
const LIMIT = 6;

function collect(rows, prefix) {
  const seen = new Map();
  for (const r of rows) { // rows arrive newest first
    const address = r[`${prefix}_address`];
    const key = address.trim().toLowerCase();
    const found = seen.get(key);
    if (found) { found.times_used += 1; continue; }
    seen.set(key, {
      address,
      latitude: r[`${prefix}_latitude`],
      longitude: r[`${prefix}_longitude`],
      last_used_at: r.created_at,
      times_used: 1,
    });
  }
  return [...seen.values()].slice(0, LIMIT);
}

const MAX_SAVED = 20;
const savedView = (p) => ({
  id: p.id, kind: p.kind, label: p.label, address: p.address, latitude: p.latitude, longitude: p.longitude, created_at: p.created_at,
});

export function createPlacesService({ store }) {
  return {
    async recent(user) {
      const rows = await store.listRecentPlaceRows(user.id);
      return { destinations: collect(rows, 'destination'), pickups: collect(rows, 'pickup') };
    },

    // ---- saved places (Home, Work, favourites): always scoped to the signed-in user ----
    async listSaved(user) {
      return { places: (await store.listSavedPlaces(user.id)).map(savedView) };
    },

    /** Saving Home or Work again replaces the existing one. */
    async save(user, body) {
      const existing = await store.listSavedPlaces(user.id);
      const same = body.kind !== 'other' && existing.find((p) => p.kind === body.kind);
      if (same) return { place: savedView(await store.updateSavedPlace(user.id, same.id, body)), replaced: true };
      if (existing.length >= MAX_SAVED) throw new AppError(409, 'LIMIT_REACHED', `You can save up to ${MAX_SAVED} places.`);
      return { place: savedView(await store.insertSavedPlace({ user_id: user.id, ...body })), replaced: false };
    },

    async update(user, id, body) {
      if (body.kind && body.kind !== 'other') {
        const clash = (await store.listSavedPlaces(user.id)).find((p) => p.kind === body.kind && p.id !== id);
        if (clash) throw new AppError(409, 'PLACE_KIND_TAKEN', `You already have a ${body.kind} place. Edit that one instead.`);
      }
      const place = await store.updateSavedPlace(user.id, id, body);
      if (!place) throw new AppError(404, 'PLACE_NOT_FOUND', 'Saved place not found.');
      return { place: savedView(place) };
    },

    async remove(user, id) {
      if (!(await store.deleteSavedPlace(user.id, id))) throw new AppError(404, 'PLACE_NOT_FOUND', 'Saved place not found.');
      return { deleted: true };
    },
  };
}
