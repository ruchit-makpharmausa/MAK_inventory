import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer as createHttpServer } from 'node:http';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { inventoryHistoryRows } from '../src/lib/csv.js';
import { quantity } from '../src/lib/format.js';

const receiving = { id: 1, date: '2026-10-01', materialLotNumber: 'RN-2026-001', quantity: 100000, remarks: 'Received' };
const usage = { id: 2, date: '2026-10-08', materialLotNumber: 'HIDDEN-MATERIAL-LOT', makLotNumber: 'M1234', quantity: 2500, remarks: 'Used' };

test('history tables keep four matching columns and aligned quantity headers', async (t) => {
  const vite = await createServer({ server: { middlewareMode: true, hmr: { server: createHttpServer() }, watch: null }, appType: 'custom' });
  try {
    const { default: HistoryTable } = await vite.ssrLoadModule('/src/components/HistoryTable.jsx');
    const render = (row, receiving) => renderToStaticMarkup(createElement(HistoryTable, {
      title: receiving ? 'Receiving history' : 'Usage history', subtitle: '', rows: row ? [row] : [], receiving,
    }));
    await t.test('receiving shows the existing reference as MAK RN Number', () => {
      const html = render(receiving, true);
      assert.match(html, /<th scope="col">MAK RN Number<\/th>/);
      assert.match(html, /RN-2026-001/);
      assert.doesNotMatch(html, /Material lot number/);
      assert.match(html, /<th scope="col" class="numeric">Received quantity<\/th>/);
      assert.ok(html.includes(`<td class="numeric">${quantity(receiving.quantity)}</td>`));
    });
    await t.test('usage omits material lot but retains MAK lot number and quantity', () => {
      const html = render(usage, false);
      assert.match(html, /<th scope="col">MAK lot number<\/th>/);
      assert.match(html, /M1234/);
      assert.doesNotMatch(html, /Material lot number|HIDDEN-MATERIAL-LOT|MAK RN Number/);
      assert.match(html, /<th scope="col" class="numeric">Used quantity<\/th>/);
      assert.ok(html.includes(`<td class="numeric">${quantity(usage.quantity)}</td>`));
    });
    await t.test('both tables use the same quantity position and width classes', () => {
      for (const html of [render(receiving, true), render(usage, false)]) {
        assert.equal((html.match(/<th\b/g) || []).length, 4);
        assert.equal((html.match(/<td\b/g) || []).length, 4);
        assert.match(html, /<col class="history-date-column"\/><col class="history-reference-column"\/><col class="history-quantity-column"\/><col class="history-remarks-column"\/>/);
      }
    });
    await t.test('empty histories and missing optional references remain readable', () => {
      assert.match(render(null, true), /No receiving records for this product/);
      assert.match(render(null, false), /No usage records for this product/);
      assert.match(render({ ...receiving, materialLotNumber: null, remarks: null }, true), /—/);
    });
  } finally {
    await vite.close();
  }
});

test('history CSV uses the stored receiving reference and leaves the usage RN column empty', () => {
  assert.deepEqual(inventoryHistoryRows({ receiving: [receiving], usage: [usage] }), [
    ['Receiving', '2026-10-01', 'RN-2026-001', '', 100000, 'Received'],
    ['Usage', '2026-10-08', '', 'M1234', 2500, 'Used'],
  ]);
  assert.deepEqual(inventoryHistoryRows({ receiving: [], usage: [] }), []);
});
