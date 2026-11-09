import { route, send, body, HttpError } from '../_lib/http.js';
import { query } from '../_lib/db.js';
import { verifyPassword, hashPassword, normalizeEmail, startSession } from '../_lib/auth.js';

// Used when the email doesn't exist, so a wrong email takes as long as a wrong password.
let dummyHash = null;

// POST /api/auth/login  { email, password }
export default route({
  async POST(req, res) {
    const { email, password } = body(req);
    const rows = await query('SELECT id, email, password_hash FROM users WHERE email = $1', [normalizeEmail(email)]);
    const user = rows[0];
    if (!dummyHash) dummyHash = await hashPassword('not-a-real-password');
    const ok = await verifyPassword(String(password || ''), user ? user.password_hash : dummyHash);
    if (!user || !ok) throw new HttpError(401, 'Wrong email or password');
    await startSession(req, res, user.id);
    send(res, 200, { user: { id: user.id, email: user.email } });
  },
});
