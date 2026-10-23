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
    const conflict = await request('/api/products', values);
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.error, 'That item code already exists for the selected product type.');
    assert.equal((await request('/api/products', values)).status, 400);
    assert.equal((await request('/api/products', { ...values, productTypeId: -1 })).status, 400);
    assert.equal((await request('/api/products?typeId=bad')).status, 400);
    assert.equal(db.calls.length, 3);
  });
});

test('products can reuse a name and item code across types without automatic suffixes', async () => {
  const types = ['Bulk', 'IFC', 'Label', 'Sleeve'];
  const saved = types.map((productType, index) => ({ ...product, id: 17 + index, productTypeId: index + 1, productType }));
  const db = mockDatabase([...saved.flatMap((row) => [[{ id: row.id }], [row]]), saved]);
  await withApi(db, async (request) => {
    for (const row of saved) {
      const result = await request('/api/products', { ...values, productTypeId: row.productTypeId });
      assert.equal(result.status, 201);
      assert.equal(result.body.id, row.id);
      assert.equal(result.body.productType, row.productType);
      assert.equal(result.body.name, 'Label');
      assert.equal(result.body.itemCode, 'LB-001');
      const insert = db.calls.at(-2);
      assert.equal(insert.parameters.productTypeId[1], row.productTypeId);
      assert.equal(insert.parameters.name[1], 'Label');
      assert.equal(insert.parameters.itemCode[1], 'LB-001');
    }
    const listed = await request('/api/products');
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.body.map((row) => row.id), saved.map((row) => row.id));
  });
});

test('editing can change the product type without changing its name, item code, or ID', async () => {
  const changed = { ...product, productTypeId: 3, productType: 'Bulk' };
  const db = mockDatabase([[{ matched: 1 }], [changed]]);
  await withApi(db, async (request) => {
    const result = await request('/api/products/17', { ...values, productTypeId: 3 }, 'PUT');
    assert.equal(result.status, 200);
    assert.equal(result.body.id, 17);
    assert.equal(result.body.productTypeId, 3);
    assert.equal(result.body.name, 'Label');
    assert.equal(result.body.itemCode, 'LB-001');
    assert.equal(db.calls[0].parameters.productTypeId[1], 3);
    assert.equal(db.calls[0].parameters.id[1], 17);
    assert.equal(db.calls[0].parameters.name[1], 'Label');
  });
});

test('create and edit report same-type item code conflicts from unique constraints and indexes', async () => {
  for (const number of [2601, 2627]) {
    const error = Object.assign(new Error('private-constraint-details'), { number });
    const db = mockDatabase([error, error]);
    await withApi(db, async (request) => {
      for (const [url, method] of [['/api/products', 'POST'], ['/api/products/17', 'PUT']]) {
        const result = await request(url, values, method);
        assert.equal(result.status, 409);
        assert.deepEqual(result.body, { error: 'That item code already exists for the selected product type.' });
      }
    });
  }
});

test('identical names and codes in different types keep their histories scoped to product ID', async () => {
  const other = { ...product, id: 18, productTypeId: 2, productType: 'Bulk' };
  const receipt = { id: 1, quantity: 10 };
  const otherReceipt = { id: 2, quantity: 25 };
  const db = mockDatabase([[product], [receipt], [], [other], [otherReceipt], []]);
  await withApi(db, async (request) => {
    for (const [row, expectedReceipt] of [[product, receipt], [other, otherReceipt]]) {
      const result = await request(`/api/products/${row.id}/history`);
      assert.equal(result.status, 200);
      assert.equal(result.body.product.id, row.id);
      assert.deepEqual(result.body.receiving, [expectedReceipt]);
      assert.deepEqual(result.body.usage, []);
      const calls = db.calls.slice(-3);
      assert.equal(calls[0].parameters.id[1], row.id);
      for (const call of calls.slice(1)) {
        assert.match(call.statement, /WHERE product_id = @productId/);
        assert.equal(call.parameters.productId[1], row.id);
      }
    }
  });
});

