export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// Stable machine messages raised by the SQL functions -> HTTP responses.
const DB_ERRORS = {
  OFFER_NOT_FOUND: [404, 'Offer not found.'],
  OFFER_NOT_PENDING: [409, 'This offer is no longer pending.'],
  OFFER_EXPIRED: [410, 'This offer has expired.'],
  RIDE_NOT_AVAILABLE: [409, 'This ride is no longer available.'],
  RIDE_NOT_FOUND: [404, 'Ride not found.'],
  DRIVER_OFFLINE: [409, 'Go online before accepting rides.'],
  DRIVER_BUSY: [409, 'You already have an active ride.'],
  DRIVER_NOT_FOUND: [404, 'Driver not found.'],
  DRIVER_HAS_ACTIVE_RIDE: [409, 'Finish or cancel your active ride before going offline.'],
  NOT_ASSIGNED_DRIVER: [403, 'Only the assigned driver can do this.'],
  NOT_PARTICIPANT: [403, 'You are not a participant in this ride.'],
  INVALID_TRANSITION: [409, 'This action is not allowed in the ride\'s current state.'],
  RIDE_IMMUTABLE_FIELD: [409, 'This ride field cannot be changed.'],
  ALREADY_ONBOARDED: [409, 'Your account setup is already complete.'],
  PROFILE_NOT_FOUND: [404, 'Profile not found.'],
  INVALID_ROLE: [400, 'Choose either passenger or driver.'],
};

// Postgres: undefined table / column / function. PostgREST: table / column / function not in its schema cache.
const MISSING_SCHEMA = new Set(['42P01', '42703', '42883', 'PGRST202', 'PGRST204', 'PGRST205']);

/** Convert a database error (Postgres/PostgREST/network) into an AppError. */
export function mapDbError(error) {
  if (error instanceof AppError) return error;
  const message = String(error?.message ?? '');
  const known = DB_ERRORS[message];
  if (known) return new AppError(known[0], message, known[1]);
  // Missing table / column / function: the Phase 2 migration has not been applied to this database yet.
  if (MISSING_SCHEMA.has(String(error?.code ?? ''))) {
    return new AppError(503, 'MIGRATION_REQUIRED',
      'This feature needs a database update: run supabase/migrations/20250101000005_phase2.sql in the Supabase SQL editor.');
  }
  return new AppError(503, 'DATABASE_UNAVAILABLE',
    'The database is temporarily unavailable. Please try again.');
}
