import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/passwords.js';

test('sign-in creates a cookie session and protects inventory APIs', async () => {
  const username = 'test.user';
  const password = 'correct-horse-battery';
  const user = {
    id: 7,
    username,
    displayName: 'Test User',
    passwordHash: await hashPassword(password),
    isActive: true,
  };
  const calls = [];
  const db = {
    async query(statement, parameters = {}) {
      calls.push(statement);
      if (statement.includes('FROM dbo.user_sessions s JOIN dbo.app_users u')) {
        return { recordset: [user] };
      }
      if (statement.includes('FROM dbo.app_users WHERE username = @username')) {
        assert.equal(parameters.username[1], username);
        return { recordset: [user] };
      }
      if (statement.includes('DELETE FROM dbo.user_sessions WHERE expires_at')) return { recordset: [] };
      if (statement.includes('FROM dbo.products p')) return { recordset: [] };
      throw new Error(`Unexpected query: ${statement}`);
    },
    async getPool() { return {}; },
    async transaction(work) { return work({}); },
  };
  const server = createApp(db, { serveClient: false }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, { body, cookie } = {}) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { response, data: await response.json() };
  };
  const loginWithOrigin = async (origin) => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    return { response, data: await response.json() };
  };

  try {
    const crossSite = await loginWithOrigin('https://attacker.example');
    assert.equal(crossSite.response.status, 403);
    assert.equal(crossSite.data.error, 'Cross-site requests are not allowed.');

    const anonymous = await request('/api/products');
    assert.equal(anonymous.response.status, 401);
    assert.equal(anonymous.data.error, 'Please sign in to continue.');
    assert.equal(calls.length, 0);

    const signedIn = await request('/api/auth/login', { body: { username: 'TEST.USER', password } });
    assert.equal(signedIn.response.status, 200);
    assert.deepEqual(signedIn.data.user, { id: 7, username, displayName: 'Test User' });
    const cookie = signedIn.response.headers.get('set-cookie').split(';')[0];
    assert.match(cookie, /^mak_inventory_session=[a-f0-9]{64}$/);
    assert.match(signedIn.response.headers.get('set-cookie'), /HttpOnly/i);

    const session = await request('/api/auth/session', { cookie });
    assert.deepEqual(session.data.user, { id: 7, username, displayName: 'Test User' });
    const products = await request('/api/products', { cookie });
    assert.equal(products.response.status, 200);
    assert.deepEqual(products.data, []);
    assert.ok(calls.some((statement) => statement.includes('FROM dbo.user_sessions s JOIN dbo.app_users u')));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});