test('material lot availability is product-scoped and keeps case-distinct lot identities', async () => {
  const lots = [
    { materialLotNumber: 'LOT', availableQuantity: 6 },
    { materialLotNumber: 'lot', availableQuantity: 2.5 },
  ];
  const other = { ...product, id: 18, productTypeId: 2, productType: 'Bulk' };
  const otherLots = [{ materialLotNumber: 'LOT', availableQuantity: 23 }];
  const db = mockDatabase([[product], lots, [other], otherLots]);
  await withApi(db, async (request) => {
    assert.deepEqual(await request('/api/products/17/material-lots'), { status: 200, body: lots });
    assert.deepEqual(await request('/api/products/18/material-lots'), { status: 200, body: otherLots });
    assert.equal(db.calls.length, 4);
    for (const [index, productId] of [[0, 17], [2, 18]]) {
      assert.equal(db.calls[index].parameters.id[1], productId);
      const query = db.calls[index + 1];
      assert.equal(query.parameters.productId[1], productId);
      assert.equal(query.executor, undefined);
      assert.equal(query.parameters.lotWhitespace[1].trim(), '');
      assert.equal(query.parameters.lotWhitespace[1].length, 25);
      assert.equal((query.statement.match(/SUM\(quantity\) AS quantity/g) || []).length, 2);
      assert.equal((query.statement.match(/WHERE product_id = @productId AND material_lot_number IS NOT NULL/g) || []).length, 2);
      assert.equal((query.statement.match(/GROUP BY TRIM\(@lotWhitespace FROM material_lot_number\) COLLATE Latin1_General_100_BIN2/g) || []).length, 2);
      assert.equal((query.statement.match(/TRIM\(@lotWhitespace FROM material_lot_number\) COLLATE Latin1_General_100_BIN2 AS materialLotNumber/g) || []).length, 2);
      assert.match(query.statement, /FROM received r LEFT JOIN used u ON u\.materialLotNumber = r\.materialLotNumber/);
      assert.match(query.statement, /WHERE r\.materialLotNumber <> N'' AND r\.quantity - COALESCE\(u\.quantity, 0\) > 0/);
      assert.match(query.statement, /r\.quantity - COALESCE\(u\.quantity, 0\) AS availableQuantity/);
      assert.match(query.statement, /ORDER BY r\.materialLotNumber/);
      assert.doesNotMatch(query.statement, /FULL JOIN|RIGHT JOIN|UNION|product_type_id|item_code|INSERT|UPDATE|DELETE/i);
    }
    assert.equal(db.calls[1].statement, db.calls[3].statement);
  });
});

