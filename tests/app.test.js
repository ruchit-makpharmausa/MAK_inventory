import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../server/app.js';

const product = { id: 17, productTypeId: 1, productType: 'Label', name: 'Label', itemCode: 'LB-001', makItemCode: 'MAK-001', unit: 'Pcs', comment: 'Saved comment', totalReceived: 10, totalUsed: 0, availableBalance: 10 };
const values = { productTypeId: 1, name: ' Label ', itemCode: ' LB-001 ', makItemCode: ' MAK-001 ', unit: 'Pcs', comment: ' Saved comment ' };

function mockDatabase(responses = []) {
  const calls = [];
  const token = {};
  return {
    calls, token,
    async query(statement, parameters = {}, executor) {
      if (statement.includes('FROM dbo.user_sessions s JOIN dbo.app_users u')) {
        return { recordset: [{ id: 1, username: 'test.user', displayName: 'Test User' }] };
      }
      calls.push({ statement, parameters, executor });
      assert.ok(responses.length > 0, `Unexpected query: ${statement}`);
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return { recordset: response };
    },
    async transaction(work) { return work(token); },
    async getPool() { return {}; },
  };
}

async function withApi(db, run) {
  const server = createApp(db, { serveClient: false }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const request = async (url, body, method = body === undefined ? 'GET' : 'POST') => {
    const options = { method, headers: { Cookie: `mak_inventory_session=${'a'.repeat(64)}` } };
    if (body !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    const response = await fetch(`http://127.0.0.1:${server.address().port}${url}`, options);
    return { status: response.status, body: await response.json() };
  };
  try { await run(request); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('product save and edit preserve both item codes and comments', async () => {
  const db = mockDatabase([[{ id: 17 }], [product], [{ matched: 1 }], [product]]);
  await withApi(db, async (request) => {
    const created = await request('/api/products', values);
    assert.equal(created.status, 201);
    assert.equal(created.body.makItemCode, 'MAK-001');
    assert.equal(db.calls[0].parameters.comment[1], 'Saved comment');
    assert.equal(db.calls[0].parameters.productTypeId[1], 1);
    const edited = await request('/api/products/17', values, 'PUT');
    assert.equal(edited.status, 200);
    assert.equal(edited.body.comment, 'Saved comment');
    assert.equal(db.calls[2].parameters.id[1], 17);
  });
});

test('search is parameterized and duplicates and foreign keys retain validation messages', async () => {
  const duplicate = Object.assign(new Error('duplicate'), { number: 2627 });
  const foreign = Object.assign(new Error('foreign key'), { number: 547 });
  const db = mockDatabase([[product], duplicate, foreign]);
  await withApi(db, async (request) => {
    const search = "' OR 1=1 --";
    assert.equal((await request(`/api/products?search=${encodeURIComponent(search)}`)).status, 200);
    assert.equal(db.calls[0].parameters.search[1], search);
    assert.ok(!db.calls[0].statement.includes(search));
    assert.equal((await request('/api/products', values)).status, 409);
    assert.equal((await request('/api/products', values)).status, 400);
    assert.equal((await request('/api/products', { ...values, productTypeId: -1 })).status, 400);
    assert.equal((await request('/api/products?typeId=bad')).status, 400);
    assert.equal(db.calls.length, 3);
  });
});

test('receiving locks the product and inserts the record in the same transaction', async () => {
  const db = mockDatabase([[{ id: 17 }], [{ id: 3 }]]);
  await withApi(db, async (request) => {
    const result = await request('/api/transactions/receiving', { productId: 17, receivingDate: '2026-10-17', quantity: 5, materialLotNumber: 'LOT' });
    assert.equal(result.status, 201);
    assert.equal(result.body.id, 3);
    assert.match(db.calls[0].statement, /UPDLOCK, HOLDLOCK/);
    assert.ok(db.calls.every((call) => call.executor === db.token));
    assert.equal(db.calls[1].parameters.date[1].toISOString(), '2026-10-17T00:00:00.000Z');
  });
});

test('usage respects product and lot balances and keeps the product lock through the write', async () => {
  const db = mockDatabase([[{ id: 17 }], [product], [{ tracked: 1 }], [{ available: 5 }], [{ id: 4 }], [{ ...product, totalUsed: 3, availableBalance: 7 }]]);
  await withApi(db, async (request) => {
    const result = await request('/api/transactions/usage', { productId: 17, usageDate: '2026-10-17', quantity: 3, materialLotNumber: 'LOT', makLotNumber: 'MAK-LOT' });
    assert.equal(result.status, 201);
    assert.equal(result.body.product.availableBalance, 7);
    assert.match(db.calls[0].statement, /UPDLOCK, HOLDLOCK/);
    assert.match(db.calls[3].statement, /Latin1_General_100_BIN2/);
    assert.ok(db.calls.every((call) => call.executor === db.token));
  });
});

test('insufficient stock or a missing lot prevents usage insertion', async () => {
  for (const [currentProduct, lot, responses] of [
    [product, '', [[{ id: 17 }], [product], [{ tracked: 1 }]]],
    [{ ...product, availableBalance: 2 }, 'LOT', [[{ id: 17 }], [{ ...product, availableBalance: 2 }], [{ tracked: 1 }], [{ available: 5 }]]],
    [product, 'LOT', [[{ id: 17 }], [product], [{ tracked: 1 }], [{ available: 1 }]]],
  ]) {
    const db = mockDatabase(responses);
    await withApi(db, async (request) => {
      const result = await request('/api/transactions/usage', { productId: currentProduct.id, usageDate: '2026-10-17', quantity: 3, materialLotNumber: lot, makLotNumber: 'MAK-LOT' });
      assert.equal(result.status, 400);
      assert.ok(db.calls.every((call) => !/INSERT INTO dbo\.usage_transactions/.test(call.statement)));
    });
  }
});

test('invalid transactions are rejected before reaching the database', async () => {
  const db = mockDatabase();
  await withApi(db, async (request) => {
    const values = { productId: 17, receivingDate: '2026-10-17', quantity: 3 };
    assert.equal((await request('/api/transactions/receiving', { ...values, receivingDate: '2026-02-30' })).status, 400);
    assert.equal((await request('/api/transactions/receiving', { ...values, quantity: 0 })).status, 400);
    assert.equal((await request('/api/transactions/receiving', { ...values, materialLotNumber: {} })).status, 400);
    assert.equal((await request('/api/transactions/unknown')).status, 404);
    assert.equal(db.calls.length, 0);
  });
});

test('an unavailable SQL Server returns 503 without a local-database fallback', async () => {
  const error = Object.assign(new Error('SQL Server certificate verification failed.'), { status: 503 });
  const db = mockDatabase();
  db.getPool = async () => { throw error; };
  await withApi(db, async (request) => {
    const result = await request('/api/health');
    assert.equal(result.status, 503);
    assert.deepEqual(result.body, { error: error.message });
    assert.equal(db.calls.length, 0);
  });
});
