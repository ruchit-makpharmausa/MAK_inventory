import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer as createHttpServer } from 'node:http';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server.js';
import { createServer } from 'vite';
import { sortProducts } from '../src/lib/product-sort.js';

const products = Object.freeze([
  { id: 1, name: 'Zinc 10', makItemCode: 'MAK10', itemCode: 'Z-10' },
  { id: 2, name: 'alpha 2', makItemCode: 'MAK2', itemCode: 'A-2' },
  { id: 3, name: 'Alpha 10', makItemCode: 'MAK1', itemCode: 'A-10' },
  { id: 4, name: 'Beta', makItemCode: null, itemCode: 'B-1' },
].map((product) => Object.freeze({ ...product, productTypeId: 1, productType: 'IFC', availableBalance: 10, unit: 'Pcs' })));
const ids = (rows) => rows.map((product) => product.id);

test('MAK code ascending is the default natural order without changing the input', () => {
  const sorted = sortProducts(products);
  assert.deepEqual(ids(sorted), [3, 2, 1, 4]);
  assert.notEqual(sorted, products);
  assert.deepEqual(ids(products), [1, 2, 3, 4]);
  assert.deepEqual(ids(sortProducts([{ id: 1, makItemCode: ' mak10 ' }, { id: 2, makItemCode: 'MAK2' }])), [2, 1]);
});

test('missing MAK codes stay last', () => {
  const missing = [undefined, null, '', '   '].map((makItemCode, index) => ({ id: index + 1, name: `Item ${index + 1}`, makItemCode }));
  assert.deepEqual(ids(sortProducts([...missing, { id: 5, name: 'Zinc', makItemCode: 'MAK2' }])), [5, 1, 2, 3, 4]);
});

test('equal names and codes have deterministic item code, product type and ID tie-breakers', () => {
  const duplicates = [
    { id: 4, itemCode: 'A2', productType: 'Bulk' },
    { id: 3, itemCode: 'A2', productType: 'IFC' },
    { id: 2, itemCode: 'A2', productType: 'Bulk' },
    { id: 1, itemCode: 'B2', productType: 'Bulk' },
  ].map((product) => ({ ...product, name: 'Shared name', makItemCode: 'MAK1' }));
  assert.deepEqual(ids(sortProducts(duplicates)), [2, 4, 3, 1]);
  assert.deepEqual(sortProducts([]), []);
});

let vite;
let TransactionPage;
let InventoryHistoryPage;
before(async () => {
  vite = await createServer({ optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: { server: createHttpServer() }, watch: null }, appType: 'custom' });
  ({ default: TransactionPage } = await vite.ssrLoadModule('/src/components/TransactionPage.jsx'));
  ({ default: InventoryHistoryPage } = await vite.ssrLoadModule('/src/pages/history/InventoryHistoryPage.jsx'));
});
after(async () => { await vite?.close(); });

const types = [{ id: 1, name: 'IFC' }, { id: 2, name: 'Bulk' }];
const catalog = [...products, { id: 99, name: 'Excluded bulk product', makItemCode: 'MAK0', itemCode: 'B-99', productTypeId: 2, productType: 'Bulk' }];
function optionIds(html) {
  return [...html.matchAll(/<option value="(\d+)"/g)].map((match) => Number(match[1]));
}

for (const kind of ['receiving', 'usage']) {
  test(`${kind} automatically orders filtered products by MAK code and retains the selected product`, () => {
    const html = renderToStaticMarkup(createElement(TransactionPage, {
      kind, products: catalog, types, initialProductId: '2', onSaved: async () => {},
    }));
    const picker = html.match(/<select name="productId"[\s\S]*?<\/select>/)?.[0];
    assert.deepEqual(optionIds(picker), [3, 2, 1, 4]);
    assert.match(picker, /<option value="2" selected="">MAK2/);
    assert.ok(picker.includes('10 Pcs available'));
    assert.doesNotMatch(picker, /Excluded bulk product/);
    assert.doesNotMatch(html, /Sort products|name-asc|mak-code-desc/);
  });
}

test('history has fixed MAK order, selected-product shortcuts and no sort selector', () => {
  const html = renderToStaticMarkup(createElement(StaticRouter, { location: '/inv_history?typeId=1&productId=2' },
    createElement(InventoryHistoryPage, { products: catalog, types })));
  const picker = html.match(/<label>Select product\s*(<select[\s\S]*?<\/select>)/)?.[1];
  assert.deepEqual(optionIds(picker), [3, 2, 1, 4]);
  assert.match(picker, /<option value="2" selected="">MAK2/);
  assert.doesNotMatch(picker, /Excluded bulk product/);
  assert.match(html, /<option value="1" selected="">IFC<\/option>/);
  assert.match(html, /<button type="button" class="button primary">Receiving<\/button>/);
  assert.match(html, /<button type="button" class="button secondary">Usage<\/button>/);
  assert.doesNotMatch(html, /Sort products/);
  assert.deepEqual(ids(products), [1, 2, 3, 4]);
});
