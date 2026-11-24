import { AppError } from '../errors.js';

export const RIDE_STATUS = Object.freeze({
  REQUESTED: 'requested',
  SEARCHING: 'searching',
  ACCEPTED: 'accepted',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  UNMATCHED: 'unmatched',
});

// Mirrors the trigger in supabase/migrations/..._schema.sql
export const TRANSITIONS = Object.freeze({
  requested: ['searching', 'cancelled'],
  searching: ['accepted', 'unmatched', 'cancelled'],
  accepted: ['in_progress', 'cancelled'],
  in_progress: ['completed'],
  completed: [],
  cancelled: [],
  unmatched: [],
});

export const ACTIVE_DRIVER_STATUSES = ['accepted', 'in_progress'];
export const OPEN_STATUSES = ['requested', 'searching', 'accepted', 'in_progress'];

export function canTransition(from, to) {
  return (TRANSITIONS[from] ?? []).includes(to);
}

export function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    throw new AppError(409, 'INVALID_TRANSITION', `Cannot move a ride from "${from}" to "${to}".`);
  }
}

/** Who may cancel, and from which states. */
export function canCancel(role, status) {
  if (role === 'passenger') return ['requested', 'searching', 'accepted'].includes(status);
  if (role === 'driver') return status === 'accepted';
  return false;
}

/** Actions the UI may offer the viewer right now. */
export function allowedActions(role, status) {
  const actions = [];
  if (canCancel(role, status)) actions.push('cancel');
  if (role === 'driver' && status === 'accepted') actions.push('start');
  if (role === 'driver' && status === 'in_progress') actions.push('complete');
  return actions;
}
