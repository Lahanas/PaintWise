import { route, send, body } from '../_lib/http.js';
import { query } from '../_lib/db.js';
import { requireUser } from '../_lib/auth.js';
import { checkProject, toProject } from '../_lib/projects.js';

export default route({
  // GET /api/projects → your projects, newest first (names only, not the full data)
  async GET(req, res) {
    const user = await requireUser(req);
    const rows = await query('SELECT id, name, updated_at FROM projects WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 500', [user.id]);
    send(res, 200, { projects: rows.map(toProject) });
  },
  // POST /api/projects { name, data } → creates a project
  async POST(req, res) {
    const user = await requireUser(req);
    const { name, data } = checkProject(body(req));
    const rows = await query(
      'INSERT INTO projects (user_id, name, data) VALUES ($1, $2, $3) RETURNING id, name, updated_at, data',
      [user.id, name, JSON.stringify(data)],
    );
    send(res, 201, { project: toProject(rows[0]) });
  },
});
