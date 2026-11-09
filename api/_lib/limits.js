// Rate limiting backed by the database, so it works across serverless instances.
import { query } from './db.js';
import { HttpError } from './http.js';

/** The visitor's IP address as Vercel reports it. */
export function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || (req.socket && req.socket.remoteAddress) || 'unknown';
}

/** Throw 429 if `key` was recorded `max` times or more in the last `minutes`. */
export async function checkLimit(key, max, minutes) {
  const rows = await query(
    `SELECT count(*)::int AS n FROM rate_limits WHERE key = $1 AND at > now() - make_interval(mins => $2)`,
    [key, minutes],
  );
  if (rows[0].n >= max) {
    throw new HttpError(429, `Too many attempts. Please wait ${minutes} minutes and try again.`);
  }
}

/** Count one event for `key`, and forget events older than a day. */
export async function recordHit(key) {
  await query('INSERT INTO rate_limits (key) VALUES ($1)', [key]);
  await query(`DELETE FROM rate_limits WHERE key = $1 AND at < now() - interval '1 day'`, [key]);
}

export async function clearHits(key) {
  await query('DELETE FROM rate_limits WHERE key = $1', [key]);
}
