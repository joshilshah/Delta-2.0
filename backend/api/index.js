// Vercel entry point: every request to the API project is routed here (see vercel.json).
// Locally you run src/server.js instead (`npm start`).
import { waitUntil } from '@vercel/functions';
import { buildFromEnv } from '../src/bootstrap.js';

// Background jobs (offer expiry, demo autopilot, support triage) run after each response is sent,
// kept alive by waitUntil, so they never add to response time.
const built = buildFromEnv({ housekeeping: (promise) => waitUntil(promise) });

export default function handler(req, res) {
  if (built.missing.length) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      status: 'misconfigured',
      error: { code: 'MISSING_ENV', message: `Set these environment variables in Vercel: ${built.missing.join(', ')}` },
    }));
    return;
  }
  return built.app(req, res);
}
