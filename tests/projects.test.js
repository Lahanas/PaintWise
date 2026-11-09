import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProject, decodeProject, listProjects, saveProject, deleteProject } from '../src/projects.js';

const project = {
  system: 'metric',
  coats: 2,
  rooms: [{ name: 'Chambre d’Anas ✨', length: 4, width: 3.5, height: 2.5, doors: 1, windows: 1 }],
  quote: { client: 'Sam', notes: 'Line 1\nLine 2' },
};

// Minimal in-memory stand-in for localStorage.
function memoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
  };
}

test('a project survives a share link round trip, including accents and emoji', async () => {
  const code = await encodeProject(project);
  assert.match(code, /^[zj][A-Za-z0-9_-]+$/, 'URL-safe');
  assert.deepEqual(await decodeProject(code), project);
});

test('compressed links are shorter than plain JSON for real projects', async () => {
  const big = { ...project, rooms: Array.from({ length: 8 }, (_, i) => ({ ...project.rooms[0], name: `Room ${i}` })) };
  const code = await encodeProject(big);
  assert.ok(code.length < JSON.stringify(big).length);
});

test('broken or foreign links are rejected', async () => {
  assert.equal(await decodeProject('zNOTVALID'), null);
  assert.equal(await decodeProject('x123'), null);
  assert.equal(await decodeProject('j' + Buffer.from('{"hello":1}').toString('base64url')), null);
});

test('save, list, update and delete projects', () => {
  const storage = memoryStorage();
  const a = saveProject('Kitchen', project, undefined, storage);
  const b = saveProject('  ', project, undefined, storage);
  assert.equal(b.name, 'Untitled project');
  assert.equal(listProjects(storage).length, 2);

  saveProject('Kitchen v2', { ...project, coats: 3 }, a.id, storage);
  const list = listProjects(storage);
  assert.equal(list.length, 2);
  const kitchen = list.find((p) => p.id === a.id);
  assert.equal(kitchen.name, 'Kitchen v2');
  assert.equal(kitchen.state.coats, 3);

  deleteProject(a.id, storage);
  assert.deepEqual(listProjects(storage).map((p) => p.id), [b.id]);
});

test('saved state is a copy, not a live reference', () => {
  const storage = memoryStorage();
  const state = JSON.parse(JSON.stringify(project));
  const saved = saveProject('Copy test', state, undefined, storage);
  state.rooms[0].length = 99;
  assert.equal(listProjects(storage).find((p) => p.id === saved.id).state.rooms[0].length, 4);
});

test('corrupted storage gives an empty list instead of crashing', () => {
  const storage = memoryStorage();
  storage.setItem('wpe:projects', '{not json');
  assert.deepEqual(listProjects(storage), []);
});
