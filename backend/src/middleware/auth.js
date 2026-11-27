import { AppError } from '../errors.js';

/**
 * Build a token verifier for Supabase access tokens.
 * getClaims() checks the JWT signature locally against the project's published signing keys (fetched once and
 * cached), so most requests need no round trip to Supabase Auth. Projects still on the legacy shared secret fall back
 * to asking the Auth server, which getClaims() does automatically. Verified tokens are also cached briefly.
 */
export function createSupabaseTokenVerifier(authClient) {
  const cache = new Map(); // token -> { user, until }
  return async function verifyToken(token) {
    const hit = cache.get(token);
    if (hit && hit.until > Date.now()) return hit.user;
    const { data, error } = await authClient.auth.getClaims(token);
    if (error) {
      if (error.status === undefined || (error.status >= 400 && error.status < 500)) return null; // bad / expired token
      throw new AppError(503, 'AUTH_UNAVAILABLE', 'Authentication service is unavailable.');
    }
    const claims = data?.claims;
    if (!claims?.sub) return null;
    const user = { id: claims.sub, email: claims.email };
    // Never trust past the token's own expiry; at most 60 s, so sign-outs and bans apply quickly.
    const until = Math.min(Date.now() + 60_000, (claims.exp ?? 0) * 1000);
    if (until > Date.now()) {
      if (cache.size > 2000) cache.clear();
      cache.set(token, { user, until });
    }
    return user;
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
