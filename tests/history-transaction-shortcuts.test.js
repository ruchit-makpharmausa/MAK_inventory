import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer as createHttpServer } from 'node:http';
import { Children, createElement, isValidElement, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server.js';
import { createServer } from 'vite';

const types = [{ id: 1, name: 'IFC' }, { id: 2, name: 'Bulk' }];
const products = [
  { id: 17, productTypeId: 1, productType: 'IFC', name: 'Shared name', makItemCode: 'MAK2', itemCode: 'SHARED', availableBalance: 10, unit: 'Pcs' },
  { id: 18, productTypeId: 2, productType: 'Bulk', name: 'Shared name', makItemCode: 'MAK2', itemCode: 'SHARED', availableBalance: 20, unit: 'kgs' },
];
let vite;
let InventoryHistoryPage;
let ReceivingPage;
let UsagePage;
before(async () => {
  vite = await createServer({ optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: { server: createHttpServer() }, watch: null }, appType: 'custom' });
  ({ default: InventoryHistoryPage } = await vite.ssrLoadModule('/src/pages/history/InventoryHistoryPage.jsx'));
  ({ default: ReceivingPage } = await vite.ssrLoadModule('/src/pages/receiving/ReceivingPage.jsx'));
  ({ default: UsagePage } = await vite.ssrLoadModule('/src/pages/usage/UsagePage.jsx'));
});
after(async () => { await vite?.close(); });
const render = (Page, url, catalog = products) => renderToStaticMarkup(createElement(StaticRouter, { location: url },
  createElement(Page, { products: catalog, types, onSaved: async () => {} })));

test('History offers in-page receiving and usage buttons rather than navigation links', () => {
  for (const product of products) {
    const html = render(InventoryHistoryPage, `/inv_history?productId=${product.id}`);
    assert.match(html, /<button type="button" class="button primary">Receiving<\/button>/);
    assert.match(html, /<button type="button" class="button secondary">Usage<\/button>/);
    assert.doesNotMatch(html, /href="\/(?:receiving|usage)|Sort products|<dialog/);
  }
});

function findElement(element, predicate) {
  if (!isValidElement(element)) return undefined;
  if (predicate(element)) return element;
  return Children.toArray(element.props.children).map((child) => findElement(child, predicate)).find(Boolean);
}

for (const kind of ['receiving', 'usage']) {
  test(`History ${kind} dialog is bound to the selected product and shares the transaction fields`, () => {
    for (const product of products) {
      function OpenDialog() {
        const [opened, setOpened] = useState(false);
        const page = InventoryHistoryPage({ products, types });
        if (!opened) {
          const button = findElement(page, (element) => element.type === 'button'
            && element.props.children === (kind === 'receiving' ? 'Receiving' : 'Usage'));
          button.props.onClick();
          setOpened(true);
        }
        return page;
      }
      const html = renderToStaticMarkup(createElement(StaticRouter, { location: `/inv_history?productId=${product.id}` }, createElement(OpenDialog)));
      const dialog = html.match(/<dialog[\s\S]*?<\/dialog>/)?.[0];
      assert.ok(dialog);
      assert.match(dialog, /aria-labelledby="transaction-dialog-title"/);
      assert.match(dialog, /aria-describedby="transaction-dialog-product"/);
      assert.ok(dialog.includes(`${product.makItemCode} · ${product.itemCode} · ${product.productType}`));
      assert.ok(dialog.includes(`Available: ${product.availableBalance} ${product.unit}`));
      assert.match(dialog, /name="quantity"[^>]*required=""/);
      assert.doesNotMatch(dialog, /<select name="productId"|Sort products/);
      assert.match(dialog, /<button type="button" class="button secondary">Cancel<\/button>/);
      assert.match(dialog, /aria-label="Close dialog"/);
      assert.match(dialog, /name="materialLotNumber"/);
      const lotField = dialog.match(/<(?:input|select)[^>]*name="materialLotNumber"[^>]*>/)?.[0];
      assert.ok(lotField);
      assert.doesNotMatch(lotField, /required/);
      if (kind === 'receiving') {
        assert.match(lotField, /^<input/);
        assert.match(dialog, /name="receivingDate"/);
        assert.match(dialog, /name="makReleaseNumber"/);
        assert.doesNotMatch(dialog, /name="makLotNumber"/);
      } else {
        assert.match(lotField, /^<select/);
        assert.match(dialog, /<option value="" selected="">N\/A<\/option>/);
        assert.match(dialog, /name="usageDate"/);
        assert.match(dialog, /name="makLotNumber" required=""/);
        assert.doesNotMatch(dialog, /name="makReleaseNumber"/);
      }
    }
  });
}

test('History shortcuts are unavailable without a valid product or with an incompatible type filter', () => {
  for (const query of ['', '?productId=unknown', '?productId=17&typeId=2']) {
    const html = render(InventoryHistoryPage, `/inv_history${query}`);
    assert.doesNotMatch(html, />(?:Receiving|Usage)<\/button>|<dialog/);
  }
});

for (const [route, Page] of [['receiving', () => ReceivingPage], ['usage', () => UsagePage]]) {
  test(`${route} query preselects the exact product and derives its type`, () => {
    for (const product of products) {
      const html = render(Page(), `/${route}?productId=${product.id}`);
      assert.ok(html.includes(`<option value="${product.productTypeId}" selected="">${product.productType}</option>`));
      assert.ok(html.includes(`<option value="${product.id}" selected="">MAK2`));
      assert.doesNotMatch(html, /<select name="productId" required="" disabled/);
      assert.doesNotMatch(html, /<button class="button primary submit-button" disabled/);
      assert.doesNotMatch(html, /Sort products/);
    }
  });
  test(`${route} ordinary and invalid links still require choosing a product`, () => {
    for (const query of ['', '?productId=missing', '?productId=-1']) {
      const html = render(Page(), `/${route}${query}`);
      assert.match(html, /<select name="productId" required="" disabled="">/);
      assert.match(html, /Select product type first/);
      assert.match(html, /<button class="button primary submit-button" disabled="">/);
    }
    const loading = render(Page(), `/${route}?productId=17`, []);
    assert.match(loading, /<button class="button primary submit-button" disabled="">/);
  });
}
