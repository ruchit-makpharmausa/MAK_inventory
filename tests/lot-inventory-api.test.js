import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import sql from 'mssql';
import { connectionFailure } from '../server/database.js';
import { mountLotInventory } from '../server/lot-inventory.js';

const lotWhitespace = '\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';
const normalizedLot = "NULLIF(TRIM(@lotWhitespace COLLATE Latin1_General_100_BIN2 FROM material_lot_number COLLATE Latin1_General_100_BIN2) COLLATE Latin1_General_100_BIN2, N'' COLLATE Latin1_General_100_BIN2)";
const product = { id: 17, name: 'Shared product', itemCode: 'CODE', makItemCode: 'MAK-CODE', productTypeId: 1, productType: 'Label', unit: 'Pcs' };
const otherProduct = { ...product, id: 18, productTypeId: 2, productType: 'Bulk' };
const receipt = { id: 3, date: '2026-01-01', quantity: 4.5, materialLotNumber: 'LOT', makReleaseNumber: 'RELEASE', remarks: 'Received' };
const usage = { id: 8, date: '2026-01-02', quantity: 2.25, materialLotNumber: 'LOT', makLotNumber: 'MAK-LOT', remarks: 'Used' };

function mockDatabase(responses = []) {
  const calls = [];
  return {
    calls,
    async query(statement, parameters = {}, executor) {
      calls.push({ statement, parameters, executor });
      assert.ok(responses.length, `Unexpected query: ${statement}`);
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return { recordset: response };
    },
  };
}

