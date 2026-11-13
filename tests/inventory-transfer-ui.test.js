import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer as createHttpServer } from 'node:http';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const source = { id: 17, productTypeId: 1, productType: 'Bulk', name: 'Source stock', itemCode: 'SRC-01', makItemCode: 'TRV-SRC', unit: 'Pcs', availableBalance: 12 };
const destination = { id: 18, productTypeId: 1, productType: 'Bulk', name: 'Destination stock', itemCode: 'DST-01', makItemCode: 'TRV-DST', unit: 'Pcs', availableBalance: 3 };

 test('transfer history offers source selection, destination product, MAK lot, date, and quantity', async () => {
  const vite = await createServer({ optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: { server: createHttpServer() }, watch: null }, appType: 'custom' });
  try {
    const { default: TransferDialog } = await vite.ssrLoadModule('/src/components/TransferDialog.jsx');
    const otherTypeProduct = { ...destination, id: 19, productTypeId: 2, productType: 'Sleeve', itemCode: 'SL-19', name: 'Other type product' };
    const html = renderToStaticMarkup(createElement(TransferDialog, {
      sourceProduct: source, products: [source, destination, otherTypeProduct], onClose() {}, onSaved() {},
    }));
    assert.match(html, /Transfer between products/);
    assert.match(html, /Source: Source stock/);
    assert.match(html, /name="sourceMaterialLotNumber" required=""/);
    assert.match(html, /name="destinationProductId" required=""/);
    assert.match(html, /TRV-DST · DST-01 — Destination stock/);
    assert.doesNotMatch(html, /SL-19|Other type product/);
    assert.match(html, /name="destinationMakLotNumber" required=""/);
    assert.match(html, /name="transferDate" type="date" required=""/);
    assert.match(html, /name="quantity" type="number" min="0" step="any" required=""/);
    assert.doesNotMatch(html, /value="17">TRV-SRC/);
  } finally {
    await vite.close();
  }
});

test('transfer history lists direction, source lot, destination MAK lot, and actor', async () => {
  const vite = await createServer({ optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: { server: createHttpServer() }, watch: null }, appType: 'custom' });
  try {
    const { default: TransferHistoryTable } = await vite.ssrLoadModule('/src/components/TransferHistoryTable.jsx');
    const html = renderToStaticMarkup(createElement(TransferHistoryTable, { rows: [{
      id: 4, date: '2026-11-12', quantity: 5, direction: 'in', sourceMaterialLotNumber: null,
      destinationMakLotNumber: 'TRV-MAK-9', sourceProductName: source.name, sourceItemCode: source.itemCode,
      destinationProductName: destination.name, destinationItemCode: destination.itemCode, addedBy: 'Test Admin',
    }] }));
    assert.match(html, /Transfer history/);
    assert.match(html, />In<\/td>/);
    assert.match(html, /Source stock · SRC-01/);
    assert.match(html, /Unassigned \(N\/A\)/);
    assert.match(html, /TRV-MAK-9/);
    assert.match(html, /Test Admin/);
  } finally {
    await vite.close();
  }
});
