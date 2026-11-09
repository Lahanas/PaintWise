import { route, send, body, HttpError } from '../_lib/http.js';
import { query } from '../_lib/db.js';
import { hashPassword, checkPassword, sha256, endAllSessions, startSession } from '../_lib/auth.js';
import { clearHits } from '../_lib/limits.js';

// POST /api/auth/reset  { token, password }
// Uses the link from the email: sets the new password, logs out everywhere else, logs in here.
export default route({
  async POST(req, res) {
    const { token, password } = body(req);
    const hash = await hashPassword(checkPassword(password));
    // Mark the link as used in the same step that checks it, so it can only work once.
    const rows = await query(
      `UPDATE password_resets SET used_at = now()
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
       RETURNING user_id`,
      [sha256(String(token || ''))],
    );
    if (!rows[0]) throw new HttpError(400, 'This reset link has expired or was already used. Ask for a new one.');
    const userId = rows[0].user_id;
    const [user] = await query('UPDATE users SET password_hash = $2 WHERE id = $1 RETURNING id, email', [userId, hash]);
    await clearHits(`login:email:${user.email}`);
    await endAllSessions(userId);
    await startSession(req, res, userId);
    send(res, 200, { user });
  },
});
