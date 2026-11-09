import { randomBytes } from 'node:crypto';
import { route, send, body } from '../_lib/http.js';
import { query } from '../_lib/db.js';
import { normalizeEmail, sha256 } from '../_lib/auth.js';
import { checkLimit, recordHit, clientIp } from '../_lib/limits.js';
import { sendMail, mailEnabled } from '../_lib/mail.js';

const LINK_MINUTES = 60;
const SAME_ANSWER = { ok: true, message: 'If that email has an account, a reset link is on its way. Check your inbox (and spam).' };

function siteUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0];
  return `${proto}://${req.headers.host}`;
}

// POST /api/auth/forgot  { email }
// Always gives the same answer, so nobody can use it to find out who has an account.
export default route({
  async POST(req, res) {
    if (!mailEnabled()) return send(res, 503, { error: "Password reset by email isn't set up on this site yet." });
    const email = normalizeEmail(body(req).email);
    const emailKey = `forgot:email:${email}`;
    const ipKey = `forgot:ip:${clientIp(req)}`;
    await checkLimit(emailKey, 3, 60);
    await checkLimit(ipKey, 10, 60);
    await recordHit(emailKey);
    await recordHit(ipKey);

    const [user] = await query('SELECT id, email FROM users WHERE email = $1', [email]);
    if (user) {
      const token = randomBytes(32).toString('base64url');
      await query('DELETE FROM password_resets WHERE user_id = $1', [user.id]); // only the newest link works
      await query(
        'INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
        [sha256(token), user.id, new Date(Date.now() + LINK_MINUTES * 60 * 1000)],
      );
      const link = `${siteUrl(req)}/#reset=${token}`;
      await sendMail({
        to: user.email,
        subject: 'Reset your PaintWise password',
        text: `Someone asked to reset the password for your PaintWise account.\n\nTo choose a new password, open this link within ${LINK_MINUTES} minutes:\n${link}\n\nIf it wasn't you, you can ignore this email. Your password stays the same.`,
        html: `<p>Someone asked to reset the password for your PaintWise account.</p><p><a href="${link}">Choose a new password</a> (this link works for ${LINK_MINUTES} minutes).</p><p>If it wasn't you, you can ignore this email. Your password stays the same.</p>`,
      });
    }
    send(res, 200, SAME_ANSWER);
  },
});