test('material lot availability returns an empty array for products without positive received lots and 404 for invalid or missing products', async () => {
  const db = mockDatabase([[product], [], []]);
  await withApi(db, async (request) => {
    for (const id of ['bad', '-1', '0', '1.5', '2147483648']) {
      assert.deepEqual(await request(`/api/products/${id}/material-lots`), { status: 404, body: { error: 'Product not found.' } });
    }
    assert.equal(db.calls.length, 0);
    assert.deepEqual(await request('/api/products/17/material-lots'), { status: 200, body: [] });
    assert.equal(db.calls.length, 2);
    assert.deepEqual(await request('/api/products/999/material-lots'), { status: 404, body: { error: 'Product not found.' } });
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

test('usage validates a received material lot under the product lock and preserves the independent MAK lot', async () => {
  const db = mockDatabase([[{ id: 17 }], [product], [{ materialLotNumber: 'MATERIAL-LOT', availableQuantity: 3 }], [{ id: 4 }], [{ ...product, totalUsed: 3, availableBalance: 7 }]]);
  await withApi(db, async (request) => {
    const result = await request('/api/transactions/usage', { productId: 17, usageDate: '2026-10-17', quantity: 3, materialLotNumber: ' \tMATERIAL-LOT\r\n ', makLotNumber: ' MAK-LOT ' });
    assert.equal(result.status, 201);
    assert.equal(result.body.id, 4);
    assert.equal(result.body.product.availableBalance, 7);
    assert.equal(db.calls.length, 5);
    assert.match(db.calls[0].statement, /UPDLOCK, HOLDLOCK/);
    assert.match(db.calls[2].statement, /FROM received r LEFT JOIN used u/);
    assert.equal(db.calls[2].parameters.productId[1], 17);
    assert.match(db.calls[3].statement, /INSERT INTO dbo\.usage_transactions/);
    assert.equal(db.calls[3].parameters.materialLotNumber[1], 'MATERIAL-LOT');
    assert.equal(db.calls[3].parameters.makLotNumber[1], 'MAK-LOT');
    assert.ok(db.calls.every((call) => call.executor === db.token));
  });
});

test('usage rejects unknown, exhausted, orphaned, other-product and differently cased material lots without inserting', async () => {
  for (const materialLotNumber of ['UNKNOWN', 'EXHAUSTED', 'ORPHAN', 'OTHER-PRODUCT', 'lot']) {
    const availableLots = ['EXHAUSTED', 'ORPHAN'].includes(materialLotNumber) ? [] : [{ materialLotNumber: 'LOT', availableQuantity: 10 }];
    const db = mockDatabase([[{ id: 17 }], [product], availableLots]);
    await withApi(db, async (request) => {
      const result = await request('/api/transactions/usage', { productId: 17, usageDate: '2026-10-17', quantity: 1, materialLotNumber, makLotNumber: 'MAK-LOT' });
      assert.deepEqual(result, { status: 400, body: { error: 'Select a material lot with available stock for this product, or select N/A.' } });
      assert.equal(db.calls.length, 3);
      assert.equal(db.calls[2].parameters.productId[1], 17);
      assert.ok(db.calls.every((call) => call.executor === db.token));
      assert.ok(db.calls.every((call) => !/INSERT INTO dbo\.usage_transactions/.test(call.statement)));
    });
  }
});

test('usage rejects quantities above the selected lot balance even when total product stock is sufficient', async () => {
  const db = mockDatabase([[{ id: 17 }], [product], [{ materialLotNumber: 'LOT', availableQuantity: 2.5 }]]);
  await withApi(db, async (request) => {
    const result = await request('/api/transactions/usage', { productId: 17, usageDate: '2026-10-17', quantity: 3, materialLotNumber: ' LOT ', makLotNumber: 'MAK-LOT' });
    assert.deepEqual(result, { status: 400, body: { error: 'Insufficient material lot inventory. Available for LOT: 2.5 Pcs.' } });
    assert.equal(db.calls.length, 3);
    assert.ok(db.calls.every((call) => call.executor === db.token));
    assert.ok(db.calls.every((call) => !/INSERT INTO dbo\.usage_transactions/.test(call.statement)));
  });
});

test('availability listing and usage validation reuse the same lot query', async () => {
  const lots = [{ materialLotNumber: 'LOT', availableQuantity: 10 }];
  const db = mockDatabase([[product], lots, [{ id: 17 }], [product], lots, [{ id: 4 }], [{ ...product, availableBalance: 9 }]]);
  await withApi(db, async (request) => {
    assert.equal((await request('/api/products/17/material-lots')).status, 200);
    assert.equal((await request('/api/transactions/usage', { productId: 17, usageDate: '2026-10-17', quantity: 1, materialLotNumber: 'LOT', makLotNumber: 'MAK-LOT' })).status, 201);
    assert.equal(db.calls[1].statement, db.calls[4].statement);
    assert.deepEqual(db.calls[1].parameters, db.calls[4].parameters);
    assert.equal(db.calls[1].executor, undefined);
    assert.equal(db.calls[4].executor, db.token);
  });
});

test('usage holds the transaction executor across the lock, availability reads and asynchronous insert', async () => {
  const db = mockDatabase([[{ id: 17 }], [product], [{ materialLotNumber: 'LOT', availableQuantity: 10 }], [{ id: 4 }], [{ ...product, availableBalance: 9 }]]);
  let transactionActive = false;
  const query = db.query.bind(db);
  db.transaction = async (work) => {
    transactionActive = true;
    try { return await work(db.token); }
    finally { transactionActive = false; }
  };
  db.query = async (statement, parameters, executor) => {
    if (statement.includes('FROM dbo.user_sessions s JOIN dbo.app_users u')) return query(statement, parameters, executor);
    assert.equal(transactionActive, true);
    assert.equal(executor, db.token);
    if (statement.includes('INSERT INTO dbo.usage_transactions')) {
      assert.equal(db.calls.length, 3);
      assert.match(db.calls[0].statement, /UPDLOCK, HOLDLOCK/);
      assert.match(db.calls[2].statement, /FROM received r LEFT JOIN used u/);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(transactionActive, true);
    }
    return query(statement, parameters, executor);
  };
  await withApi(db, async (request) => {
    assert.equal((await request('/api/transactions/usage', { productId: 17, usageDate: '2026-10-17', quantity: 1, materialLotNumber: 'LOT', makLotNumber: 'MAK-LOT' })).status, 201);
    assert.equal(transactionActive, false);
    assert.equal(db.calls.length, 5);
    assert.ok(db.calls.every((call) => call.executor === db.token));
  });
});

test('usage material lot stays optional but supplied lots must be text and MAK lot is required', async () => {
  const db = mockDatabase();
  await withApi(db, async (request) => {
    for (const materialLotNumber of [42, {}, []]) {
      const result = await request('/api/transactions/usage', { productId: 17, usageDate: '2026-10-17', quantity: 3, materialLotNumber, makLotNumber: 'MAK-LOT' });
      assert.equal(result.status, 400);
      assert.equal(result.body.error, 'Material lot number and remarks must be text.');
    }
    const values = { productId: 17, usageDate: '2026-10-17', quantity: 3, materialLotNumber: 'LOT', makLotNumber: 'MAK-LOT' };
    const missingMakLot = await request('/api/transactions/usage', { ...values, makLotNumber: '' });
    assert.equal(missingMakLot.status, 400);
    assert.equal(missingMakLot.body.error, 'MAK lot number is required.');
    const tooLong = await request('/api/transactions/usage', { ...values, materialLotNumber: 'X'.repeat(256) });
    assert.equal(tooLong.status, 400);
    assert.equal(tooLong.body.error, 'Lot numbers must be 255 characters or fewer.');
    assert.equal(db.calls.length, 0);
  });
});

test('insufficient product stock prevents usage regardless of the entered material lot', async () => {
  const db = mockDatabase([[{ id: 17 }], [{ ...product, availableBalance: 2 }]]);
  await withApi(db, async (request) => {
    const result = await request('/api/transactions/usage', { productId: 17, usageDate: '2026-10-17', quantity: 3, materialLotNumber: 'NEW-MATERIAL-LOT', makLotNumber: 'MAK-LOT' });
    assert.equal(result.status, 400);
    assert.equal(result.body.error, 'Insufficient inventory. Available: 2 Pcs.');
    assert.equal(db.calls.length, 2);
    assert.ok(db.calls.every((call) => call.executor === db.token));
    assert.ok(db.calls.every((call) => !/INSERT INTO dbo\.usage_transactions/.test(call.statement)));
  });
});

test('receiving and usage accept omitted, null, blank and whitespace-only optional material lots', async () => {
  for (const kind of ['receiving', 'usage']) {
    for (const materialLotNumber of [undefined, null, '', ' \t\r\n ', '\u00a0\u2000\u2028\ufeff']) {
      const db = mockDatabase(kind === 'receiving' ? [[{ id: 17 }], [{ id: 3 }]]
        : [[{ id: 17 }], [product], [{ id: 3 }], [{ ...product, availableBalance: 5 }]]);
      await withApi(db, async (request) => {
        const result = await request(`/api/transactions/${kind}`, {
          productId: 17, [`${kind === 'receiving' ? 'receiving' : 'usage'}Date`]: '2026-10-17', quantity: 5,
          materialLotNumber, ...(kind === 'usage' ? { makLotNumber: 'MAK-LOT' } : { makReleaseNumber: materialLotNumber }),
        });
        assert.equal(result.status, 201);
        const insert = db.calls.find((call) => /INSERT INTO dbo\.(receiving|usage)_transactions/.test(call.statement));
        assert.equal(insert.parameters.materialLotNumber[1], null);
        if (kind === 'receiving') assert.equal(insert.parameters.makReleaseNumber[1], null);
        else assert.equal(insert.parameters.makLotNumber[1], 'MAK-LOT');
        assert.equal(db.calls.length, kind === 'receiving' ? 2 : 4);
        assert.ok(db.calls.every((call) => !call.statement.includes('FROM received r LEFT JOIN used u')));
      });
    }
  }
});

test('N/A material lots bypass only lot validation and still reject usage above product stock', async () => {
  for (const materialLotNumber of [undefined, null, '', ' \t\r\n ']) {
    const db = mockDatabase([[{ id: 17 }], [{ ...product, availableBalance: 2 }]]);
    await withApi(db, async (request) => {
      const result = await request('/api/transactions/usage', { productId: 17, usageDate: '2026-10-17', quantity: 3, materialLotNumber, makLotNumber: 'MAK-LOT' });
      assert.deepEqual(result, { status: 400, body: { error: 'Insufficient inventory. Available: 2 Pcs.' } });
      assert.equal(db.calls.length, 2);
      assert.ok(db.calls.every((call) => call.executor === db.token));
    });
  }
});

test('receiving and usage reject missing products under the lock without checking lots or inserting', async () => {
  for (const kind of ['receiving', 'usage']) {
    const db = mockDatabase([[]]);
    await withApi(db, async (request) => {
      const result = await request(`/api/transactions/${kind}`, {
        productId: 17, [`${kind}Date`]: '2026-10-17', quantity: 1, materialLotNumber: 'LOT', makLotNumber: 'MAK-LOT',
      });
      assert.deepEqual(result, { status: 404, body: { error: 'Product not found.' } });
      assert.equal(db.calls.length, 1);
      assert.match(db.calls[0].statement, /UPDLOCK, HOLDLOCK/);
      assert.equal(db.calls[0].executor, db.token);
    });
  }
});

test('receiving persists independent MAK Release Number and material lot values and returns them in reads', async () => {
  const receipt = { id: 3, makReleaseNumber: 'RN-001', materialLotNumber: 'MAT-001' };
  const db = mockDatabase([[{ id: 17 }], [{ id: 3 }], [receipt], [product], [receipt], []]);
  await withApi(db, async (request) => {
    const created = await request('/api/transactions/receiving', {
      productId: 17, receivingDate: '2026-10-17', quantity: 5, makReleaseNumber: ' RN-001 ', materialLotNumber: ' MAT-001 ',
    });
    assert.equal(created.status, 201);
    assert.equal(db.calls[1].parameters.makReleaseNumber[1], 'RN-001');
    assert.equal(db.calls[1].parameters.materialLotNumber[1], 'MAT-001');
    assert.match(db.calls[1].statement, /@materialLotNumber, @makReleaseNumber/);
    const recent = await request('/api/transactions/receiving');
    assert.deepEqual(recent.body, [receipt]);
    assert.match(db.calls[2].statement, /t\.mak_release_number AS makReleaseNumber/);
    const history = await request('/api/products/17/history');
    assert.deepEqual(history.body.receiving, [receipt]);
    assert.match(db.calls[4].statement, /mak_release_number AS makReleaseNumber/);
  });
});

test('cached receiving forms keep their release reference without returning the old API field', async () => {
  const db = mockDatabase([[{ id: 17 }], [{ id: 3 }], [{ id: 17 }], [{ id: 4 }]]);
  await withApi(db, async (request) => {
    const values = { productId: 17, receivingDate: '2026-10-17', quantity: 5, makRnNumber: ' RN-CACHED ' };
    const cached = await request('/api/transactions/receiving', values);
    assert.equal(cached.status, 201);
    assert.equal(cached.body.makReleaseNumber, 'RN-CACHED');
    assert.ok(!Object.hasOwn(cached.body, 'makRnNumber'));
    assert.equal(db.calls[1].parameters.makReleaseNumber[1], 'RN-CACHED');
    assert.match(db.calls[1].statement, /mak_release_number/);
    assert.doesNotMatch(db.calls[1].statement, /mak_rn_number/);
    const current = await request('/api/transactions/receiving', { ...values, makReleaseNumber: ' RELEASE-CURRENT ' });
    assert.equal(current.status, 201);
    assert.equal(current.body.makReleaseNumber, 'RELEASE-CURRENT');
    assert.equal(db.calls[3].parameters.makReleaseNumber[1], 'RELEASE-CURRENT');
  });
});

test('invalid transactions are rejected before reaching the database', async () => {
  const db = mockDatabase();
  await withApi(db, async (request) => {
    const values = { productId: 17, receivingDate: '2026-10-17', quantity: 3 };
    assert.equal((await request('/api/transactions/receiving', { ...values, receivingDate: '2026-02-30' })).status, 400);
    assert.equal((await request('/api/transactions/receiving', { ...values, quantity: 0 })).status, 400);
    assert.equal((await request('/api/transactions/receiving', { ...values, materialLotNumber: {} })).status, 400);
    assert.equal((await request('/api/transactions/receiving', { ...values, makReleaseNumber: {} })).status, 400);
    assert.equal((await request('/api/transactions/receiving', { ...values, makReleaseNumber: 'X'.repeat(256) })).status, 400);
    assert.equal((await request('/api/transactions/unknown')).status, 404);
    assert.equal(db.calls.length, 0);
  });
});

test('type history export groups all product ledgers by ID using four type-scoped queries', async () => {
  const type = { id: 7, name: 'New packaging type' };
  const first = { ...product, id: 17, productTypeId: 7, productType: type.name };
  const second = { ...first, id: 18 };
  const empty = { ...first, id: 19 };
  const receipt = { id: 1, productId: 17, date: '2026-10-17', quantity: 10, makReleaseNumber: '000REL' };
  const otherReceipt = { ...receipt, id: 2, productId: 18, quantity: 25 };
  const usage = { id: 3, productId: 17, date: '2026-10-18', quantity: 4, makLotNumber: 'M123' };
  const db = mockDatabase([[type], [first, second, empty], [receipt, otherReceipt], [usage]]);
  await withApi(db, async (request) => {
    const result = await request('/api/product-types/7/history');
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { type, histories: [
      { product: first, receiving: [receipt], usage: [usage] },
      { product: second, receiving: [otherReceipt], usage: [] },
      { product: empty, receiving: [], usage: [] },
    ] });
    assert.equal(db.calls.length, 4);
    for (const call of db.calls) assert.equal(call.parameters.typeId[1], 7);
    for (const call of db.calls.slice(1)) assert.match(call.statement, /WHERE p\.product_type_id = @typeId/);
    assert.match(db.calls[2].statement, /mak_release_number AS makReleaseNumber/);
    assert.match(db.calls[3].statement, /mak_lot_number AS makLotNumber/);
    assert.ok(db.calls.every((call) => !/\b(INSERT|UPDATE|DELETE|ALTER|DROP)\b/.test(call.statement)));
  });
});

test('type history export supports empty registered types and rejects invalid or missing types', async () => {
  const db = mockDatabase([[{ id: 9, name: 'Empty type' }], [], []]);
  await withApi(db, async (request) => {
    for (const id of ['bad', '-1', '0', '2147483648']) assert.equal((await request(`/api/product-types/${id}/history`)).status, 404);
    assert.equal(db.calls.length, 0);
    const empty = await request('/api/product-types/9/history');
    assert.deepEqual(empty, { status: 200, body: { type: { id: 9, name: 'Empty type' }, histories: [] } });
    assert.equal(db.calls.length, 2);
    const missing = await request('/api/product-types/100/history');
    assert.deepEqual(missing, { status: 404, body: { error: 'Product type not found.' } });
  });
});

test('type history query count stays constant for a large product catalog and failures return no partial report', async () => {
  const catalog = Array.from({ length: 200 }, (_, index) => ({ ...product, id: index + 1 }));
  const timeout = Object.assign(new Error('private-query-details'), { name: 'RequestError', code: 'ETIMEOUT' });
  const db = mockDatabase([[{ id: 1, name: 'Label' }], catalog, [], [], [{ id: 1, name: 'Label' }], catalog, timeout]);
  await withApi(db, async (request) => {
    const result = await request('/api/product-types/1/history');
    assert.equal(result.status, 200);
    assert.equal(result.body.histories.length, 200);
    assert.equal(db.calls.length, 4);
    const failed = await request('/api/product-types/1/history');
    assert.equal(failed.status, 503);
    assert.ok(!Object.hasOwn(failed.body, 'histories'));
    assert.doesNotMatch(failed.body.error, /private-query-details/);
  });
});

test('type history export and material lot availability require authentication', async () => {
  const db = mockDatabase();
  const server = createApp(db, { serveClient: false }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    for (const route of ['/api/product-types/1/history', '/api/products/17/material-lots']) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`);
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: 'Please sign in to continue.' });
      assert.equal(db.calls.length, 0);
    }
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('health executes a zero-row inventory read instead of trusting a cached connection', async () => {
  const db = mockDatabase([[]]);
  await withApi(db, async (request) => {
    const result = await request('/api/health');
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { status: 'ok', database: 'sqlserver' });
    assert.equal(db.calls.length, 1);
    assert.match(db.calls[0].statement, /SELECT TOP \(0\) id FROM dbo\.products/);
  });
});

test('query timeouts return an actionable 503 for health, login and inventory without leaking details', async () => {
  const error = Object.assign(new Error('private-connection-query-details'), { name: 'RequestError', code: 'ETIMEOUT' });
  const db = mockDatabase([error, error, error]);
  await withApi(db, async (request) => {
    const results = [
      await request('/api/health'),
      await request('/api/auth/login', { username: 'test.user', password: 'unused-test-password' }),
      await request('/api/products'),
    ];
    for (const result of results) {
      assert.equal(result.status, 503);
      assert.match(result.body.error, /accepted the connection.*query timed out/);
      assert.doesNotMatch(result.body.error, /private-connection-query-details/);
    }
    assert.equal(db.calls.length, 3);
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
