import { route, send, body, HttpError } from '../_lib/http.js';
import { query } from '../_lib/db.js';
import { verifyPassword, hashPassword, normalizeEmail, startSession } from '../_lib/auth.js';
import { checkLimit, recordHit, clearHits, clientIp } from '../_lib/limits.js';

// Used when the email doesn't exist, so a wrong email takes as long as a wrong password.
let dummyHash = null;

// Limits on failed logins, so passwords can't be guessed by trying many times.
const PER_ACCOUNT = { max: 8, minutes: 15 };
const PER_IP = { max: 30, minutes: 15 };

// POST /api/auth/login  { email, password }
export default route({
  async POST(req, res) {
    const { email, password } = body(req);
    const cleanEmail = normalizeEmail(email);
    const accountKey = `login:email:${cleanEmail}`;
    const ipKey = `login:ip:${clientIp(req)}`;
    await checkLimit(accountKey, PER_ACCOUNT.max, PER_ACCOUNT.minutes);
    await checkLimit(ipKey, PER_IP.max, PER_IP.minutes);

    const rows = await query('SELECT id, email, password_hash FROM users WHERE email = $1', [cleanEmail]);
    const user = rows[0];
    if (!dummyHash) dummyHash = await hashPassword('not-a-real-password');
    const ok = await verifyPassword(String(password || ''), user ? user.password_hash : dummyHash);
    if (!user || !ok) {
      await recordHit(accountKey);
      await recordHit(ipKey);
      throw new HttpError(401, 'Wrong email or password');
    }
    await clearHits(accountKey);
    await startSession(req, res, user.id);
    send(res, 200, { user: { id: user.id, email: user.email } });
  },
});
