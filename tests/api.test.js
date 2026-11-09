// Runs the real API routes against a real (in-memory) Postgres, over HTTP.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, pgliteDb } from '../scripts/dev.js';
import { setMailer } from '../api/_lib/mail.js';

// Emails are captured here instead of being sent.
const outbox = [];
setMailer(async (mail) => { outbox.push(mail); });
const lastLinkTo = (email) => {
  const mail = [...outbox].reverse().find((m) => m.to === email);
  return mail && /#reset=([A-Za-z0-9_-]+)/.exec(mail.text)[1];
};

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
// Each one gets its own IP address, like separate visitors (Vercel sets this header).
let nextIp = 1;
function client() {
  let cookie = '';
  const ip = `10.0.${Math.floor(nextIp / 250)}.${(nextIp++ % 250) + 1}`;
  return async function call(method, path, payload, headers = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(payload !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(cookie ? { cookie } : {}),
        'x-forwarded-for': ip,
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
  const me = (await call('GET', '/api/auth/me')).body;
  assert.equal(me.user, null);
  assert.equal(me.features.passwordReset, true);

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

test('too many wrong passwords locks that account for a while', async () => {
  await client()('POST', '/api/auth/signup', { email: 'locked@example.com', password: 'the-right-one' });
  const call = client();
  for (let i = 0; i < 8; i++) {
    assert.equal((await call('POST', '/api/auth/login', { email: 'locked@example.com', password: `guess-${i}-xx` })).status, 401);
  }
  const blocked = await call('POST', '/api/auth/login', { email: 'locked@example.com', password: 'the-right-one' });
  assert.equal(blocked.status, 429, 'even the right password waits, so guessing gains nothing');
  assert.match(blocked.body.error, /Too many attempts/);
  // other accounts are not affected
  await client()('POST', '/api/auth/signup', { email: 'fine@example.com', password: 'longenough' });
  assert.equal((await client()('POST', '/api/auth/login', { email: 'fine@example.com', password: 'longenough' })).status, 200);
});

test('a successful login resets the failed-login counter', async () => {
  await client()('POST', '/api/auth/signup', { email: 'reset-count@example.com', password: 'the-right-one' });
  const call = client();
  for (let i = 0; i < 7; i++) await call('POST', '/api/auth/login', { email: 'reset-count@example.com', password: `nope-${i}-xx` });
  assert.equal((await call('POST', '/api/auth/login', { email: 'reset-count@example.com', password: 'the-right-one' })).status, 200);
  for (let i = 0; i < 7; i++) await call('POST', '/api/auth/login', { email: 'reset-count@example.com', password: `nope-${i}-yy` });
  assert.equal((await call('POST', '/api/auth/login', { email: 'reset-count@example.com', password: 'the-right-one' })).status, 200);
});

test('too many failed logins from one IP address are blocked too', async () => {
  const call = client();
  for (let i = 0; i < 30; i++) {
    await call('POST', '/api/auth/login', { email: `nobody${i}@example.com`, password: 'whatever-xx' });
  }
  assert.equal((await call('POST', '/api/auth/login', { email: 'someone@example.com', password: 'whatever-xx' })).status, 429);
});

test('change password: needs the current one, then logs out other devices', async () => {
  const laptop = client();
  const phone = client();
  await laptop('POST', '/api/auth/signup', { email: 'change@example.com', password: 'old-password' });
  await phone('POST', '/api/auth/login', { email: 'change@example.com', password: 'old-password' });

  const wrong = await laptop('POST', '/api/auth/password', { currentPassword: 'not-it-at-all', newPassword: 'new-password' });
  assert.equal(wrong.status, 400);
  const tooShort = await laptop('POST', '/api/auth/password', { currentPassword: 'old-password', newPassword: 'short' });
  assert.equal(tooShort.status, 400);

  assert.equal((await laptop('POST', '/api/auth/password', { currentPassword: 'old-password', newPassword: 'new-password' })).status, 200);
  assert.equal((await laptop('GET', '/api/auth/me')).body.user.email, 'change@example.com', 'still logged in here');
  assert.equal((await phone('GET', '/api/auth/me')).body.user, null, 'other device was logged out');
  assert.equal((await client()('POST', '/api/auth/login', { email: 'change@example.com', password: 'old-password' })).status, 401);
  assert.equal((await client()('POST', '/api/auth/login', { email: 'change@example.com', password: 'new-password' })).status, 200);
});

test('forgot password: same answer whether or not the account exists', async () => {
  await client()('POST', '/api/auth/signup', { email: 'forgetful@example.com', password: 'longenough' });
  const before = outbox.length;
  const real = await client()('POST', '/api/auth/forgot', { email: 'forgetful@example.com' });
  const fake = await client()('POST', '/api/auth/forgot', { email: 'ghost@example.com' });
  assert.equal(real.status, 200);
  assert.deepEqual(real.body, fake.body);
  assert.equal(outbox.length, before + 1, 'only the real account gets an email');
  assert.equal(outbox.at(-1).to, 'forgetful@example.com');
});

test('reset link: sets a new password, logs out everywhere, works only once', async () => {
  const oldDevice = client();
  await oldDevice('POST', '/api/auth/signup', { email: 'resetme@example.com', password: 'forgotten-one' });
  await client()('POST', '/api/auth/forgot', { email: 'resetme@example.com' });
  const token = lastLinkTo('resetme@example.com');
  assert.ok(token);
  const [stored] = await db.query("SELECT token_hash FROM password_resets pr JOIN users u ON u.id = pr.user_id WHERE u.email = 'resetme@example.com'");
  assert.notEqual(stored.token_hash, token, 'only a hash of the link is stored');

  const browser = client();
  const done = await browser('POST', '/api/auth/reset', { token, password: 'brand-new-one' });
  assert.equal(done.status, 200);
  assert.equal((await browser('GET', '/api/auth/me')).body.user.email, 'resetme@example.com');
  assert.equal((await oldDevice('GET', '/api/auth/me')).body.user, null);
  assert.equal((await client()('POST', '/api/auth/login', { email: 'resetme@example.com', password: 'brand-new-one' })).status, 200);

  const again = await client()('POST', '/api/auth/reset', { token, password: 'another-one-x' });
  assert.equal(again.status, 400);
});

test('reset link: expired or made-up links are refused', async () => {
  await client()('POST', '/api/auth/signup', { email: 'late@example.com', password: 'longenough' });
  await client()('POST', '/api/auth/forgot', { email: 'late@example.com' });
  const token = lastLinkTo('late@example.com');
  await db.query("UPDATE password_resets SET expires_at = now() - interval '1 minute'");
  assert.equal((await client()('POST', '/api/auth/reset', { token, password: 'too-late-now' })).status, 400);
  assert.equal((await client()('POST', '/api/auth/reset', { token: 'made-up-token', password: 'longenough' })).status, 400);
});

test('forgot password: limited to 3 emails per hour per address', async () => {
  await client()('POST', '/api/auth/signup', { email: 'spam@example.com', password: 'longenough' });
  for (let i = 0; i < 3; i++) assert.equal((await client()('POST', '/api/auth/forgot', { email: 'spam@example.com' })).status, 200);
  assert.equal((await client()('POST', '/api/auth/forgot', { email: 'spam@example.com' })).status, 429);
});

test('without email set up, the reset feature says so', async () => {
  setMailer(null);
  const saved = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  try {
    assert.equal((await client()('GET', '/api/auth/me')).body.features.passwordReset, false);
    assert.equal((await client()('POST', '/api/auth/forgot', { email: 'x@example.com' })).status, 503);
  } finally {
    if (saved) process.env.RESEND_API_KEY = saved;
    setMailer(async (mail) => { outbox.push(mail); });
  }
});
