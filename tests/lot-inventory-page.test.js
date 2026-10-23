import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer as createHttpServer } from 'node:http';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server.js';
import { createServer } from 'vite';
import { filterLotInventory, lotIdentity } from '../src/lib/lot-inventory.js';

const rows = [
  { productId: 17, productTypeId: 1, productName: 'Shared name', itemCode: 'SHARED', makItemCode: 'MAK10', materialLotNumber: '000LOT', totalReceived: 10, totalUsed: 4, availableBalance: 6 },
  { productId: 17, productTypeId: 1, productName: 'Shared name', itemCode: 'SHARED', makItemCode: 'MAK10', materialLotNumber: 'Finished', totalReceived: 5, totalUsed: 5, availableBalance: 0 },
  { productId: 17, productTypeId: 1, productName: 'Shared name', itemCode: 'SHARED', makItemCode: 'MAK10', materialLotNumber: null, totalReceived: 0, totalUsed: 2, availableBalance: -2 },
  { productId: 18, productTypeId: 2, productName: 'Shared name', itemCode: 'SHARED', makItemCode: 'MAK2', materialLotNumber: '000LOT', totalReceived: 20, totalUsed: 0, availableBalance: 20 },
  { productId: 18, productTypeId: 2, productName: 'Shared name', itemCode: 'SHARED', makItemCode: 'MAK2', materialLotNumber: 'N/A', totalReceived: 5, totalUsed: 0, availableBalance: 5 },
];

test('lot identities preserve product ID, exact case, separators and literal N/A vs NULL', () => {
  assert.equal(lotIdentity(17, null), lotIdentity('17', undefined));
  assert.notEqual(lotIdentity(17, null), lotIdentity(17, 'N/A'));
  assert.notEqual(lotIdentity(17, 'LOT'), lotIdentity(18, 'LOT'));
  assert.notEqual(lotIdentity(17, 'LOT'), lotIdentity(17, 'lot'));
  assert.notEqual(lotIdentity('17|LOT', 'A'), lotIdentity('17', 'LOT|A'));
});

test('all lot statuses are included by default, with no mutation or cross-type product merges', () => {
  const original = JSON.stringify(rows);
  assert.equal(filterLotInventory(rows).length, 5);
  assert.equal(filterLotInventory(rows, { typeId: '1' }).length, 3);
  assert.equal(filterLotInventory(rows, { productId: '18' }).length, 2);
  assert.equal(filterLotInventory(rows, { typeId: '1', productId: '18' }).length, 0);
  assert.equal(JSON.stringify(rows), original);
});

test('lot search combines with product/type and available/exhausted/negative/unassigned filters', () => {
  assert.equal(filterLotInventory(rows, { search: '  000lot  ' }).length, 2);
  assert.equal(filterLotInventory(rows, { search: 'mak2', typeId: '2' }).length, 2);
  assert.equal(filterLotInventory(rows, { search: 'shared', productId: '17' }).length, 3);
  assert.equal(filterLotInventory(rows, { search: 'no match' }).length, 0);
  assert.equal(filterLotInventory(rows, { status: 'available' }).length, 3);
  assert.equal(filterLotInventory(rows, { status: 'exhausted' })[0].materialLotNumber, 'Finished');
  assert.equal(filterLotInventory(rows, { status: 'negative' })[0].materialLotNumber, null);
  assert.equal(filterLotInventory(rows, { status: 'unassigned' }).length, 1);
  assert.equal(filterLotInventory(rows, { search: 'N/A' }).length, 2);
});

test('Lot Inventory renders accessible filters, fixed product ordering and a load state', async () => {
  const vite = await createServer({ optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: { server: createHttpServer() }, watch: null }, appType: 'custom' });
  try {
    const { default: LotInventoryPage } = await vite.ssrLoadModule('/src/pages/lots/LotInventoryPage.jsx');
    const html = renderToStaticMarkup(createElement(StaticRouter, { location: '/lot-inventory?typeId=1&productId=17&search=000LOT&status=exhausted' },
      createElement(LotInventoryPage, { types: [{ id: 1, name: 'IFC' }], products: [
        { id: 17, productTypeId: 1, productType: 'IFC', itemCode: 'SHARED', name: 'Shared name', makItemCode: 'MAK10' },
        { id: 18, productTypeId: 1, productType: 'IFC', itemCode: 'SHARED', name: 'Shared name', makItemCode: 'MAK2' },
      ] })));
    assert.match(html, /<h1>Lot Inventory<\/h1>/);
    assert.match(html, /aria-label="Search lot inventory"/);
    assert.match(html, /aria-label="Lot product type"/);
    assert.match(html, /aria-label="Lot product"/);
    assert.match(html, /aria-label="Lot status"/);
    assert.match(html, /<option value="exhausted" selected="">Exhausted<\/option>/);
    assert.match(html, /<option value="17" selected="">/);
    assert.ok(html.indexOf('MAK2 ·') < html.indexOf('MAK10 ·'));
    assert.match(html, /Loading lot inventory/);
    assert.match(html, /Unassigned \(N\/A\) transactions are tracked separately/);
    assert.doesNotMatch(html, /Sort products/);
  } finally { await vite.close(); }
});
