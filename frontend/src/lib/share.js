import { STATUS_LABEL } from './format.js';

/**
 * Safety: share your trip details with someone you trust, using the phone's share sheet (or the
 * clipboard as a fallback). Only what the user can already see is shared; there is no public tracking link.
 */
export async function shareTrip(ride) {
  const lines = [
    `I'm on a Delta ride (${STATUS_LABEL[ride.status] ?? ride.status}).`,
    ride.driver ? `Driver: ${ride.driver.name}, ${ride.driver.vehicle_model} ${ride.driver.vehicle_registration}` : null,
    ride.passenger ? `Passenger: ${ride.passenger.name}` : null,
    `From: ${ride.pickup.address}`,
    `To: ${ride.destination.address}`,
    `Shared ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
  ].filter(Boolean);
  const text = lines.join('\n');
  if (navigator.share) {
    try { await navigator.share({ title: 'My Delta trip', text }); return 'shared'; } catch (e) { if (e.name === 'AbortError') return 'cancelled'; }
  }
  try { await navigator.clipboard.writeText(text); return 'copied'; } catch { return 'failed'; }
}
