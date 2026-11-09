// Accounts and sessions.
// Passwords are hashed with scrypt (slow on purpose, with a random salt per user).
// A login gives the browser a random session token in an HttpOnly cookie, which page
// scripts can't read; the database only keeps a SHA-256 hash of that token.

import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { query } from './db.js';
import { HttpError, readCookie } from './http.js';

const scrypt = promisify(scryptCb);
const COOKIE = 'pw_session';
const SESSION_DAYS = 30;
const KEY_LENGTH = 64;
const SCRYPT = { N: 16384, r: 8, p: 1 };

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LENGTH, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [kind, saltB64, keyB64] = String(stored).split('$');
  if (kind !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, SCRYPT);
  return timingSafeEqual(key, expected);
}

export const sha256 = (text) => createHash('sha256').update(text).digest('hex');

export function normalizeEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new HttpError(400, 'Enter a valid email address');
  return value;
}

export function checkPassword(password) {
  if (typeof password !== 'string' || password.length < 8) throw new HttpError(400, 'Use a password of at least 8 characters');
  if (password.length > 200) throw new HttpError(400, 'That password is too long');
  return password;
}

function cookieHeader(req, value, maxAgeSeconds) {
  const secure = process.env.NODE_ENV === 'production' || req.headers['x-forwarded-proto'] === 'https';
  return [
    `${COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
    secure ? 'Secure' : '',
  ].filter(Boolean).join('; ');
}

/** Log out everywhere: remove all of a user's sessions (after a password change or reset). */
export async function endAllSessions(userId) {
  await query('DELETE FROM sessions WHERE user_id = $1', [userId]);
}

/** Start a session for this user and set the cookie. */
export async function startSession(req, res, userId) {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000);
  await query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [sha256(token), userId, expires]);
  // Tidy up: remove this user's expired sessions.
  await query('DELETE FROM sessions WHERE user_id = $1 AND expires_at < now()', [userId]);
  res.setHeader('Set-Cookie', cookieHeader(req, token, SESSION_DAYS * 24 * 3600));
}

export async function endSession(req, res) {
  const token = readCookie(req, COOKIE);
  if (token) await query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
  res.setHeader('Set-Cookie', cookieHeader(req, '', 0));
}

/** The logged-in user, or null. */
export async function currentUser(req) {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  const rows = await query(
    `SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [sha256(token)],
  );
  return rows[0] || null;
}

export async function requireUser(req) {
  const user = await currentUser(req);
  if (!user) throw new HttpError(401, 'Please log in');
  return user;
}
