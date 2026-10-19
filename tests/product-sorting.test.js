import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer as createHttpServer } from 'node:http';
import { Children, createElement, isValidElement, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server.js';
import { createServer } from 'vite';
import { productSortOptions, sortProducts } from '../src/lib/product-sort.js';

const products = Object.freeze([
  { id: 1, name: 'Zinc 10', makItemCode: 'MAK10', itemCode: 'Z-10' },
  { id: 2, name: 'alpha 2', makItemCode: 'MAK2', itemCode: 'A-2' },
  { id: 3, name: 'Alpha 10', makItemCode: 'MAK1', itemCode: 'A-10' },
  { id: 4, name: 'Beta', makItemCode: null, itemCode: 'B-1' },
].map((product) => Object.freeze({ ...product, productTypeId: 1, productType: 'IFC', availableBalance: 10, unit: 'Pcs' })));
const expected = {
  'name-asc': [2, 3, 4, 1],
  'name-desc': [1, 4, 3, 2],
  'mak-code-asc': [3, 2, 1, 4],
  'mak-code-desc': [1, 2, 3, 4],
};
const ids = (rows) => rows.map((product) => product.id);

for (const [order, expectedIds] of Object.entries(expected)) {
  test(`${order} uses natural case-insensitive ordering without changing the input`, () => {
    const sorted = sortProducts(products, order);
    assert.deepEqual(ids(sorted), expectedIds);
    assert.notEqual(sorted, products);
    assert.deepEqual(ids(products), [1, 2, 3, 4]);
  });
}

test('missing MAK codes stay last for ascending and descending sorts', () => {
  const missing = [undefined, null, '', '   '].map((makItemCode, index) => ({ id: index + 1, name: `Item ${index + 1}`, makItemCode }));
  for (const order of ['mak-code-asc', 'mak-code-desc']) {
    assert.deepEqual(ids(sortProducts([...missing, { id: 5, name: 'Zinc', makItemCode: 'MAK2' }], order)), [5, 1, 2, 3, 4]);
  }
});

test('equal names and codes have deterministic item code, product type and ID tie-breakers', () => {
  const duplicates = [
    { id: 4, itemCode: 'A2', productType: 'Bulk' },
    { id: 3, itemCode: 'A2', productType: 'IFC' },
    { id: 2, itemCode: 'A2', productType: 'Bulk' },
    { id: 1, itemCode: 'B2', productType: 'Bulk' },
  ].map((product) => ({ ...product, name: 'Shared name', makItemCode: 'MAK1' }));
  for (const { value } of productSortOptions) assert.deepEqual(ids(sortProducts(duplicates, value)), [2, 4, 3, 1]);
  assert.deepEqual(sortProducts([], 'mak-code-desc'), []);
  assert.deepEqual(ids(sortProducts(products)), expected['name-asc']);
  assert.deepEqual(ids(sortProducts(products, 'unsupported')), expected['name-asc']);
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
function findElement(element, predicate) {
  if (!isValidElement(element)) return undefined;
  if (predicate(element)) return element;
  return Children.toArray(element.props.children).map((child) => findElement(child, predicate)).find(Boolean);
}
function optionIds(html) {
  return [...html.matchAll(/<option value="(\d+)"/g)].map((match) => Number(match[1]));
}

for (const kind of ['receiving', 'usage']) {
  test(`${kind} sort controls filter options and retain the selected product`, () => {
    for (const { value } of productSortOptions) {
      function Transaction() {
        const [step, setStep] = useState(0);
        const page = TransactionPage({ kind, products: catalog, types, onSaved: async () => {} });
        if (step < 3) {
          const select = findElement(page, (element) => element.type === 'select' && (step === 0
            ? element.props.required && !element.props.name
            : step === 1 ? element.props.name === 'productId' : element.props['aria-label'] === 'Sort products'));
          select.props.onChange({ target: { value: ['1', '2', value][step] } });
          setStep(step + 1);
        }
        return page;
      }
      const html = renderToStaticMarkup(createElement(Transaction));
      const picker = html.match(/<select name="productId"[\s\S]*?<\/select>/)?.[0];
      assert.deepEqual(optionIds(picker), expected[value]);
      assert.match(picker, /<option value="2" selected="">MAK2/);
      assert.ok(picker.includes('10 Pcs available'));
      assert.doesNotMatch(picker, /Excluded bulk product/);
      const sort = html.match(/<select aria-label="Sort products"[\s\S]*?<\/select>/)?.[0];
      assert.ok(sort.includes(`<option value="${value}" selected="">`));
      assert.doesNotMatch(sort, /\bname=/);
    }
  });
}

test('history sorting retains product ID and type filter, without changing the URL or stored catalog', () => {
  for (const { value } of productSortOptions) {
    function History() {
      const [changed, setChanged] = useState(false);
      const page = InventoryHistoryPage({ products: catalog, types });
      if (!changed) {
        findElement(page, (element) => element.type === 'select' && element.props['aria-label'] === 'Sort products')
          .props.onChange({ target: { value } });
        setChanged(true);
      }
      return page;
    }
    const html = renderToStaticMarkup(createElement(StaticRouter, { location: '/inv_history?typeId=1&productId=2' }, createElement(History)));
    const picker = html.match(/<label>Select product\s*(<select[\s\S]*?<\/select>)/)?.[1];
    assert.deepEqual(optionIds(picker), expected[value]);
    assert.match(picker, /<option value="2" selected="">MAK2/);
    assert.doesNotMatch(picker, /Excluded bulk product/);
    assert.match(html, /<option value="1" selected="">IFC<\/option>/);
  }
  assert.deepEqual(ids(products), [1, 2, 3, 4]);
});
