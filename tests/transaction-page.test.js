import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer as createHttpServer } from 'node:http';
import { Children, createElement, isValidElement, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server.js';
import { createServer } from 'vite';
import { quantity } from '../src/lib/format.js';

function findElement(element, predicate) {
  if (!isValidElement(element)) return undefined;
  if (predicate(element)) return element;
  return Children.toArray(element.props.children).map((child) => findElement(child, predicate)).find(Boolean);
}

test('material lots are optional in both forms and receiving keeps a separate optional MAK Release Number', async () => {
  const vite = await createServer({ optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: { server: createHttpServer() }, watch: null }, appType: 'custom' });
  try {
    const { default: TransactionPage } = await vite.ssrLoadModule('/src/components/TransactionPage.jsx');
    const render = (kind) => renderToStaticMarkup(createElement(TransactionPage, { kind, products: [], onSaved: async () => {} }));
    const receiving = render('receiving');
    assert.match(receiving, /<label>MAK Release Number <span class="muted-label">\(optional\)<\/span>/);
    assert.doesNotMatch(receiving, /MAK RN Number|name="makRnNumber"/);
    const rnInput = receiving.match(/<input[^>]*name="makReleaseNumber"[^>]*>/)?.[0];
    assert.ok(rnInput);
    assert.match(rnInput, /placeholder="Enter MAK Release Number"/);
    assert.doesNotMatch(rnInput, /\brequired=/);
    const usage = render('usage');
    for (const html of [receiving, usage]) {
      assert.match(html, /<label>Material lot number <span class="muted-label">\(optional\)<\/span>/);
    }
    const lotInput = receiving.match(/<input[^>]*name="materialLotNumber"[^>]*>/)?.[0];
    assert.ok(lotInput);
    assert.doesNotMatch(lotInput, /\brequired=/);
    assert.match(lotInput, /maxLength="255"/);
    assert.match(lotInput, /placeholder="Enter material lot number"/);
    const lotSelect = usage.match(/<select[^>]*name="materialLotNumber"[^>]*>[\s\S]*?<\/select>/)?.[0];
    assert.ok(lotSelect);
    assert.doesNotMatch(lotSelect, /\brequired=/);
    assert.match(lotSelect, /<option value="" selected="">N\/A<\/option>/);
    assert.match(lotSelect, /disabled=""/);
    assert.doesNotMatch(usage, /<input name="materialLotNumber"/);
    assert.match(usage, /<input name="makLotNumber" required=""/);
    assert.doesNotMatch(usage, /MAK Release Number|lot-tracked/);
  } finally {
    await vite.close();
  }
});

test('both transaction pickers show MAK code, item code, name, type and available balance', async () => {
  const vite = await createServer({ optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: { server: createHttpServer() }, watch: null }, appType: 'custom' });
  try {
    const { default: TransactionPage } = await vite.ssrLoadModule('/src/components/TransactionPage.jsx');
    const products = [
      { id: 17, productTypeId: 1, productType: 'Sleeve', makItemCode: '000MAK', itemCode: '0001', name: 'Sleeve item', availableBalance: 1000.5, unit: 'Pcs' },
      ...[undefined, null, ''].map((makItemCode, index) => ({ id: 20 + index, productTypeId: 1, productType: 'Sleeve', makItemCode,
        itemCode: `SL-${index}`, name: `Optional code ${index}`, availableBalance: 0, unit: 'kgs' })),
      { id: 18, productTypeId: 2, productType: 'IFC', makItemCode: 'MAK-IFC', itemCode: 'IF-001', name: 'Excluded IFC item', availableBalance: 5, unit: 'Pcs' },
    ];
    for (const kind of ['receiving', 'usage']) {
      function SelectedTransaction() {
        const [step, setStep] = useState(0);
        const page = TransactionPage({ kind, products, types: [{ id: 1, name: 'Sleeve' }, { id: 2, name: 'IFC' }], onSaved: async () => {} });
        if (step < 2) {
          const select = findElement(page, (element) => element.type === 'select'
            && (step === 0 ? !element.props.name : element.props.name === 'productId'));
          select.props.onChange({ target: { value: step === 0 ? '1' : '17' } });
          setStep(step + 1);
        }
        return page;
      }
      const html = renderToStaticMarkup(createElement(SelectedTransaction));
      assert.ok(html.includes(`<option value="17" selected="">000MAK · 0001 — Sleeve item (Sleeve) (${quantity(1000.5)} Pcs available)</option>`));
      for (let index = 0; index < 3; index++) {
        assert.ok(html.includes(`<option value="${20 + index}">— · SL-${index} — Optional code ${index} (Sleeve) (0 kgs available)</option>`));
      }
      assert.doesNotMatch(html, /MAK-IFC|Excluded IFC item/);
      assert.doesNotMatch(html, /<button class="button primary submit-button" disabled/);
    }
  } finally {
    await vite.close();
  }
});

test('receiving and usage require a product type before exposing products', async () => {
  const vite = await createServer({ optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: { server: createHttpServer() }, watch: null }, appType: 'custom' });
  try {
    const { default: ReceivingPage } = await vite.ssrLoadModule('/src/pages/receiving/ReceivingPage.jsx');
    const { default: UsagePage } = await vite.ssrLoadModule('/src/pages/usage/UsagePage.jsx');
    const props = {
      types: [{ id: 1, name: 'Sleeve' }, { id: 2, name: 'IFC' }, { id: 3, name: 'Bulk' }],
      products: [
        { id: 17, productTypeId: 1, name: 'Sleeve item', itemCode: 'SL-001', availableBalance: 10, unit: 'Pcs' },
        { id: 18, productTypeId: 2, name: 'IFC item', itemCode: 'IF-001', availableBalance: 5, unit: 'Pcs' },
      ],
      onSaved: async () => {},
    };
    for (const Page of [ReceivingPage, UsagePage]) {
      const html = renderToStaticMarkup(createElement(StaticRouter, { location: '/' }, createElement(Page, props)));
      assert.match(html, /<label>Product type <span class="required">\*<\/span><select required="">/);
      assert.match(html, /<option value="1">Sleeve<\/option>/);
      assert.match(html, /<option value="2">IFC<\/option>/);
      assert.match(html, /<option value="3">Bulk<\/option>/);
      assert.ok(html.indexOf('Product type') < html.indexOf('name="productId"'));
      assert.match(html, /<select name="productId" required="" disabled="">/);
      assert.match(html, /Select product type first/);
      assert.doesNotMatch(html, /Sleeve item|IFC item/);
      assert.match(html, /<button class="button primary submit-button" disabled="">/);
    }
  } finally {
    await vite.close();
  }
});
