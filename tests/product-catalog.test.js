import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer as createHttpServer } from 'node:http';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server.js';
import { createServer } from 'vite';

const types = [{ id: 1, name: 'IFC' }, { id: 2, name: 'Bulk' }, { id: 3, name: 'Label' }];
const products = types.map((type) => ({
  id: 17 + type.id, productTypeId: type.id, productType: type.name,
  name: 'Qunol Ultra CoQ10 100mg 120ct', itemCode: '10935-SEG-20-0120', makItemCode: 'TRV2602-A120', unit: 'Pcs',
}));

test('Product Master counts all product records independently of search and handles catalog updates', async () => {
  const vite = await createServer({ optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: { server: createHttpServer() }, watch: null }, appType: 'custom' });
  try {
    const { default: ProductsPage } = await vite.ssrLoadModule('/src/pages/products/ProductsPage.jsx');
    const render = (catalog, search = '') => renderToStaticMarkup(createElement(ProductsPage, {
      products: catalog, search, types, setSearch() {}, onAddType() {}, onEdit() {}, onHistory() {}, onExport() {},
    }));
    assert.match(render([]), /<strong>Total products: 0<\/strong>/);
    assert.match(render(products), /<strong>Total products: 3<\/strong>/);
    const searched = render(products, 'nonexistent product');
    assert.match(searched, /<strong>Total products: 3<\/strong>/);
    assert.match(searched, /3 product types available for your catalog\./);
    assert.doesNotMatch(searched, /Qunol Ultra CoQ10/);
    assert.match(render([...products, { ...products[0], id: 99 }]), /<strong>Total products: 4<\/strong>/);
  } finally {
    await vite.close();
  }
});

test('product editor keeps shared names and codes unchanged and explains per-type uniqueness', async () => {
  const vite = await createServer({ optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: { server: createHttpServer() }, watch: null }, appType: 'custom' });
  try {
    const { default: ProductModal } = await vite.ssrLoadModule('/src/components/ProductModal.jsx');
    for (const editingProduct of products) {
      const html = renderToStaticMarkup(createElement(ProductModal, {
        editingProduct, types, onAddType() {}, onSubmit() {}, onClose() {}, busy: false,
      }));
      assert.match(html, /name="name"[^>]*value="Qunol Ultra CoQ10 100mg 120ct"/);
      assert.match(html, /name="itemCode"[^>]*aria-describedby="item-code-help"[^>]*value="10935-SEG-20-0120"/);
      assert.match(html, /id="item-code-help"[^>]*>Must be unique within the selected product type\./);
      assert.match(html, new RegExp(`<option value="${editingProduct.productTypeId}" selected="">${editingProduct.productType}</option>`));
      assert.doesNotMatch(html, /Qunol Ultra CoQ10 100mg 120ct - (IFC|BULK|LABEL)/);
    }
  } finally {
    await vite.close();
  }
});

test('history picker shows MAK code, item code and name, retains type, and uses product IDs', async () => {
  const vite = await createServer({ optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: { server: createHttpServer() }, watch: null }, appType: 'custom' });
  try {
    const { default: InventoryHistoryPage } = await vite.ssrLoadModule('/src/pages/history/InventoryHistoryPage.jsx');
    const html = renderToStaticMarkup(createElement(StaticRouter, { location: '/inv_history' },
      createElement(InventoryHistoryPage, { products })));
    for (const product of products) {
      assert.ok(html.includes(`<option value="${product.id}">${product.makItemCode} · ${product.itemCode} — ${product.name} (${product.productType})</option>`));
    }
    for (const makItemCode of [undefined, null, '']) {
      const product = { ...products[0], makItemCode };
      const missing = renderToStaticMarkup(createElement(StaticRouter, { location: '/inv_history' },
        createElement(InventoryHistoryPage, { products: [product] })));
      assert.ok(missing.includes(`<option value="${product.id}">— · ${product.itemCode} — ${product.name} (${product.productType})</option>`));
    }
  } finally {
    await vite.close();
  }
});
