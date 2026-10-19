import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer as createHttpServer } from 'node:http';
import { Children, createElement, isValidElement, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server.js';
import { createServer } from 'vite';

const types = [{ id: 1, name: 'IFC' }, { id: 2, name: 'Bulk' }, { id: 3, name: 'Label' }];
const products = [
  { id: 17, productTypeId: 1, productType: 'IFC', name: 'CoQ10 capsules', itemCode: 'SHARED-01', makItemCode: 'MAK-IFC', unit: 'Pcs' },
  { id: 18, productTypeId: 2, productType: 'Bulk', name: 'CoQ10 powder', itemCode: 'SHARED-01', makItemCode: 'MAK-BULK', unit: 'Kg' },
  { id: 19, productTypeId: '1', productType: 'IFC', name: 'Vitamin D', itemCode: 'VIT-D', unit: 'Pcs' },
];

let vite;
let ProductsPage;
let InventoryHistoryPage;

before(async () => {
  vite = await createServer({ optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: { server: createHttpServer() }, watch: null }, appType: 'custom' });
  ({ default: ProductsPage } = await vite.ssrLoadModule('/src/pages/products/ProductsPage.jsx'));
  ({ default: InventoryHistoryPage } = await vite.ssrLoadModule('/src/pages/history/InventoryHistoryPage.jsx'));
});

after(async () => {
  await vite?.close();
});

function findElement(element, predicate) {
  if (!isValidElement(element)) return undefined;
  if (predicate(element)) return element;
  return Children.toArray(element.props.children).map((child) => findElement(child, predicate)).find(Boolean);
}

function renderProducts(search = '', typeChanges = [], overrides = {}) {
  const props = { products, types, search, setSearch() {}, onAddType() {}, onEdit() {}, onHistory() {}, onExport() {}, ...overrides };
  function InteractiveProducts() {
    const [step, setStep] = useState(0);
    const page = ProductsPage(props);
    if (step < typeChanges.length) {
      // SSR render retries exercise the actual filter handler and local state without a browser.
      const filter = findElement(page, (element) => element.type === 'select');
      filter.props.onChange({ target: { value: typeChanges[step] } });
      setStep(step + 1);
    }
    return page;
  }
  return renderToStaticMarkup(createElement(InteractiveProducts));
}

function renderHistory(query = '', props = { products, types }) {
  return renderToStaticMarkup(createElement(StaticRouter, { location: `/inv_history${query}` },
    createElement(InventoryHistoryPage, props)));
}

function productPicker(html) {
  return html.match(/<label>Select product\s*(<select[\s\S]*?<\/select>)/)?.[1];
}

test('Product Master defaults to All independently of dashboard type state and keeps catalog totals', () => {
  const html = renderProducts('', [], { typeFilter: '2', setTypeFilter() { assert.fail('Dashboard filter must not be changed'); } });
  assert.match(html, /<select class="filter-select" aria-label="Filter by product type">/);
  assert.match(html, /<option value="" selected="">All product types<\/option>/);
  for (const product of products) assert.ok(html.includes(product.name));
  assert.match(html, /<strong>Total products: 3<\/strong>/);
  assert.match(html, /3 product types available/);
  assert.match(html, /Export CSV/);
});

test('Product Master combines local product type selection with name, item code, and MAK code search', () => {
  for (const search of ['  COQ10  ', 'shared-01', 'mak-ifc']) {
    const html = renderProducts(search, ['1']);
    assert.match(html, /<option value="1" selected="">IFC<\/option>/);
    assert.ok(html.includes('CoQ10 capsules'), search);
    assert.ok(!html.includes('CoQ10 powder'), search);
    assert.ok(!html.includes('Vitamin D'), search);
    assert.match(html, /<strong>Total products: 3<\/strong>/);
  }
  const filtered = renderProducts('', ['1']);
  assert.ok(filtered.includes('CoQ10 capsules'));
  assert.ok(filtered.includes('Vitamin D'));
  assert.ok(!filtered.includes('CoQ10 powder'));
  assert.match(filtered, /<span class="type-badge">IFC<\/span>/);
});

test('Product Master supports empty types, no matches, and resetting to All without clearing search', () => {
  const emptyType = renderProducts('', ['3']);
  assert.match(emptyType, /No products found/);
  assert.match(emptyType, /<strong>Total products: 3<\/strong>/);
  const mismatch = renderProducts('mak-bulk', ['1']);
  assert.match(mismatch, /No products found/);
  const reset = renderProducts('coq10', ['1', '']);
  assert.match(reset, /<option value="" selected="">All product types<\/option>/);
  assert.ok(reset.includes('CoQ10 capsules'));
  assert.ok(reset.includes('CoQ10 powder'));
  assert.ok(!reset.includes('Vitamin D'));
  assert.match(renderProducts('', [], { products: [] }), /<strong>Total products: 0<\/strong>/);
});

test('history defaults to All, keeps product type labels, and supports omitted types', () => {
  for (const props of [{ products, types }, { products }]) {
    const html = renderHistory('', props);
    assert.match(html, /<label>Product type\s*<select><option value="" selected="">All product types<\/option>/);
    const picker = productPicker(html);
    for (const product of products) {
      assert.ok(picker.includes(`<option value="${product.id}">${product.makItemCode || '—'} · ${product.itemCode} — ${product.name} (${product.productType})</option>`));
    }
    assert.match(html, /Select a product to view its history/);
    assert.doesNotMatch(html, /Export Excel|Export PDF/);
  }
});

test('history typeId query filters only matching products and supports an empty product type', () => {
  const html = renderHistory('?typeId=1');
  assert.match(html, /<option value="1" selected="">IFC<\/option>/);
  const picker = productPicker(html);
  assert.ok(picker.includes('CoQ10 capsules'));
  assert.ok(picker.includes('Vitamin D'));
  assert.ok(!picker.includes('CoQ10 powder'));
  const empty = productPicker(renderHistory('?typeId=3'));
  assert.match(empty, /<option value="" selected="">Choose a product<\/option>/);
  for (const product of products) assert.ok(!empty.includes(product.name));
});

test('history preserves productId deep links and derives selection from each URL for Back and Forward', () => {
  const queries = ['?productId=18', '?typeId=1&productId=17', '?typeId=2&productId=18', '?typeId=1&productId=17', '?typeId=2&productId=18'];
  for (const query of queries) {
    const selectedId = new URLSearchParams(query).get('productId');
    const picker = productPicker(renderHistory(query));
    assert.match(picker, new RegExp(`<option value="${selectedId}" selected="">`));
  }
  const conflicting = productPicker(renderHistory('?typeId=1&productId=18'));
  assert.match(conflicting, /<option value="" selected="">Choose a product<\/option>/);
  assert.ok(!conflicting.includes('CoQ10 powder'));
});
