import { route, send } from '../_lib/http.js';
import { currentUser } from '../_lib/auth.js';

// GET /api/auth/me → { user } or { user: null }
export default route({
  async GET(req, res) {
    send(res, 200, { user: await currentUser(req) });
  },
});
