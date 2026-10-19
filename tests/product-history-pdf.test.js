import assert from 'node:assert/strict';
import test from 'node:test';
import { createProductHistoryPdf } from '../src/lib/product-history-pdf.js';
import { productHistoryFilename, productHistoryHeaders } from '../src/lib/product-history-report.js';

const product = { name: 'Selected product - IFC', itemCode: '000123', makItemCode: 'MAK-001', unit: 'Pcs' };
const receipt = { id: 1, date: '2026-10-12', quantity: 3600 };
const usage = { id: 1, date: '2026-10-13', quantity: 100.125, makLotNumber: 'M12345' };

test('product PDF preserves ledger columns, chronological data, quantities and lot styling', async () => {
  const history = { product, receiving: [receipt], usage: [usage] };
  const original = JSON.stringify(history);
  const doc = await createProductHistoryPdf(history);
  const output = doc.output();
  assert.ok(output.startsWith('%PDF-'));
  assert.match(output, /%%EOF\s*$/);
  const table = doc.lastAutoTable;
  assert.equal(table.columns.length, 5);
  const keys = ['date', 'description', 'receivedQuantity', 'usedQuantity', 'usedAgainst'];
  assert.deepEqual(keys.map((key) => table.head[0].cells[key].text.join(' ')), productHistoryHeaders);
  assert.equal(table.body.length, 2);
  assert.equal(table.body[0].cells.date.text.join(''), '10/12/26');
  assert.equal(table.body[0].raw.description, product.name);
  assert.equal(table.body[0].cells.receivedQuantity.text.join(''), '3,600');
  assert.equal(table.body[0].cells.receivedQuantity.styles.halign, 'right');
  assert.equal(table.body[0].cells.description.styles.fontStyle, 'bold');
  assert.equal(table.body[1].cells.usedQuantity.text.join(''), '100.125');
  assert.equal(table.body[1].cells.usedAgainst.text.join(''), '#M12345');
  assert.deepEqual(table.body[1].cells.usedAgainst.styles.textColor, [220, 0, 0]);
  assert.ok(output.includes('Item Code: 000123'));
  assert.ok(output.includes('MAK Item Code: MAK-001'));
  assert.ok(output.includes('Page 1 of 1'));
  assert.equal(JSON.stringify(history), original);
});

test('PDF includes transaction notes and preserves RN numbers and remarks', async () => {
  const doc = await createProductHistoryPdf({
    product,
    receiving: [{ ...receipt, materialLotNumber: 'RN-001', remarks: 'Receipt note' }],
    usage: [{ ...usage, remarks: 'Usage note' }],
  });
  const output = doc.output();
  assert.ok(output.includes('Transaction Notes'));
  assert.ok(output.includes('MAK RN Number: RN-001'));
  assert.ok(output.includes('Receipt note'));
  assert.ok(output.includes('Usage note'));
  assert.ok(output.includes('#M12345'));
});

test('long PDF histories repeat report and table headers and number every page', async () => {
  const doc = await createProductHistoryPdf({
    product, receiving: [receipt],
    usage: Array.from({ length: 160 }, (_, index) => ({ ...usage, id: index + 1, makLotNumber: `M${String(index).padStart(5, '0')}` })),
  });
  const pages = doc.internal.getNumberOfPages();
  assert.ok(pages > 1);
  const output = doc.output();
  assert.ok((output.match(/\(Inventory History\)/g) || []).length >= pages);
  assert.ok((output.match(/Item\/Description/g) || []).length >= pages);
  for (let page = 1; page <= pages; page++) assert.ok(output.includes(`Page ${page} of ${pages}`));
  assert.ok(output.includes('#M00159'));
});

test('empty PDF reports are downloadable and invalid histories fail clearly', async () => {
  const doc = await createProductHistoryPdf({ product, receiving: [], usage: [] });
  assert.ok(doc.output().includes('No transactions recorded for this product.'));
  const blob = doc.output('blob');
  assert.equal(blob.type, 'application/pdf');
  assert.ok(blob.size > 0);
  assert.equal(productHistoryFilename(product, 'pdf'), 'inventory-history-000123.pdf');
  assert.throws(() => productHistoryFilename(product, '../bad'), /Unsupported/);
  await assert.rejects(createProductHistoryPdf(null), /Select a product/);
  await assert.rejects(createProductHistoryPdf({ product, receiving: [{ ...receipt, date: '2026-02-30' }], usage: [] }), /invalid transaction date/);
});
