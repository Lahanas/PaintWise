// Runs the real API routes against a real (in-memory) Postgres, over HTTP.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, pgliteDb } from '../scripts/dev.js';

let server;
let db;
let base;

before(async () => {
  db = await pgliteDb();
  server = createApp(db);
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://localhost:${server.address().port}`;
});

after(async () => {
  server.close();
  await db.close();
});

// A tiny browser: remembers the session cookie between requests.
function client() {
  let cookie = '';
  return async function call(method, path, payload, headers = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(payload !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      body: payload !== undefined ? JSON.stringify(payload) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, setCookie };
  };
}

const project = { system: 'metric', coats: 2, rooms: [{ name: 'Kitchen', length: 4, width: 3, height: 2.5 }] };

test('sign up, stay logged in, log out', async () => {
  const call = client();
  assert.deepEqual((await call('GET', '/api/auth/me')).body, { user: null });

  const signup = await call('POST', '/api/auth/signup', { email: ' Anas@Example.com ', password: 'paint-it-green' });
  assert.equal(signup.status, 201);
  assert.equal(signup.body.user.email, 'anas@example.com');
  assert.match(signup.setCookie, /HttpOnly/);
  assert.match(signup.setCookie, /SameSite=Lax/);

  assert.equal((await call('GET', '/api/auth/me')).body.user.email, 'anas@example.com');
  assert.equal((await call('POST', '/api/auth/logout', {})).status, 204);
  assert.equal((await call('GET', '/api/auth/me')).body.user, null);
});

test('passwords are hashed, never stored as typed', async () => {
  const call = client();
  await call('POST', '/api/auth/signup', { email: 'hash@example.com', password: 'super-secret-1' });
  const [row] = await db.query("SELECT password_hash FROM users WHERE email = 'hash@example.com'");
  assert.ok(row.password_hash.startsWith('scrypt$'));
  assert.ok(!row.password_hash.includes('super-secret-1'));
});

test('sign up checks email, password and duplicates', async () => {
  const call = client();
  assert.equal((await call('POST', '/api/auth/signup', { email: 'nope', password: 'longenough' })).status, 400);
  assert.equal((await call('POST', '/api/auth/signup', { email: 'short@example.com', password: '123' })).status, 400);
  await call('POST', '/api/auth/signup', { email: 'twice@example.com', password: 'longenough' });
  const again = await client()('POST', '/api/auth/signup', { email: 'TWICE@example.com', password: 'longenough' });
  assert.equal(again.status, 409);
});

test('log in with the right password only', async () => {
  await client()('POST', '/api/auth/signup', { email: 'login@example.com', password: 'correct-horse' });
  const call = client();
  const wrong = await call('POST', '/api/auth/login', { email: 'login@example.com', password: 'wrong-horse' });
  assert.equal(wrong.status, 401);
  const unknown = await call('POST', '/api/auth/login', { email: 'nobody@example.com', password: 'correct-horse' });
  assert.equal(unknown.status, 401);
  assert.equal(unknown.body.error, wrong.body.error, 'same message, so emails cannot be guessed');
  const ok = await call('POST', '/api/auth/login', { email: 'LOGIN@example.com', password: 'correct-horse' });
  assert.equal(ok.status, 200);
  assert.equal((await call('GET', '/api/auth/me')).body.user.email, 'login@example.com');
});

test('projects: create, list, read, update, delete', async () => {
  const call = client();
  await call('POST', '/api/auth/signup', { email: 'crud@example.com', password: 'longenough' });

  const created = await call('POST', '/api/projects', { name: 'Kitchen', data: project });
  assert.equal(created.status, 201);
  const id = created.body.project.id;

  const list = await call('GET', '/api/projects');
  assert.deepEqual(list.body.projects.map((p) => p.name), ['Kitchen']);
  assert.equal(list.body.projects[0].data, undefined, 'the list stays small');

  const read = await call('GET', `/api/projects/${id}`);
  assert.deepEqual(read.body.project.data, project);

  const updated = await call('PUT', `/api/projects/${id}`, { name: 'Kitchen v2', data: { ...project, coats: 3 } });
  assert.equal(updated.body.project.name, 'Kitchen v2');
  assert.equal(updated.body.project.data.coats, 3);

  assert.equal((await call('DELETE', `/api/projects/${id}`)).status, 204);
  assert.equal((await call('GET', `/api/projects/${id}`)).status, 404);
});

test("you can't see or change someone else's project", async () => {
  const alice = client();
  const bob = client();
  await alice('POST', '/api/auth/signup', { email: 'alice@example.com', password: 'longenough' });
  await bob('POST', '/api/auth/signup', { email: 'bob@example.com', password: 'longenough' });
  const { body } = await alice('POST', '/api/projects', { name: 'Alice home', data: project });
  const id = body.project.id;

  assert.equal((await bob('GET', `/api/projects/${id}`)).status, 404);
  assert.equal((await bob('PUT', `/api/projects/${id}`, { name: 'hacked', data: project })).status, 404);
  assert.equal((await bob('DELETE', `/api/projects/${id}`)).status, 404);
  assert.deepEqual((await bob('GET', '/api/projects')).body.projects, []);
  assert.equal((await alice('GET', `/api/projects/${id}`)).body.project.name, 'Alice home');
});

test('projects need a login', async () => {
  const call = client();
  assert.equal((await call('GET', '/api/projects')).status, 401);
  assert.equal((await call('POST', '/api/projects', { name: 'x', data: project })).status, 401);
});

test('bad project data is refused', async () => {
  const call = client();
  await call('POST', '/api/auth/signup', { email: 'bad@example.com', password: 'longenough' });
  assert.equal((await call('POST', '/api/projects', { name: 'x', data: { rooms: 'nope' } })).status, 400);
  const huge = { ...project, rooms: Array.from({ length: 5000 }, () => ({ name: 'x'.repeat(50), length: 1 })) };
  assert.equal((await call('POST', '/api/projects', { name: 'big', data: huge })).status, 413);
  assert.equal((await call('GET', '/api/projects/not-a-uuid')).status, 404);
});

test('changes must be sent as JSON (blocks cross-site form posts)', async () => {
  const res = await fetch(`${base}/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'email=a@b.co&password=longenough',
  });
  assert.equal(res.status, 415);
});

test('wrong method is refused', async () => {
  assert.equal((await client()('GET', '/api/auth/login')).status, 405);
});
