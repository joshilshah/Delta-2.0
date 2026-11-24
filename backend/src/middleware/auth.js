import { AppError } from '../errors.js';

/** Build a token verifier backed by Supabase Auth (validates the JWT with the Auth server). */
export function createSupabaseTokenVerifier(authClient) {
  return async function verifyToken(token) {
    const { data, error } = await authClient.auth.getUser(token);
    if (error) {
      if (error.status >= 400 && error.status < 500) return null; // bad / expired token
      throw new AppError(503, 'AUTH_UNAVAILABLE', 'Authentication service is unavailable.');
    }
    return data?.user ? { id: data.user.id, email: data.user.email } : null;
  };
}

/**
 * Verifies the bearer token, then loads the profile (and driver row) from the database.
 * The identity (and role) used everywhere downstream comes from here, never from the request body.
 */
export function createAuthMiddleware({ verifyToken, store }) {
  const authenticate = async (req, _res, next) => {
    try {
      const header = req.headers.authorization ?? '';
      const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
      if (!token) throw new AppError(401, 'UNAUTHENTICATED', 'Missing access token.');

      const authUser = await verifyToken(token);
      if (!authUser) throw new AppError(401, 'UNAUTHENTICATED', 'Invalid or expired session. Please sign in again.');

      // Independent lookups run in parallel (each is a network round trip to the database).
      const [profile, driverRow] = await Promise.all([
        store.getProfile(authUser.id),
        store.getDriverByProfileId(authUser.id),
      ]);
      if (!profile) throw new AppError(403, 'PROFILE_MISSING', 'No profile exists for this account.');

      const driver = profile.role === 'driver' ? driverRow : null;
      if (profile.role === 'driver' && !driver) {
        throw new AppError(403, 'DRIVER_MISSING', 'No driver record exists for this account.');
      }
      req.user = { id: profile.id, email: profile.email, role: profile.role, profile, driver };
      next();
    } catch (err) {
      next(err);
    }
  };

  const requireRole = (...roles) => (req, _res, next) =>
    roles.includes(req.user?.role)
      ? next()
      : next(new AppError(403, 'FORBIDDEN', `This action requires the ${roles.join(' or ')} role.`));

  return { authenticate, requireRole };
}
