import { route, send } from '../_lib/http.js';
import { endSession } from '../_lib/auth.js';

// POST /api/auth/logout
export default route({
  async POST(req, res) {
    await endSession(req, res);
    send(res, 204);
  },
});
