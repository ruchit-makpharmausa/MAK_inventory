import assert from 'node:assert/strict';
import test from 'node:test';
import { checkAccount, resetAccountPassword, runUserPassword } from '../scripts/user-password.js';
import { hashPassword, validPasswordHash, verifyPassword } from '../server/passwords.js';
import { createApp } from '../server/app.js';

function recoveryDatabase(user, { failSessionDelete = false } = {}) {
  const calls = [];
  const sessionIds = [7, 7, 8];
  const token = {};
  const sessions = new Map();
  const db = {
    calls, sessionIds, user, token, committed: false, rolledBack: false,
    async query(statement, parameters, executor) {
      calls.push({ statement, parameters, executor });
      if (statement.includes('SELECT DB_NAME()')) return { recordset: user ? [{ ...user }] : [] };
      if (statement.includes('FROM dbo.app_users WHERE username = @username')) {
        return { recordset: user?.username === parameters.username[1] ? [{ ...user }] : [] };
      }
      if (statement.includes('INSERT INTO dbo.user_sessions')) {
        sessions.set(parameters.tokenHash[1], parameters.userId[1]);
        return { recordset: [] };
      }
      if (statement.includes('FROM dbo.user_sessions s JOIN dbo.app_users u')) {
        return { recordset: user && sessions.get(parameters.tokenHash[1]) === user.id ? [{ ...user }] : [] };
      }
      if (statement.includes('FROM dbo.products p')) return { recordset: [] };
      if (statement.includes('UPDATE dbo.app_users')) {
        if (!user || !user.isActive || user.username !== parameters.username[1]) return { recordset: [] };
        user.passwordHash = parameters.passwordHash[1];
        return { recordset: [{ id: user.id, username: user.username }] };
      }
      if (statement.includes('DELETE FROM dbo.user_sessions')) {
        if (failSessionDelete) throw Object.assign(new Error('Session deletion failed'), { number: 229 });
        for (const [hash, id] of sessions) if (id === parameters.userId[1]) sessions.delete(hash);
        const remaining = sessionIds.filter((id) => id !== parameters.userId[1]);
        sessionIds.splice(0, sessionIds.length, ...remaining);
        return { recordset: [] };
      }
      throw new Error(`Unexpected query: ${statement}`);
    },
    async transaction(work) {
      const oldHash = user?.passwordHash;
      try {
        const result = await work(token);
        db.committed = true;
        return result;
      } catch (error) {
        if (user) user.passwordHash = oldHash;
        db.rolledBack = true;
        throw error;
      }
    },
  };
  return db;
}

const account = (overrides = {}) => ({ id: 7, username: 'test.user', isActive: true, isAdmin: true, databaseName: 'mak_inventory', passwordHash: `scrypt$${'a'.repeat(32)}$${'b'.repeat(128)}`, ...overrides });

test('account diagnosis distinguishes missing, inactive, malformed, and supported hashes without disclosing them', async () => {
  for (const [user, expected] of [
    [null, 'missing'], [account({ isActive: false }), 'inactive'],
    [account({ passwordHash: 'plaintext-not-supported' }), 'invalid-hash'],
    [account(), 'ready'],
  ]) {
    const db = recoveryDatabase(user);
    const result = await checkAccount(db, ' TEST.User ');
    assert.equal(result.status, expected);
    assert.equal(db.calls.length, 1);
    assert.equal(db.calls[0].parameters.username[1], 'test.user');
    assert.doesNotMatch(db.calls[0].statement, /\b(UPDATE|DELETE|INSERT)\b/i);
    assert.equal('passwordHash' in result, false);
    assert.equal('password' in result, false);
    if (user) assert.equal(JSON.stringify(result).includes(user.passwordHash), false);
  }
});

test('optional current-password diagnosis verifies credentials without changing them or logging secrets', async () => {
  const password = 'correct-current-password';
  const user = account({ passwordHash: await hashPassword(password) });
  const originalHash = user.passwordHash;
  const db = recoveryDatabase(user);
  const output = [];
  for (const [supplied, code] of [[password, 0], ['incorrect-current-password', 1]]) {
    const environment = { APP_USER_NAME: 'test.user', APP_USER_PASSWORD: supplied };
    assert.equal(await runUserPassword({ db, args: ['check'], environment, log: (line) => output.push(line) }), code);
    assert.equal('APP_USER_PASSWORD' in environment, false);
  }
  assert.match(output.join('\n'), /Password matches/);
  assert.match(output.join('\n'), /does not match/);
  assert.equal(output.join('\n').includes(password), false);
  assert.equal(output.join('\n').includes(originalHash), false);
  assert.equal(user.passwordHash, originalHash);
  assert.ok(db.calls.every(({ statement }) => !/\b(INSERT|UPDATE|DELETE)\b/i.test(statement)));
  for (const invalid of ['', 123, 'x'.repeat(257)]) {
    await assert.rejects(checkAccount(db, 'test.user', invalid), /APP_USER_PASSWORD/);
  }
});

test('reset changes only the password and revokes only that user sessions in the same transaction', async () => {
  const oldPassword = 'original-password-123';
  const user = account({ passwordHash: await hashPassword(oldPassword) });
  const db = recoveryDatabase(user);
  const result = await resetAccountPassword(db, ' TEST.User ', 'replacement-password-123');
  assert.deepEqual(result, { username: 'test.user' });
  assert.ok(await verifyPassword('replacement-password-123', user.passwordHash));
  assert.equal(await verifyPassword(oldPassword, user.passwordHash), false);
  assert.equal(user.isActive, true);
  assert.equal(user.isAdmin, true);
  assert.deepEqual(db.sessionIds, [8]);
  assert.equal(db.committed, true);
  assert.equal(db.calls.length, 2);
  assert.ok(db.calls.every((call) => call.executor === db.token));
  assert.equal(db.calls[0].parameters.username[1], 'test.user');
  assert.doesNotMatch(db.calls[0].statement, /SET\s+is_admin|SET\s+is_active|replacement-password-123/);
  assert.equal(db.calls[1].parameters.userId[1], 7);
});