async function withApi(db, run) {
  const app = express();
  app.use('/api', (req, res, next) => {
    if (req.get('x-test-user') !== 'regular') return res.status(401).json({ error: 'Please sign in to continue.' });
    req.user = { id: 1, isAdmin: false };
    next();
  });
  mountLotInventory(app, db);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found.' }));
  const forwarded = [];
  app.use((error, _req, res, _next) => {
    forwarded.push(error);
    if (error.status === 503) return res.status(503).json({ error: error.message });
    if (error.code === 'ETIMEOUT') return res.status(503).json({ error: connectionFailure(error).message });
    if ([2628, 8152].includes(error.number)) {
      return res.status(400).json({ error: 'A value exceeds the configured database field length.' });
    }
    return res.status(500).json({ error: 'An unexpected server error occurred.' });
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const request = async (url, { anonymous = false, method = 'GET' } = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {
      method, headers: anonymous ? {} : { 'x-test-user': 'regular' },
    });
    return { status: response.status, body: await response.json() };
  };
  try { await run(request, forwarded); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

function assertReadOnly(calls) {
  for (const { statement, executor } of calls) {
    assert.match(statement.trim(), /^(?:WITH|SELECT)\b/i);
    assert.doesNotMatch(statement, /\b(?:INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|EXEC|INTO|UPDLOCK|HOLDLOCK)\b/i);
    assert.equal(executor, undefined);
  }
}

function assertWhitespaceInput(call) {
  assert.equal(call.parameters.lotWhitespace[1], lotWhitespace);
  assert.equal(call.parameters.lotWhitespace[0].type, sql.NVarChar);
  assert.equal(call.parameters.lotWhitespace[0].length, 25);
  assert.equal(lotWhitespace.trim(), '');
}

function inventoryRow(rowProduct, materialLotNumber, totalReceived, totalUsed, productBalance) {
  const { id: productId, name: productName, ...details } = rowProduct;
  return { productId, productName, ...details, materialLotNumber, totalReceived, totalUsed,
    availableBalance: totalReceived - totalUsed, productBalance };
}

test('summary and history inherit parent authentication, allowing regular users but no anonymous reads', async () => {
  const db = mockDatabase([[], [product], [receipt], []]);
  await withApi(db, async (request) => {
    for (const url of ['/api/lot-inventory', '/api/lot-inventory/17/history?lot=LOT', '/api/lot-inventory/17/history?unassigned=1']) {
      assert.deepEqual(await request(url, { anonymous: true }), { status: 401, body: { error: 'Please sign in to continue.' } });
    }
    assert.equal(db.calls.length, 0);
    assert.deepEqual(await request('/api/lot-inventory'), { status: 200, body: [] });
    assert.equal((await request('/api/lot-inventory/17/history?lot=LOT')).status, 200);
    assert.equal(db.calls.length, 4);
  });
});

test('summary preserves received, exhausted, negative, usage-only, case-distinct, literal N/A and unassigned buckets', async () => {
  const rows = [
    inventoryRow(product, null, 10, 1, 8.5),
    inventoryRow(product, 'EXHAUSTED', 3, 3, 8.5),
    inventoryRow(product, 'LOT', 4.5, 2.25, 8.5),
    inventoryRow(product, 'N/A', 2, 0, 8.5),
    inventoryRow(product, 'ORPHAN', 0, 4, 8.5),
    inventoryRow(product, 'lot', 0.5, 1.25, 8.5),
    inventoryRow(otherProduct, 'LOT', 30, 1, 27),
    inventoryRow(otherProduct, 'ORPHAN', 0, 2, 27),
  ];
  const db = mockDatabase([rows]);
  await withApi(db, async (request) => {
    assert.deepEqual(await request('/api/lot-inventory'), { status: 200, body: rows });
    assert.equal(db.calls.length, 1);
    for (const id of [17, 18]) {
      const buckets = rows.filter((row) => row.productId === id);
      const net = buckets.reduce((sum, row) => sum + row.availableBalance, 0);
      assert.ok(buckets.every((row) => row.productBalance === net));
      assert.equal(net, buckets.reduce((sum, row) => sum + row.totalReceived - row.totalUsed, 0));
    }
    assert.notEqual(rows[0].materialLotNumber, rows[3].materialLotNumber);
    assert.ok(rows.some((row) => row.availableBalance === 0));
    assert.ok(rows.some((row) => row.availableBalance < 0));
  });
});

test('summary uses one SQL union-all aggregate with binary normalized product/lot grouping and window-derived balances', async () => {
  const db = mockDatabase([[]]);
  await withApi(db, async (request) => {
    assert.deepEqual(await request('/api/lot-inventory'), { status: 200, body: [] });
  });
  assert.equal(db.calls.length, 1);
  const call = db.calls[0];
  assertWhitespaceInput(call);
  assert.deepEqual(Object.keys(call.parameters), ['lotWhitespace']);
  const { statement } = call;
  assert.equal(statement.split(normalizedLot).length - 1, 2);
  assert.equal((statement.match(/UNION ALL/g) || []).length, 1);
  assert.match(statement, /quantity AS received, CAST\(0 AS float\) AS used\s+FROM dbo\.receiving_transactions/);
  assert.match(statement, /CAST\(0 AS float\) AS received, quantity AS used\s+FROM dbo\.usage_transactions/);
  assert.match(statement, /GROUP BY productId, materialLotNumber COLLATE Latin1_General_100_BIN2/);
  assert.match(statement, /SUM\(received\) AS totalReceived, SUM\(used\) AS totalUsed/);
  assert.match(statement, /b\.totalReceived - b\.totalUsed AS availableBalance/);
  assert.match(statement, /SUM\(b\.totalReceived - b\.totalUsed\) OVER \(PARTITION BY b\.productId\) AS productBalance/);
  assert.match(statement, /JOIN dbo\.products p ON p\.id = b\.productId/);
  assert.match(statement, /JOIN dbo\.product_types pt ON pt\.id = p\.product_type_id/);
  assert.match(statement, /ORDER BY p\.id, b\.materialLotNumber COLLATE Latin1_General_100_BIN2/);
  assert.doesNotMatch(statement, /\b(?:WHERE|HAVING|DISTINCT)\b|[<>]|N\/A|COALESCE\([^)]*materialLotNumber/i);
  assertReadOnly(db.calls);
});

test('history is scoped to exact product ID and normalized case-sensitive lot, preserving transaction fields and stable chronological order', async () => {
  const receipts = [receipt, { ...receipt, id: 4 }, { ...receipt, id: 1, date: '2026-02-01' }];
  const usages = [usage, { ...usage, id: 9, quantity: 1 }];
  const db = mockDatabase([[product], receipts, usages, [otherProduct], [], [{ ...usage, id: 10 }]]);
  await withApi(db, async (request) => {
    assert.deepEqual(await request('/api/lot-inventory/17/history?lot=LOT'), {
      status: 200, body: { product, materialLotNumber: 'LOT', receiving: receipts, usage: usages },
    });
    assert.deepEqual(await request('/api/lot-inventory/18/history?lot=LOT'), {
      status: 200, body: { product: otherProduct, materialLotNumber: 'LOT', receiving: [], usage: [{ ...usage, id: 10 }] },
    });
  });
  for (const [start, id] of [[0, 17], [3, 18]]) {
    const [selectedProduct, receiving, used] = db.calls.slice(start, start + 3);
    assert.match(selectedProduct.statement, /WHERE p\.id = @productId/);
    assert.equal(selectedProduct.parameters.productId[0], sql.Int);
    assert.equal(selectedProduct.parameters.productId[1], id);
    for (const call of [receiving, used]) {
      assert.equal(call.parameters.productId[1], id);
      assert.equal(call.parameters.materialLotNumber[1], 'LOT');
      assertWhitespaceInput(call);
      assert.ok(call.statement.includes(`WHERE product_id = @productId AND ${normalizedLot} = @materialLotNumber COLLATE Latin1_General_100_BIN2`));
      assert.ok(call.statement.includes(`${normalizedLot} AS materialLotNumber`));
      assert.doesNotMatch(call.statement, /\bOR\b|LIKE|LOWER|UPPER|TOP\b|OFFSET|FETCH/i);
    }
    assert.match(receiving.statement, /CONVERT\(char\(10\), receiving_date, 23\) AS \[date\]/);
    assert.match(receiving.statement, /mak_release_number AS makReleaseNumber, remarks/);
    assert.match(receiving.statement, /ORDER BY receiving_date ASC, id ASC/);
    assert.match(used.statement, /CONVERT\(char\(10\), usage_date, 23\) AS \[date\]/);
    assert.match(used.statement, /mak_lot_number AS makLotNumber, remarks/);
    assert.match(used.statement, /ORDER BY usage_date ASC, id ASC/);
  }
  assertReadOnly(db.calls);
});

test('lot input trims all JS Unicode whitespace, not interior or non-trim characters, and safely binds injection-like literals', async () => {
  const lots = ['LOT', 'lot', 'N/A', "x' OR 1=1; DROP TABLE products; --", '\u200bLOT\u0085', 'L O T', 'L'.repeat(255)];
  const db = mockDatabase(lots.flatMap((lot) => [[product], [{ ...receipt, materialLotNumber: lot }], []]));
  await withApi(db, async (request) => {
    for (const lot of lots) {
      const result = await request(`/api/lot-inventory/17/history?lot=${encodeURIComponent(`${lotWhitespace}${lot}${lotWhitespace}`)}`);
      assert.equal(result.status, 200);
      assert.equal(result.body.materialLotNumber, lot);
      assert.equal(result.body.receiving[0].materialLotNumber, lot);
      for (const call of db.calls.slice(-2)) {
        assert.equal(call.parameters.materialLotNumber[1], lot);
        assert.equal(call.parameters.materialLotNumber[0].type, sql.NVarChar);
        assert.equal(call.parameters.materialLotNumber[0].length, 255);
        assertWhitespaceInput(call);
      }
    }
  });
  for (const call of db.calls) assert.ok(!call.statement.includes(lots[3]));
  const receivingQueries = db.calls.filter((call) => call.statement.includes('FROM dbo.receiving_transactions'));
  assert.ok(receivingQueries.every((call) => call.statement === receivingQueries[0].statement));
  assertReadOnly(db.calls);
});

test('unassigned history uses only SQL NULL/trimmed-empty values; literal N/A stays a separately bound lot', async () => {
  const nullReceipt = { ...receipt, materialLotNumber: null };
  const nullUsage = { ...usage, materialLotNumber: null };
  const literalReceipt = { ...receipt, materialLotNumber: 'N/A' };
  const db = mockDatabase([[product], [nullReceipt], [nullUsage], [product], [literalReceipt], []]);
  await withApi(db, async (request) => {
    assert.deepEqual(await request('/api/lot-inventory/17/history?unassigned=1'), {
      status: 200, body: { product, materialLotNumber: null, receiving: [nullReceipt], usage: [nullUsage] },
    });
    assert.deepEqual(await request('/api/lot-inventory/17/history?lot=N%2FA'), {
      status: 200, body: { product, materialLotNumber: 'N/A', receiving: [literalReceipt], usage: [] },
    });
  });
  for (const call of db.calls.slice(1, 3)) {
    assert.ok(call.statement.includes(`WHERE product_id = @productId AND ${normalizedLot} IS NULL`));
    assert.ok(!Object.hasOwn(call.parameters, 'materialLotNumber'));
    assert.doesNotMatch(call.statement, /N\/A|COALESCE|\bOR\b/i);
  }
  for (const call of db.calls.slice(4)) {
    assert.equal(call.parameters.materialLotNumber[1], 'N/A');
    assert.ok(call.statement.includes('= @materialLotNumber COLLATE Latin1_General_100_BIN2'));
  }
});

test('usage-only and exhausted histories remain readable without balance or receiving-presence checks', async () => {
  const orphanUsage = { ...usage, materialLotNumber: 'ORPHAN' };
  const exhaustedReceipt = { ...receipt, materialLotNumber: 'EXHAUSTED' };
  const exhaustedUsage = { ...usage, materialLotNumber: 'EXHAUSTED', quantity: receipt.quantity };
  const db = mockDatabase([[product], [], [orphanUsage], [product], [exhaustedReceipt], [exhaustedUsage]]);
  await withApi(db, async (request) => {
    const orphan = await request('/api/lot-inventory/17/history?lot=ORPHAN');
    assert.equal(orphan.status, 200);
    assert.deepEqual(orphan.body.receiving, []);
    assert.deepEqual(orphan.body.usage, [orphanUsage]);
    const exhausted = await request('/api/lot-inventory/17/history?lot=EXHAUSTED');
    assert.equal(exhausted.status, 200);
    assert.equal(exhausted.body.receiving[0].quantity, exhausted.body.usage[0].quantity);
  });
  assert.equal(db.calls.length, 6);
  for (const call of db.calls) assert.doesNotMatch(call.statement, /availableBalance|SUM\(|quantity\s*>/i);
});

test('invalid product IDs are 400 before querying, including non-decimal, fractional and out-of-SQL-int values', async () => {
  const db = mockDatabase();
  await withApi(db, async (request) => {
    for (const id of ['bad', '0', '-1', '1.5', '2147483648', '9007199254740993', 'Infinity', '1e1', '0x11', '+17', ' 17 ', '01']) {
      assert.deepEqual(await request(`/api/lot-inventory/${encodeURIComponent(id)}/history?lot=LOT`), {
        status: 400, body: { error: 'Select a valid product.' },
      });
    }
  });
  assert.equal(db.calls.length, 0);
});

test('missing, duplicate, ambiguous, non-text and otherwise invalid history selectors are 400 without queries', async () => {
  const db = mockDatabase();
  const queries = ['', 'lot=', `lot=${encodeURIComponent(lotWhitespace)}`, `lot=${'L'.repeat(256)}`,
    'lot=LOT&unassigned=1', 'lot=LOT&lot=lot', 'lot[]=LOT', 'lot[child]=LOT',
    'unassigned=', 'unassigned=0', 'unassigned=true', 'unassigned=01', 'unassigned=1&unassigned=1',
    'unassigned[]=1', 'unassigned[child]=1', 'LOT=LOT', 'other=LOT', 'lot=LOT&other=1', 'unassigned=1&other=1'];
  await withApi(db, async (request) => {
    for (const query of queries) {
      const result = await request(`/api/lot-inventory/17/history?${query}`);
      assert.equal(result.status, 400, query);
      assert.deepEqual(result.body, { error: 'Specify one material lot (255 characters or fewer) or unassigned=1.' });
    }
  });
  assert.equal(db.calls.length, 0);
});

test('nonexistent products and transaction-free lot buckets return distinct 404s', async () => {
  const db = mockDatabase([[], [product], [], [], [product], [], []]);
  await withApi(db, async (request) => {
    assert.deepEqual(await request('/api/lot-inventory/2147483647/history?lot=LOT'), {
      status: 404, body: { error: 'Product not found.' },
    });
    assert.equal(db.calls.length, 1);
    assert.equal(db.calls[0].parameters.productId[1], 2147483647);
    for (const selector of ['lot=missing', 'unassigned=1']) {
      assert.deepEqual(await request(`/api/lot-inventory/17/history?${selector}`), {
        status: 404, body: { error: 'Material lot not found.' },
      });
    }
  });
  assert.equal(db.calls.length, 7);
});

test('only GET routes are mounted and unsupported write methods cannot execute any database query', async () => {
  const db = mockDatabase();
  await withApi(db, async (request) => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      for (const path of ['/api/lot-inventory', '/api/lot-inventory/17/history?lot=LOT']) {
        assert.equal((await request(path, { method })).status, 404);
      }
    }
  });
  assert.equal(db.calls.length, 0);
});

test('async errors from every read forward unchanged to the parent handler, preserving 503, timeout, validation and sanitized 500 semantics', async () => {
  const errors = [
    [Object.assign(new Error('Database unavailable.'), { status: 503 }), 503, 'Database unavailable.'],
    [Object.assign(new Error('private timeout'), { code: 'ETIMEOUT', name: 'RequestError' }), 503,
      'SQL Server accepted the connection, but a database query timed out. Check for blocked queries, uncommitted SQL transactions, or an overloaded database.'],
    [Object.assign(new Error('private field'), { number: 2628 }), 400, 'A value exceeds the configured database field length.'],
    [new Error('private database details'), 500, 'An unexpected server error occurred.'],
  ];
  for (const [error, status, message] of errors) {
    for (const responses of [[error], [[product], error], [[product], [], error]]) {
      const db = mockDatabase([...responses]);
      await withApi(db, async (request, forwarded) => {
        assert.deepEqual(await request('/api/lot-inventory/17/history?lot=LOT'), { status, body: { error: message } });
        assert.deepEqual(forwarded, [error]);
      });
    }
    const db = mockDatabase([error]);
    await withApi(db, async (request, forwarded) => {
      assert.deepEqual(await request('/api/lot-inventory'), { status, body: { error: message } });
      assert.deepEqual(forwarded, [error]);
    });
  }
});
