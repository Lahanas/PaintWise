import { route, send, body, HttpError } from '../_lib/http.js';
import { query } from '../_lib/db.js';
import { requireUser } from '../_lib/auth.js';
import { checkId, checkProject, toProject } from '../_lib/projects.js';

// Every query includes user_id, so nobody can read or change someone else's project,
// even if they guess its id.
function found(rows) {
  if (!rows[0]) throw new HttpError(404, 'Project not found');
  return rows[0];
}

export default route({
  // GET /api/projects/:id → the full project
  async GET(req, res) {
    const user = await requireUser(req);
    const rows = await query('SELECT id, name, updated_at, data FROM projects WHERE id = $1 AND user_id = $2', [checkId(req.query.id), user.id]);
    send(res, 200, { project: toProject(found(rows)) });
  },
  // PUT /api/projects/:id { name, data } → saves changes
  async PUT(req, res) {
    const user = await requireUser(req);
    const { name, data } = checkProject(body(req));
    const rows = await query(
      `UPDATE projects SET name = $3, data = $4, updated_at = now()
       WHERE id = $1 AND user_id = $2 RETURNING id, name, updated_at, data`,
      [checkId(req.query.id), user.id, name, JSON.stringify(data)],
    );
    send(res, 200, { project: toProject(found(rows)) });
  },
  // DELETE /api/projects/:id
  async DELETE(req, res) {
    const user = await requireUser(req);
    found(await query('DELETE FROM projects WHERE id = $1 AND user_id = $2 RETURNING id', [checkId(req.query.id), user.id]));
    send(res, 204);
  },
});
