import { route, send, body, HttpError } from '../_lib/http.js';
import { query } from '../_lib/db.js';
import { requireUser, verifyPassword, hashPassword, checkPassword, endAllSessions, startSession } from '../_lib/auth.js';
import { checkLimit, recordHit, clearHits } from '../_lib/limits.js';

// POST /api/auth/password  { currentPassword, newPassword }
// Changes the password, logs out every other device, and keeps you logged in here.
export default route({
  async POST(req, res) {
    const user = await requireUser(req);
    const { currentPassword, newPassword } = body(req);
    const key = `login:email:${user.email}`;
    await checkLimit(key, 8, 15);
    const [row] = await query('SELECT password_hash FROM users WHERE id = $1', [user.id]);
    if (!(await verifyPassword(String(currentPassword || ''), row.password_hash))) {
      await recordHit(key);
      throw new HttpError(400, 'Your current password is not right');
    }
    const hash = await hashPassword(checkPassword(newPassword));
    await query('UPDATE users SET password_hash = $2 WHERE id = $1', [user.id, hash]);
    await clearHits(key);
    await endAllSessions(user.id);
    await startSession(req, res, user.id);
    send(res, 200, { user });
  },
});
