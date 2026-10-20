import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer as createHttpServer } from 'node:http';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { inventoryTypeTotals } from '../src/lib/inventory-type-totals.js';
import { quantity } from '../src/lib/format.js';

const types = [
  { id: 1, name: 'Bulk' }, { id: 2, name: 'IFC' }, { id: 3, name: 'Label' },
  { id: 4, name: 'Sleeve' }, { id: 5, name: 'Other packaging' },
];
const products = [
  { id: 17, productTypeId: 1, productType: 'Bulk', name: 'Bulk stock', itemCode: 'B-1', unit: 'kg', totalReceived: '12.5', totalUsed: '2.25', availableBalance: '10.25' },
  { id: 18, productTypeId: '1', productType: 'Bulk', name: 'Bulk stock', itemCode: 'B-1', unit: ' kgs ', totalReceived: 7.5, totalUsed: 3.75, availableBalance: 3.75 },
  { id: 19, productTypeId: 2, productType: 'IFC', name: 'IFC stock', itemCode: 'B-1', unit: 'Pcs', totalReceived: 1000, totalUsed: 250, availableBalance: 750 },
  { id: 20, productTypeId: 2, productType: 'IFC', name: 'IFC stock', itemCode: 'B-1', unit: 'pcs', totalReceived: 500, totalUsed: 50, availableBalance: 450 },
  { id: 21, productTypeId: 2, productType: 'IFC', name: 'IFC powder', itemCode: 'IF-2', unit: 'kgs', totalReceived: 2.5, totalUsed: 0.25, availableBalance: 2.25 },
];

test('type totals aggregate all records by type ID and normalize compatible units without mutating data', () => {
  const original = JSON.stringify({ products, types });
  const totals = inventoryTypeTotals(products, types);
  assert.deepEqual(totals.map((type) => type.name), types.map((type) => type.name));
  assert.deepEqual(totals[0].units, [{ unit: 'kgs', received: 20, used: 6, balance: 14 }]);
  assert.deepEqual(totals[1].units, [
    { unit: 'Pcs', received: 1500, used: 300, balance: 1200 },
    { unit: 'kgs', received: 2.5, used: 0.25, balance: 2.25 },
  ]);
  for (const empty of totals.slice(2)) assert.deepEqual(empty.units, []);
  assert.equal(JSON.stringify({ products, types }), original);
});

test('empty catalogs, unlisted types, missing totals and negative stock are not omitted', () => {
  assert.deepEqual(inventoryTypeTotals([], []), []);
  assert.equal(inventoryTypeTotals([], types).length, 5);
  const totals = inventoryTypeTotals([
    { productTypeId: 9, productType: 'Extra type', unit: 'Pcs', totalReceived: 2, totalUsed: 3 },
    { productTypeId: 9, productType: 'Extra type', unit: 'Pcs' },
    { unit: '', totalReceived: 10, totalUsed: 4 },
  ], types);
  assert.equal(totals.length, 7);
  assert.deepEqual(totals[5], { id: '9', name: 'Extra type', units: [{ unit: 'Pcs', received: 2, used: 3, balance: -1 }] });
  assert.deepEqual(totals[6], { id: 'other', name: 'Other', units: [{ unit: '', received: 10, used: 4, balance: 6 }] });
});

let vite;
let DashboardPage;
before(async () => {
  vite = await createServer({ optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: { server: createHttpServer() }, watch: null }, appType: 'custom' });
  ({ default: DashboardPage } = await vite.ssrLoadModule('/src/pages/dashboard/DashboardPage.jsx'));
});
after(async () => { await vite?.close(); });
const render = (overrides = {}) => renderToStaticMarkup(createElement(DashboardPage, {
  products, allProducts: products, types, search: '', typeFilter: '', setSearch() {}, setTypeFilter() {}, onHistory() {}, onExport() {}, ...overrides,
}));
const tiles = (html) => html.match(/<div class="stat-grid"[\s\S]*?<\/div>/)?.[0];
const tile = (html, name) => html.match(new RegExp(`<section class="stat-card" aria-label="${name} inventory totals">([\\s\\S]*?)</section>`))?.[1];

function assertMetric(html, label, expected, unit) {
  const row = html.match(new RegExp(`<dt>${label}</dt><dd>([\\s\\S]*?)</dd>`))?.[1];
  assert.ok(row?.includes(`<span>${quantity(expected)}${unit ? ` <small>${unit}</small>` : ''}</span>`), `${label}: ${expected} ${unit || ''}`);
}

test('dashboard shows five type headings with received, used, balance stacked in order', () => {
  const html = render();
  assert.equal((html.match(/class="stat-card"/g) || []).length, 5);
  for (const type of types) {
    const card = tile(html, type.name);
    assert.ok(card.startsWith(`<h2>${type.name}</h2><dl>`));
    assert.ok(card.indexOf('Total received') < card.indexOf('Total used'));
    assert.ok(card.indexOf('Total used') < card.indexOf('Current balance'));
  }
  assertMetric(tile(html, 'Bulk'), 'Total received', 20, 'kgs');
  assertMetric(tile(html, 'Bulk'), 'Total used', 6, 'kgs');
  assertMetric(tile(html, 'Bulk'), 'Current balance', 14, 'kgs');
  assertMetric(tile(html, 'IFC'), 'Total received', 1500, 'Pcs');
  assertMetric(tile(html, 'IFC'), 'Total received', 2.5, 'kgs');
  assertMetric(tile(html, 'Label'), 'Current balance', 0);
  assert.doesNotMatch(html, /Active products/);
});

test('tile totals remain based on all products while search and type filters narrow only the table', () => {
  const html = render({ products: [products[2]], search: 'IFC stock', typeFilter: '2' });
  assertMetric(tile(html, 'Bulk'), 'Total received', 20, 'kgs');
  assertMetric(tile(html, 'IFC'), 'Current balance', 1200, 'Pcs');
  assert.match(html, /1 products/);
  assert.match(html, /IFC stock/);
  assert.doesNotMatch(html, /Bulk stock/);
  assert.match(html, /Export Excel/);
  const empty = render({ products: [], search: 'no match' });
  assertMetric(tile(empty, 'Bulk'), 'Current balance', 14, 'kgs');
  assert.match(empty, /No products found/);
});

test('tiles recalculate after catalog refresh and keep empty types visible', () => {
  const updated = products.map((product) => product.id === 17
    ? { ...product, totalReceived: 22.5, availableBalance: 20.25 } : product);
  const html = render({ allProducts: updated });
  assertMetric(tile(html, 'Bulk'), 'Total received', 30, 'kgs');
  assertMetric(tile(html, 'Bulk'), 'Current balance', 24, 'kgs');
  const empty = render({ products: [], allProducts: [] });
  assert.equal((empty.match(/class="stat-card"/g) || []).length, 5);
  for (const type of types) for (const label of ['Total received', 'Total used', 'Current balance']) assertMetric(tile(empty, type.name), label, 0);
  assert.ok(tiles(html));
});
