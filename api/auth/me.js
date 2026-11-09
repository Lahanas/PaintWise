import { route, send } from '../_lib/http.js';
import { currentUser } from '../_lib/auth.js';
import { mailEnabled } from '../_lib/mail.js';

// GET /api/auth/me → { user } or { user: null }, plus which optional features are on
export default route({
  async GET(req, res) {
    send(res, 200, { user: await currentUser(req), features: { passwordReset: mailEnabled() } });
  },
});
