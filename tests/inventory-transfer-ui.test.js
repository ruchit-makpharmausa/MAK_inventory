import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer as createHttpServer } from 'node:http';
import { isFinishedGoodsType } from '../src/lib/product-type.js';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const source = { id: 17, productTypeId: 1, productType: 'Bulk', name: 'Source stock', itemCode: 'SRC-01', makItemCode: 'TRV-SRC', unit: 'Pcs', availableBalance: 12 };
const destination = { id: 18, productTypeId: 1, productType: 'Bulk', name: 'Destination stock', itemCode: 'DST-01', makItemCode: 'TRV-DST', unit: 'Pcs', availableBalance: 3 };

test('transfer dialog selects a source lot, quantity, date, and compatible destination product', async () => {
  const vite = await createServer({ optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: { server: createHttpServer() }, watch: null }, appType: 'custom' });
  try {
    const { default: TransferDialog } = await vite.ssrLoadModule('/src/components/TransferDialog.jsx');
    const otherTypeProduct = { ...destination, id: 19, productTypeId: 2, productType: 'Sleeve', itemCode: 'SL-19', name: 'Other type product' };
    const html = renderToStaticMarkup(createElement(TransferDialog, {
      sourceProduct: source, products: [source, destination, otherTypeProduct], onClose() {}, onSaved() {},
    }));
    assert.match(html, /Transfer a lot/);
    assert.match(html, /From: TRV-SRC/);
    assert.match(html, /Available in this product: 12 Pcs/);
    assert.match(html, /name="sourceMaterialLotNumber" required=""/);
    assert.match(html, /Select source lot/);
    assert.match(html, /Loading available lots for this product/);
    assert.match(html, /name="destinationProductId" required=""/);
    assert.match(html, /TRV-DST · Destination stock \(DST-01\)/);
    assert.doesNotMatch(html, /SL-19|Other type product/);
    assert.match(html, /name="transferDate" type="date" required=""/);
    assert.match(html, /name="quantity" type="number" min="0" step="any" required=""/);
    assert.match(html, /Transfer quantity/);
    assert.doesNotMatch(html, /destinationMakLotNumber/);
  } finally {
    await vite.close();
  }
});

test('finished-goods shipment selects one lot for the SKU and asks for date and quantity', async () => {
  const vite = await createServer({ optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: { server: createHttpServer() }, watch: null }, appType: 'custom' });
  try {
    const { default: ShipmentDialog } = await vite.ssrLoadModule('/src/components/ShipmentDialog.jsx');
    const html = renderToStaticMarkup(createElement(ShipmentDialog, { product: { ...source, productType: 'Finished Goods' }, onClose() {}, onSaved() {} }));
    assert.match(html, /Ship finished goods/);
    assert.match(html, /matching zero-stock item is automatically created or reused in Shipped Products/);
    assert.match(html, /name="sourceMaterialLotNumber" required=""/);
    assert.match(html, /Select a lot for this SKU/);
    assert.match(html, /Loading available lots for this SKU/);
    assert.match(html, /name="shipmentDate" type="date" required=""/);
    assert.match(html, /name="quantity" type="number" min="0" step="any" required=""/);
    assert.doesNotMatch(html, /shippedProductId|customer|order/i);
  } finally {
    await vite.close();
  }
});

test('MAK finished-product category name enables the shipment action', () => {
  assert.equal(isFinishedGoodsType('FINISHED PRODUCT'), true);
  assert.equal(isFinishedGoodsType('Finished Goods'), true);
  assert.equal(isFinishedGoodsType('Bulk'), false);
});

test('transfer history lists direction, source lot, destination MAK lot, and actor', async () => {
  const vite = await createServer({ optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: { server: createHttpServer() }, watch: null }, appType: 'custom' });
  try {
    const { default: TransferHistoryTable } = await vite.ssrLoadModule('/src/components/TransferHistoryTable.jsx');
    const html = renderToStaticMarkup(createElement(TransferHistoryTable, { rows: [{
      id: 4, date: '2026-11-12', quantity: 5, direction: 'in', sourceMaterialLotNumber: null,
      destinationMaterialLotNumber: 'MATERIAL-9',
      destinationMakLotNumber: 'TRV-MAK-9', sourceProductName: source.name, sourceItemCode: source.itemCode, sourceMakItemCode: source.makItemCode,
      destinationProductName: destination.name, destinationItemCode: destination.itemCode, destinationMakItemCode: destination.makItemCode, addedBy: 'Test Admin',
    }] }));
    assert.match(html, /Transfer history/);
    assert.match(html, />In<\/td>/);
    assert.match(html, /Source stock · TRV-SRC \(SRC-01\)/);
    assert.match(html, /Unassigned \(N\/A\)/);
    assert.match(html, /MATERIAL-9/);
    assert.match(html, /TRV-DST/);
    assert.match(html, /Test Admin/);
  } finally {
    await vite.close();
  }
});
