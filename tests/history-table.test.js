import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer as createHttpServer } from 'node:http';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { inventoryHistoryRows } from '../src/lib/csv.js';
import { quantity } from '../src/lib/format.js';

const receiving = { id: 1, date: '2026-10-01', location: 'A2A', makReleaseNumber: 'RN-2026-001', materialLotNumber: 'RECEIVED-MAT-LOT', quantity: 100000, remarks: 'Received' };
const usage = { id: 2, date: '2026-10-08', materialLotNumber: 'USED-MAT-LOT', makLotNumber: 'M1234', quantity: 2500, remarks: 'Used' };

test('receiving history adds location while keeping quantity headers aligned', async (t) => {
  const vite = await createServer({ optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: { server: createHttpServer() }, watch: null }, appType: 'custom' });
  try {
    const { default: HistoryTable } = await vite.ssrLoadModule('/src/components/HistoryTable.jsx');
    const render = (row, receiving, isAdmin = false) => renderToStaticMarkup(createElement(HistoryTable, {
      title: receiving ? 'Receiving history' : 'Usage history', subtitle: '', rows: row ? [row] : [], receiving,
      isAdmin, onEdit() {},
    }));
    await t.test('receiving shows the existing reference as MAK Release Number', () => {
      const html = render(receiving, true);
      assert.match(html, /<th scope="col">Location<\/th>/);
      assert.match(html, /<td>A2A<\/td>/);
      assert.match(html, /<th scope="col">MAK Release Number<\/th>/);
      assert.match(html, /RN-2026-001/);
      assert.match(html, /Material lot number: RECEIVED-MAT-LOT/);
      assert.match(html, /<th scope="col" class="numeric">Received quantity<\/th>/);
      assert.ok(html.includes(`<td class="numeric">${quantity(receiving.quantity)}</td>`));
      const adminHtml = render(receiving, true, true);
      assert.match(adminHtml, /<th scope="col">Actions<\/th>/);
      assert.match(adminHtml, />Edit<\/button>/);
    });
    await t.test('usage shows optional material lot alongside MAK lot number and quantity', () => {
      const html = render(usage, false);
      assert.match(html, /<th scope="col">MAK lot number<\/th>/);
      assert.match(html, /M1234/);
      assert.match(html, /Material lot number: USED-MAT-LOT/);
      assert.doesNotMatch(html, /MAK Release Number/);
      assert.match(html, /<th scope="col" class="numeric">Used quantity<\/th>/);
      assert.ok(html.includes(`<td class="numeric">${quantity(usage.quantity)}</td>`));
    });
    await t.test('receiving adds a location column while usage retains its existing table shape', () => {
      const receivingHtml = render(receiving, true);
      const usageHtml = render(usage, false);
      assert.equal((receivingHtml.match(/<th\b/g) || []).length, 5);
      assert.equal((receivingHtml.match(/<td\b/g) || []).length, 5);
      assert.match(receivingHtml, /<col class="history-date-column"\/><col class="history-location-column"\/><col class="history-reference-column"\/><col class="history-quantity-column"\/><col class="history-remarks-column"\/>/);
      assert.equal((usageHtml.match(/<th\b/g) || []).length, 4);
      assert.equal((usageHtml.match(/<td\b/g) || []).length, 4);
      assert.match(usageHtml, /<col class="history-date-column"\/><col class="history-reference-column"\/><col class="history-quantity-column"\/><col class="history-remarks-column"\/>/);
    });
    await t.test('empty histories and missing optional references remain readable', () => {
      assert.match(render(null, true), /No receiving records for this product/);
      assert.match(render(null, false), /No usage records for this product/);
      const missing = render({ ...receiving, makReleaseNumber: null, materialLotNumber: null, remarks: null }, true);
      assert.match(missing, /—/);
      assert.doesNotMatch(missing, /Material lot number:/);
      assert.doesNotMatch(render({ ...usage, materialLotNumber: null }, false), /Material lot number:/);
    });
  } finally {
    await vite.close();
  }
});

test('history CSV uses the stored receiving reference and leaves the usage release-number column empty', () => {
  assert.deepEqual(inventoryHistoryRows({ receiving: [receiving], usage: [usage] }), [
    ['Receiving', '2026-10-01', 'A2A', 'RN-2026-001', '', 100000, 'Received'],
    ['Usage', '2026-10-08', '', '', 'M1234', 2500, 'Used'],
  ]);
  assert.deepEqual(inventoryHistoryRows({ receiving: [], usage: [] }), []);
});
