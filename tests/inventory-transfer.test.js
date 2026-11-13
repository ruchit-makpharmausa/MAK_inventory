import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createApp } from '../server/app.js';
import { expectedColumns } from '../server/database.js';

const migration = readFileSync(new URL('../scripts/inventory-transfers.sql', import.meta.url), 'utf8');
const source = { id: 17, companyId: 7, productTypeId: 1, productType: 'Bulk', name: 'Source', itemCode: 'SRC', makItemCode: 'TRV-SRC', unit: 'Pcs', availableBalance: 10 };
const destination = { ...source, id: 18, name: 'Destination', itemCode: 'DST', makItemCode: 'TRV-DST', availableBalance: 2 };
const transferBody = { sourceProductId: 17, destinationProductId: 18, sourceMaterialLotNumber: ' A2A-LOT ', destinationMakLotNumber: ' TRV-MAK-LOT-9 ', transferDate: '2026-11-12', quantity: 4 };

function mockDatabase(responses = []) {
  const calls = [];
  const token = {};
  const db = {
    calls, token,
    async query(statement, parameters = {}, executor) {
      if (statement.includes('FROM dbo.user_sessions s JOIN dbo.app_users u')) {
        return { recordset: [{ id: 9, username: 'test.admin', displayName: 'Test Admin', isAdmin: true,
          companyId: 7, companyName: 'Quten', companyCode: 'TRV' }] };
      }
      calls.push({ statement, parameters, executor });
      assert.ok(responses.length, `Unexpected query: ${statement}`);
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return { recordset: response };
    },
    async transaction(work) { return work(token); },
  };
  return db;
}

