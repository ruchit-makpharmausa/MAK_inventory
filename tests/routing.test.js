import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../server/app.js';
import { loginDestination, navigation } from '../src/lib/routes.js';

const pagePaths = ['/dashboard', '/products', '/receiving', '/usage', '/inv_history', '/lot-inventory', '/admin'];

test('workspace navigation defines distinct page URLs', () => {
  assert.deepEqual(navigation.map((item) => item.path), pagePaths);
  assert.equal(new Set(navigation.map((item) => item.path)).size, navigation.length);
  assert.equal(navigation.find((item) => item.path === '/admin').adminOnly, true);
});

test('post-login destinations preserve allowed pages, product history selection, and authorization', () => {
  for (const pathname of pagePaths.filter((value) => value !== '/admin')) assert.equal(loginDestination(pathname), pathname);
  assert.equal(loginDestination('/inv_history?productId=17#receiving'), '/inv_history?productId=17#receiving');
  assert.equal(loginDestination('/history?productId=17'), '/inv_history?productId=17');
  assert.equal(loginDestination('/lot-inventory?productId=17&lot=000LOT'), '/lot-inventory?productId=17&lot=000LOT');
  assert.equal(loginDestination('/products/'), '/products');
  assert.equal(loginDestination('/admin', true), '/admin');
  assert.equal(loginDestination('/admin', false), '/dashboard');
});

test('login redirects never send the browser to an external or unsupported destination', () => {
  for (const destination of [undefined, null, 123, '/', '/login', '/unknown', '/api/users',
    'https://example.invalid/products', '//example.invalid/products', '/\\example.invalid/products',
    '/products/../../login', 'javascript:alert(1)']) {
    assert.equal(loginDestination(destination, true), '/dashboard');
  }
});

test('production deep links serve the SPA while API authorization and errors remain separate', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'mak-routing-'));
  const html = '<!doctype html><html><body><div id="root">Inventory app</div></body></html>';
  await writeFile(path.join(directory, 'index.html'), html);
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const app = createApp({
    async query() { return { recordset: [{ id: 1, username: 'test.user', displayName: 'Test User', isAdmin: false }] }; },
  }, { clientDirectory: directory });
  if (previous === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previous;
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const pathname of ['/', '/login', ...pagePaths, '/inv_history?productId=17', '/history', '/unknown']) {
      const response = await fetch(`${base}${pathname}`);
      assert.equal(response.status, 200, pathname);
      assert.match(response.headers.get('content-type'), /text\/html/);
      assert.equal(await response.text(), html);
    }
    const anonymous = await fetch(`${base}/api/users`);
    assert.equal(anonymous.status, 401);
    assert.match(anonymous.headers.get('content-type'), /application\/json/);
    const missingApi = await fetch(`${base}/api/not-a-page`, { headers: { Cookie: `mak_inventory_session=${'a'.repeat(64)}` } });
    assert.equal(missingApi.status, 404);
    assert.deepEqual(await missingApi.json(), { error: 'API endpoint not found.' });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
