import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../server/app.js';
import { verifyPassword } from '../server/passwords.js';
import { usersDatabase } from './users-fixture.js';

const account = { username: ' New.User ', displayName: ' New User ', password: 'new-account-password' };

async function withApi(run) {
  const db = await usersDatabase();
  const server = createApp(db, { serveClient: false }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, { body, cookie, origin } = {}) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}), ...(origin ? { Origin: origin } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const login = async (username = 'admin.test', password = 'fixture-password-123') => {
    const result = await request('/api/auth/login', { body: { username, password } });
    assert.equal(result.status, 200);
    return result.cookie;
  };
  try { await run({ db, request, login }); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('only administrators can list and add users; roles are refreshed on each request', async () => {
  await withApi(async ({ db, request, login }) => {
    for (const body of [undefined, account]) {
      assert.equal((await request('/api/users', { body })).status, 401);
    }
    const regularCookie = await login('regular.test');
    for (const body of [undefined, { ...account, isAdmin: true }]) {
      assert.equal((await request('/api/users', { cookie: regularCookie, body })).status, 403);
    }
    assert.equal((await request('/api/products', { cookie: regularCookie })).status, 200);
    const cookie = await login();
    const session = await request('/api/auth/session', { cookie });
    assert.equal(session.body.user.isAdmin, true);
    const list = await request('/api/users', { cookie });
    assert.equal(list.status, 200);
    assert.equal(list.body.length, 2);
    assert.ok(list.body.every((user) => !('passwordHash' in user) && !('password' in user)));
    const query = db.calls.find(({ statement }) => statement.includes('FROM dbo.app_users ORDER BY username')).statement;
    assert.doesNotMatch(query, /password_hash|SELECT\s+\*/i);
    db.users[0].isAdmin = false;
    assert.equal((await request('/api/users', { cookie })).status, 403);
    db.users[0].isActive = false;
    assert.equal((await request('/api/users', { cookie })).status, 401);
    assert.equal(db.users.length, 2);
  });
});

test('administrator creates a normalized account with a salted hash that can sign in', async () => {
  await withApi(async ({ db, request, login }) => {
    const cookie = await login();
    const result = await request('/api/users', { cookie, body: account });
    assert.equal(result.status, 201);
    assert.deepEqual(result.body, { id: 3, username: 'new.user', displayName: 'New User', isAdmin: false, isActive: true });
    assert.notEqual(db.users[2].passwordHash, account.password);
    assert.ok(await verifyPassword(account.password, db.users[2].passwordHash));
    const insert = db.calls.find(({ statement }) => statement.includes('INSERT INTO dbo.app_users'));
    assert.equal(insert.parameters.username[1], 'new.user');
    assert.equal(insert.parameters.displayName[1], 'New User');
    assert.doesNotMatch(insert.statement, /new-account-password|new\.user/i);
    assert.equal(JSON.stringify(result.body).includes(account.password), false);
    const newCookie = await login('NEW.USER', account.password);
    assert.equal((await request('/api/products', { cookie: newCookie })).status, 200);
    assert.equal((await request('/api/users', { cookie: newCookie })).status, 403);
    const list = await request('/api/users', { cookie });
    assert.equal(list.body.length, 3);
    assert.equal((await request('/api/users', { cookie, body: { ...account, username: 'NEW.USER' } })).status, 409);
    assert.equal(db.users.length, 3);
  });
});

test('six-character passwords can be used for new accounts and sign-in', async () => {
  await withApi(async ({ request, login }) => {
    const cookie = await login();
    const rejected = await request('/api/users', { cookie, body: { ...account, password: 'abcde' } });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, 'Password must contain between 6 and 256 characters.');
    const created = await request('/api/users', { cookie, body: { ...account, password: 'Six!42' } });
    assert.equal(created.status, 201);
    const newCookie = await login('new.user', 'Six!42');
    assert.equal((await request('/api/products', { cookie: newCookie })).status, 200);
  });
});

test('administrator can explicitly create another administrator', async () => {
  await withApi(async ({ request, login }) => {
    const cookie = await login();
    const created = await request('/api/users', { cookie, body: { ...account, isAdmin: true } });
    assert.equal(created.status, 201);
    assert.equal(created.body.isAdmin, true);
    const newCookie = await login('new.user', account.password);
    assert.equal((await request('/api/auth/session', { cookie: newCookie })).body.user.isAdmin, true);
    assert.equal((await request('/api/users', { cookie: newCookie })).status, 200);
  });
});

test('invalid account fields and cross-site writes are rejected without inserting', async () => {
  await withApi(async ({ db, request, login }) => {
    const cookie = await login();
    const invalid = [
      {}, [], { ...account, username: 'ab' }, { ...account, username: 'x'.repeat(101) },
      { ...account, username: 'bad user' }, { ...account, username: 123 },
      { ...account, displayName: ' ' }, { ...account, displayName: 'x'.repeat(151) },
      { ...account, displayName: null }, { ...account, password: 'short' },
      { ...account, password: 'x'.repeat(257) }, { ...account, password: 123 },
      ...['true', 'false', 1, null, {}].map((isAdmin) => ({ ...account, isAdmin })),
    ];
    for (const body of invalid) assert.equal((await request('/api/users', { cookie, body })).status, 400);
    assert.equal((await request('/api/users', { cookie, body: account, origin: 'https://other.example' })).status, 403);
    assert.equal(db.users.length, 2);
    assert.equal(db.calls.some(({ statement }) => statement.includes('INSERT INTO dbo.app_users')), false);
  });
});