async function withApi(db, run) {
  const server = createApp(db, { serveClient: false }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const request = async (url, body, method = body === undefined ? 'GET' : 'POST') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {
      method, headers: { Cookie: `mak_inventory_session=${'a'.repeat(64)}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  };
  try { await run(request); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('transfer schema is company-bound, auditable, immutable, and records both lot identifiers', () => {
  assert.ok(expectedColumns.inventory_transfers.includes('source_product_id'));
  assert.ok(expectedColumns.inventory_transfers.includes('destination_mak_lot_number'));
  assert.match(migration, /source_material_lot_number NVARCHAR\(255\) NULL/);
  assert.match(migration, /destination_mak_lot_number NVARCHAR\(255\) NOT NULL/);
  assert.match(migration, /FOREIGN KEY \(source_product_id, company_id\)/);
  assert.match(migration, /FOREIGN KEY \(destination_product_id, company_id\)/);
  assert.match(migration, /FOREIGN KEY \(added_by_user_id\)/);
  assert.match(migration, /CHECK \(source_product_id <> destination_product_id\)/);
  assert.match(migration, /CHECK \(quantity > 0\)/);
  assert.match(migration, /BEGIN TRY[\s\S]*BEGIN TRANSACTION[\s\S]*COMMIT TRANSACTION/);
});

test('transfer moves stock from an available source lot, saves the destination MAK lot, and records the actor', async () => {
  const db = mockDatabase([
    [{ id: 17 }], [{ id: 18 }], [source], [destination],
    [{ materialLotNumber: 'A2A-LOT', availableQuantity: 6 }, { materialLotNumber: null, availableQuantity: 4 }], [{ id: 51 }],
  ]);
  await withApi(db, async (request) => {
    const result = await request('/api/transfers', transferBody);
    assert.equal(result.status, 201, result.body.error);
    assert.deepEqual(result.body, { id: 51, sourceProductId: 17, destinationProductId: 18,
      sourceLot: 'A2A-LOT', destinationMakLotNumber: 'TRV-MAK-LOT-9' });
  });
  assert.deepEqual(db.calls.slice(0, 2).map((call) => call.parameters.productId[1]), [17, 18]);
  assert.ok(db.calls.slice(0, 2).every((call) => call.executor === db.token && /UPDLOCK, HOLDLOCK/.test(call.statement)));
  const insert = db.calls.at(-1);
  assert.match(insert.statement, /INSERT INTO dbo\.inventory_transfers/);
  assert.equal(insert.parameters.companyId[1], 7);
  assert.equal(insert.parameters.sourceProductId[1], 17);
  assert.equal(insert.parameters.destinationProductId[1], 18);
  assert.equal(insert.parameters.sourceMaterialLotNumber[1], 'A2A-LOT');
  assert.equal(insert.parameters.destinationMakLotNumber[1], 'TRV-MAK-LOT-9');
  assert.equal(insert.parameters.quantity[1], 4);
  assert.equal(insert.parameters.addedByUserId[1], 9);
});

test('unassigned source stock is selectable and transfers are constrained to source lot availability', async () => {
  const db = mockDatabase([
    [{ id: 17 }], [{ id: 18 }], [source], [destination],
    [{ materialLotNumber: null, availableQuantity: 4 }], [{ id: 52 }],
  ]);
  await withApi(db, async (request) => {
    const result = await request('/api/transfers', { ...transferBody, sourceMaterialLotNumber: null, quantity: 4 });
    assert.equal(result.status, 201, result.body.error);
    assert.equal(db.calls.at(-1).parameters.sourceMaterialLotNumber[1], null);
  });

  const insufficient = mockDatabase([
    [{ id: 17 }], [{ id: 18 }], [source], [destination], [{ materialLotNumber: 'A2A-LOT', availableQuantity: 3 }],
  ]);
  await withApi(insufficient, async (request) => {
    const result = await request('/api/transfers', transferBody);
    assert.equal(result.status, 400);
    assert.match(result.body.error, /Insufficient source lot inventory/);
    assert.equal(insufficient.calls.some((call) => call.statement.includes('INSERT INTO dbo.inventory_transfers')), false);
  });
});

test('transfer source lot lists include newly transferred-in unassigned stock', async () => {
  const db = mockDatabase([[source], [{ materialLotNumber: null, availableQuantity: 5 }]]);
  await withApi(db, async (request) => {
    const result = await request('/api/products/17/transfer-lots');
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, [{ materialLotNumber: null, availableQuantity: 5 }]);
  });
  assert.match(db.calls[1].statement, /destination_product_id = @productId/);
  assert.match(db.calls[1].statement, /CAST\(NULL AS NVARCHAR\(255\)\), quantity, CAST\(0 AS float\)/);
});

test('a product transfer history is scoped to the selected company and product', async () => {
  const transfer = { id: 51, date: '2026-11-12', quantity: 4, sourceMaterialLotNumber: 'A2A-LOT',
    destinationMakLotNumber: 'TRV-MAK-LOT-9', sourceProductId: 17, sourceProductName: 'Source', sourceItemCode: 'SRC', sourceMakItemCode: 'TRV-SRC',
    destinationProductId: 18, destinationProductName: 'Destination', destinationItemCode: 'DST', destinationMakItemCode: 'TRV-DST',
    addedBy: 'Test Admin', direction: 'out' };
  const db = mockDatabase([[source], [transfer]]);
  await withApi(db, async (request) => {
    const result = await request('/api/products/17/transfers');
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, [transfer]);
  });
  assert.equal(db.calls[1].parameters.productId[1], 17);
  assert.equal(db.calls[1].parameters.companyId[1], 7);
  assert.match(db.calls[1].statement, /source_product_id = @productId OR t\.destination_product_id = @productId/);
});

test('transfers reject invalid products, cross-company products, different units and invalid quantities', async () => {
  const noDatabase = mockDatabase();
  await withApi(noDatabase, async (request) => {
    assert.equal((await request('/api/transfers', { ...transferBody, destinationProductId: 17 })).status, 400);
    assert.equal((await request('/api/transfers', { ...transferBody, quantity: 0 })).status, 400);
    assert.equal((await request('/api/transfers', { ...transferBody, destinationMakLotNumber: '' })).status, 400);
    assert.equal(noDatabase.calls.length, 0);
  });

  const otherCompany = mockDatabase([[],]);
  await withApi(otherCompany, async (request) => {
    const result = await request('/api/transfers', transferBody);
    assert.equal(result.status, 404);
    assert.equal(otherCompany.calls.some((call) => call.statement.includes('INSERT INTO dbo.inventory_transfers')), false);
  });

  const incompatible = mockDatabase([[{ id: 17 }], [{ id: 18 }], [source], [{ ...destination, unit: 'kgs' }]]);
  await withApi(incompatible, async (request) => {
    const result = await request('/api/transfers', transferBody);
    assert.equal(result.status, 400);
    assert.match(result.body.error, /compatible units/);
    assert.equal(incompatible.calls.some((call) => call.statement.includes('INSERT INTO dbo.inventory_transfers')), false);
  });
});