test('reset can replace a malformed stored hash without activating or creating accounts', async () => {
  const user = account({ passwordHash: 'legacy-invalid', isAdmin: false });
  await resetAccountPassword(recoveryDatabase(user), user.username, 'new-account-password');
  assert.ok(await verifyPassword('new-account-password', user.passwordHash));
  assert.equal(user.isAdmin, false);
  for (const value of [null, account({ isActive: false })]) {
    const db = recoveryDatabase(value);
    await assert.rejects(resetAccountPassword(db, 'test.user', 'new-account-password'), /No active account/);
    assert.equal(db.rolledBack, true);
    assert.equal(db.calls.length, 1);
    assert.deepEqual(db.sessionIds, [7, 7, 8]);
    if (value) assert.equal(value.isActive, false);
  }
});

test('session deletion failure rolls back the password update', async () => {
  const user = account();
  const oldHash = user.passwordHash;
  const db = recoveryDatabase(user, { failSessionDelete: true });
  await assert.rejects(resetAccountPassword(db, 'test.user', 'new-account-password'), /Session deletion failed/);
  assert.equal(db.rolledBack, true);
  assert.equal(db.committed, false);
  assert.equal(user.passwordHash, oldHash);
  assert.deepEqual(db.sessionIds, [7, 7, 8]);
});

test('login recovers after a reset, rejects the old password, and invalidates the previous session', async () => {
  const db = recoveryDatabase(account({ passwordHash: await hashPassword('original-password-123') }));
  const server = createApp(db, { serveClient: false }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const login = async (password) => fetch(`${url}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'test.user', password }),
  });
  try {
    const failed = await login('replacement-password-123');
    assert.equal(failed.status, 401);
    assert.equal((await failed.json()).error, 'Invalid username or password.');
    const original = await login('original-password-123');
    assert.equal(original.status, 200);
    const oldCookie = original.headers.get('set-cookie').split(';')[0];
    await resetAccountPassword(db, 'test.user', 'replacement-password-123');
    assert.equal((await fetch(`${url}/api/products`, { headers: { Cookie: oldCookie } })).status, 401);
    assert.equal((await login('original-password-123')).status, 401);
    const recovered = await login('replacement-password-123');
    assert.equal(recovered.status, 200);
    assert.equal((await recovered.json()).user.username, 'test.user');
    const newCookie = recovered.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(`${url}/api/products`, { headers: { Cookie: newCookie } })).status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('invalid recovery input is rejected before database access', async () => {
  const db = recoveryDatabase(account());
  for (const name of [undefined, '', 'x', 'not a username', 'x'.repeat(101)]) {
    await assert.rejects(checkAccount(db, name), /APP_USER_NAME/);
    await assert.rejects(resetAccountPassword(db, name, 'new-account-password'), /APP_USER_NAME/);
  }
  for (const password of [undefined, '', 'short', 'x'.repeat(257), 123]) {
    await assert.rejects(resetAccountPassword(db, 'test.user', password), /APP_USER_PASSWORD/);
  }
  assert.equal(db.calls.length, 0);
});

test('password hash format checks match verification and do not accept plaintext or malformed hashes', async () => {
  const password = 'supported-password-123';
  const hash = await hashPassword(password);
  assert.equal(validPasswordHash(hash), true);
  assert.ok(await verifyPassword(password, hash));
  for (const value of [undefined, password, 'scrypt$bad$bad', `${hash}$extra`, hash.toUpperCase(), `${hash}\n`]) {
    assert.equal(validPasswordHash(value), false);
    assert.equal(await verifyPassword(password, value), false);
  }
});

test('CLI check and reset never print passwords or hashes and clear the password environment variable', async () => {
  const user = account();
  const db = recoveryDatabase(user);
  const output = [];
  const log = (value) => output.push(value);
  const environment = { APP_USER_NAME: ' TEST.User ', SQLSERVER_HOST: 'test-server', SQLSERVER_DATABASE: 'mak_inventory' };
  assert.equal(await runUserPassword({ db, environment, log, args: ['check'] }), 0);
  assert.equal('APP_USER_PASSWORD' in environment, false);
  assert.match(output.join('\n'), /test-server/);
  assert.match(output.join('\n'), /does not verify the entered password/);
  const oldHash = user.passwordHash;
  environment.APP_USER_PASSWORD = 'replacement-password-123';
  assert.equal(await runUserPassword({ db, environment, log, args: ['reset'] }), 0);
  assert.equal('APP_USER_PASSWORD' in environment, false);
  assert.ok(await verifyPassword('replacement-password-123', user.passwordHash));
  assert.doesNotMatch(output.join('\n'), /unused-secret-password|replacement-password-123|scrypt\$/);
  assert.equal(output.join('\n').includes(oldHash), false);
  assert.equal(output.join('\n').includes(user.passwordHash), false);
  for (const args of [[], ['unknown'], ['reset', 'extra']]) {
    const env = { APP_USER_NAME: 'test.user', APP_USER_PASSWORD: 'never-log-this-password' };
    await assert.rejects(runUserPassword({ db, environment: env, log, args }), /Use npm run/);
    assert.equal('APP_USER_PASSWORD' in env, false);
  }
});
