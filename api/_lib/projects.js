// Checks on what users send before it goes into the database.
import { HttpError } from './http.js';

const MAX_BYTES = 200 * 1024; // a big job is a few KB, so this is plenty
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function checkId(id) {
  if (!UUID.test(String(id || ''))) throw new HttpError(404, 'Project not found');
  return id;
}

export function checkProject(input) {
  const name = String((input && input.name) || '').trim().slice(0, 100) || 'Untitled project';
  const data = input && input.data;
  if (!data || typeof data !== 'object' || !Array.isArray(data.rooms) || !['metric', 'imperial'].includes(data.system)) {
    throw new HttpError(400, 'That project is missing its rooms or units');
  }
  if (JSON.stringify(data).length > MAX_BYTES) throw new HttpError(413, 'That project is too big to save');
  return { name, data };
}

export const toProject = (row) => ({ id: row.id, name: row.name, updated: new Date(row.updated_at).getTime(), ...(row.data ? { data: row.data } : {}) });
