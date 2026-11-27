import { supabase } from '../lib/supabase.js';

const BASE = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request(method, path, body) {
  const { data } = (await supabase?.auth.getSession()) ?? {};
  const token = data?.session?.access_token;
  let res;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection and try again.');
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = json.error ?? {};
    throw new ApiError(res.status, e.code ?? 'ERROR', e.message ?? 'Something went wrong.', e.details);
  }
  return json;
}

/** Unauthenticated read of the published rates (landing page calculator). */
export async function getPublicPricing() {
  const res = await fetch(`${BASE}/api/public/pricing`);
  if (!res.ok) throw new ApiError(res.status, 'ERROR', 'Pricing unavailable');
  return res.json();
}

export const api = {
  me: () => request('GET', '/me'),
  completeOnboarding: (body) => request('POST', '/me/onboarding', body),
  recentPlaces: () => request('GET', '/places/recent'),
  history: ({ limit = 20, before } = {}) => request('GET', `/rides/history?limit=${limit}${before ? `&before=${encodeURIComponent(before)}` : ''}`),
  earnings: () => request('GET', '/drivers/earnings'),
  updateProfile: (body) => request('PATCH', '/me/profile', body),
  estimateFare: (pickup, destination) => request('POST', '/fares/estimate', { pickup, destination }),
  createRide: (pickup, destination, idempotencyKey) =>
    request('POST', '/rides', { pickup, destination, idempotencyKey }),
  getRide: (id) => request('GET', `/rides/${id}`),
  activeRide: () => request('GET', '/rides/active'),
  cancelRide: (id) => request('POST', `/rides/${id}/cancel`),
  startRide: (id) => request('POST', `/rides/${id}/start`),
  completeRide: (id) => request('POST', `/rides/${id}/complete`),
  setAvailability: (is_online) => request('PATCH', '/drivers/availability', { is_online }),
  updateLocation: (latitude, longitude) => request('POST', '/drivers/location', { latitude, longitude }),
  offers: () => request('GET', '/drivers/offers'),
  acceptOffer: (id) => request('POST', `/offers/${id}/accept`),
  rejectOffer: (id) => request('POST', `/offers/${id}/reject`),

  // Phase 2
  markArrived: (id) => request('POST', `/rides/${id}/arrived`),
  messages: (rideId) => request('GET', `/rides/${rideId}/messages`),
  sendMessage: (rideId, body) => request('POST', `/rides/${rideId}/messages`, { body }),
  ridePath: (rideId) => request('GET', `/rides/${rideId}/path`),
  rideAlerts: (rideId) => request('GET', `/rides/${rideId}/alerts`),
  resolveAlert: (id, action) => request('POST', `/safety/alerts/${id}`, { action }),
  createShare: (rideId) => request('POST', `/rides/${rideId}/shares`),
  listShares: (rideId) => request('GET', `/rides/${rideId}/shares`),
  revokeShare: (id) => request('DELETE', `/shares/${id}`),
  overview: () => request('GET', '/me/overview'),
  savedPlaces: () => request('GET', '/places/saved'),
  savePlace: (body) => request('POST', '/places/saved', body),
  updatePlace: (id, body) => request('PATCH', `/places/saved/${id}`, body),
  deletePlace: (id) => request('DELETE', `/places/saved/${id}`),
  contacts: () => request('GET', '/safety/contacts'),
  addContact: (body) => request('POST', '/safety/contacts', body),
  updateContact: (id, body) => request('PATCH', `/safety/contacts/${id}`, body),
  deleteContact: (id) => request('DELETE', `/safety/contacts/${id}`),
  tickets: () => request('GET', '/support/tickets'),
  createTicket: (body) => request('POST', '/support/tickets', body),
  ticket: (id) => request('GET', `/support/tickets/${id}`),
  replyTicket: (id, message) => request('POST', `/support/tickets/${id}/messages`, { message }),
  closeTicket: (id) => request('POST', `/support/tickets/${id}/close`),

  // Admin (only works for accounts in app_admins)
  admin: {
    overview: () => request('GET', '/admin/overview'),
    rides: (filter = 'live') => request('GET', `/admin/rides?filter=${filter}`),
    rideAction: (id, action) => request('POST', `/admin/rides/${id}/action`, { action }),
    drivers: () => request('GET', '/admin/drivers'),
    driverOffline: (id) => request('POST', `/admin/drivers/${id}/offline`),
    users: () => request('GET', '/admin/users'),
    tickets: (filter = 'active') => request('GET', `/admin/support/tickets?filter=${filter}`),
    ticket: (id) => request('GET', `/admin/support/tickets/${id}`),
    respond: (id, body) => request('POST', `/admin/support/tickets/${id}/respond`, body),
    settings: () => request('GET', '/admin/settings'),
    setAutopilot: (enabled) => request('PUT', '/admin/settings/autopilot', { enabled }),
  },
};

/** Unauthenticated read of a shared trip (the link token is the only credential). */
export async function getSharedTrip(token) {
  let res;
  try { res = await fetch(`${BASE}/api/public/share/${encodeURIComponent(token)}`, { cache: 'no-store' }); } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server.');
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json.error?.code ?? 'ERROR', json.error?.message ?? 'Something went wrong.');
  return json.trip;
}
