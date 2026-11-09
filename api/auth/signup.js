import { route, send, body, HttpError } from '../_lib/http.js';
import { query } from '../_lib/db.js';
import { hashPassword, normalizeEmail, checkPassword, startSession } from '../_lib/auth.js';

// POST /api/auth/signup  { email, password } → creates the account and logs in
export default route({
  async POST(req, res) {
    const { email, password } = body(req);
    const cleanEmail = normalizeEmail(email);
    const hash = await hashPassword(checkPassword(password));
    const rows = await query(
      `INSERT INTO users (email, password_hash) VALUES ($1, $2)
       ON CONFLICT (email) DO NOTHING RETURNING id, email`,
      [cleanEmail, hash],
    );
    if (!rows[0]) throw new HttpError(409, 'An account with this email already exists. Try logging in.');
    await startSession(req, res, rows[0].id);
    send(res, 201, { user: rows[0] });
  },
});
