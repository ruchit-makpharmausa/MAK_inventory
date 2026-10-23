import assert from 'node:assert/strict';
import test from 'node:test';
import { createProductHistoryPdf } from '../src/lib/product-history-pdf.js';
import { productHistoryFilename } from '../src/lib/product-history-report.js';

const product = { name: 'Selected product - IFC', itemCode: '000123', makItemCode: 'MAK-001', productType: 'IFC', unit: 'Pcs' };
const receipt = { id: 1, date: '2026-10-12', quantity: 3600 };
const usage = { id: 1, date: '2026-10-13', quantity: 100.125, makLotNumber: 'M12345' };

test('product PDF preserves ledger columns, chronological data, quantities and lot styling', async () => {
  const history = { product: { ...product, availableBalance: 999 }, receiving: [{ ...receipt, makReleaseNumber: '000RN-01' }], usage: [usage] };
  const original = JSON.stringify(history);
  const doc = await createProductHistoryPdf(history);
  const output = doc.output();
  assert.ok(output.startsWith('%PDF-'));
  assert.match(output, /%%EOF\s*$/);
  const table = doc.lastAutoTable;
  assert.equal(table.columns.length, 7);
  const keys = ['date', 'materialLotNumber', 'releaseNumber', 'description', 'receivedQuantity', 'usedQuantity', 'usedAgainst'];
  assert.deepEqual(keys.map((key) => table.head[0].cells[key].text.join(' ')),
    ['Date', 'Material Lot Number', 'MAK Release Number', 'Item/Description', 'Qty', 'Used Qty', 'Used Against(MAK Lot No)']);
  assert.equal(table.body.length, 2);
  assert.equal(table.body[0].cells.date.text.join(''), '10/12/26');
  assert.equal(table.body[0].cells.materialLotNumber.text.join(''), '');
  assert.equal(table.body[1].cells.materialLotNumber.text.join(''), 'N/A');
  assert.equal(table.body[0].cells.date.styles.fontSize, 10);
  assert.equal(table.body[0].cells.releaseNumber.text.join(''), '000RN-01');
  assert.equal(table.body[1].cells.releaseNumber.text.join(''), '');
  assert.equal(table.body[0].raw.description, product.name);
  assert.equal(table.body[0].cells.receivedQuantity.text.join(''), '3,600');
  assert.equal(table.body[0].cells.receivedQuantity.styles.halign, 'right');
  assert.equal(table.body[0].cells.description.styles.fontStyle, 'bold');
  assert.equal(table.body[1].cells.usedQuantity.text.join(''), '100.125');
  assert.equal(table.body[1].cells.usedAgainst.text.join(''), '#M12345');
  assert.deepEqual(table.body[1].cells.usedAgainst.styles.textColor, [220, 0, 0]);
  assert.ok(output.includes('Item Code: 000123'));
  assert.ok(output.includes('MAK Item Code: MAK-001'));
  assert.ok(output.includes('Product Type: IFC'));
  assert.ok(output.includes('MAK Pharma USA'));
  assert.ok(output.includes('8 Middlebury Blvd, Randolph, NJ - 07869'));
  assert.ok(output.includes('makpharmausa.com'));
  assert.equal(table.foot[0].cells[0].text.join(''), 'Closing balance');
  assert.equal(table.foot[0].cells[5].text.join(''), '3,499.875 Pcs');
  assert.deepEqual(table.foot[0].cells[5].styles.textColor, [22, 122, 74]);
  assert.deepEqual(table.foot[0].cells[5].styles.fillColor, [235, 247, 239]);
  assert.equal(table.foot[0].cells[5].styles.halign, 'right');
  assert.ok(output.includes('Page 1 of 1'));
  assert.equal(JSON.stringify(history), original);
});

test('PDF places receiving release numbers in the ledger and omits all transaction notes', async () => {
  const doc = await createProductHistoryPdf({
    product,
    receiving: [{ ...receipt, makReleaseNumber: 'RN-001', materialLotNumber: 'REC-MAT-001', remarks: 'Receipt note' }],
    usage: [{ ...usage, materialLotNumber: 'USE-MAT-001', remarks: 'Usage note' }],
  });
  const output = doc.output();
  assert.equal(doc.lastAutoTable.body[0].cells.releaseNumber.text.join(''), 'RN-001');
  assert.equal(doc.lastAutoTable.body[0].cells.materialLotNumber.text.join(''), 'REC-MAT-001');
  assert.equal(doc.lastAutoTable.body[1].cells.materialLotNumber.text.join(''), 'USE-MAT-001');
  assert.equal(doc.lastAutoTable.body[1].cells.releaseNumber.text.join(''), '');
  assert.doesNotMatch(output, /Transaction Notes|MAK Release Number:|Material lot number:|Receipt note|Usage note/);
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
  for (let page = 1; page <= pages; page++) {
    assert.ok(output.includes(`Page ${page} of ${pages}`));
    const content = doc.internal.pages[page].join('\n');
    assert.ok(content.includes('(MAK Pharma USA)'));
    assert.ok(content.includes('(8 Middlebury Blvd, Randolph, NJ - 07869)'));
    assert.ok(content.includes('(makpharmausa.com)'));
    assert.ok(content.includes('(MAK Release') && content.includes('Number)'));
    assert.ok(content.includes('Material Lot Number'));
    assert.equal(content.includes('(Closing balance)'), page === pages);
  }
  assert.equal((output.match(/\(Closing balance\)/g) || []).length, 1);
  assert.ok(output.includes('#M00159'));
});

test('closing balance reflects the printed ledger, including fractional zero and negative balances', async () => {
  for (const [receiving, usageRows, expected] of [
    [[receipt], [], '3,600 Pcs'],
    [[], [usage], '-100.125 Pcs'],
    [[{ ...receipt, quantity: 0.3 }], [{ ...usage, quantity: 0.1 }, { ...usage, quantity: 0.2 }], '0 Pcs'],
  ]) {
    const doc = await createProductHistoryPdf({ product, receiving, usage: usageRows });
    assert.equal(doc.lastAutoTable.foot[0].cells[5].text.join(''), expected);
  }
  const noUnit = await createProductHistoryPdf({ product: { name: 'Sample' }, receiving: [receipt], usage: [] });
  assert.equal(noUnit.lastAutoTable.foot[0].cells[5].text.join(''), '3,600');
  await assert.rejects(createProductHistoryPdf({ product, receiving: [{ ...receipt, quantity: 1e308 }, { ...receipt, quantity: 1e308 }], usage: [] }), /Closing balance must be a finite number/);
});

test('release identifiers wrap without truncation and the final balance stays inside page margins', async () => {
  const releaseNumber = '000RN-'.repeat(40);
  const materialLotNumber = '000-MATERIAL-'.repeat(20);
  const doc = await createProductHistoryPdf({
    product: { ...product, name: 'A descriptive product name '.repeat(6) },
    receiving: [{ ...receipt, makReleaseNumber: releaseNumber, materialLotNumber }], usage: [usage],
  });
  const table = doc.lastAutoTable;
  assert.equal(table.body[0].cells.releaseNumber.text.join(''), releaseNumber);
  assert.equal(table.body[0].cells.materialLotNumber.text.join(''), materialLotNumber);
  assert.ok(table.body[0].cells.materialLotNumber.text.length > 1);
  assert.ok(table.body[0].cells.releaseNumber.text.length > 1);
  assert.equal(table.body[1].cells.releaseNumber.text.join(''), '');
  assert.ok(table.body[0].cells.date.y >= table.settings.margin.top);
  assert.ok(table.finalY <= doc.internal.pageSize.getHeight() - table.settings.margin.bottom);
  assert.equal(table.foot[0].cells[0].colSpan, 5);
  assert.equal(table.foot[0].cells[5].colSpan, 2);
});

test('empty PDF reports are downloadable and invalid histories fail clearly', async () => {
  const doc = await createProductHistoryPdf({ product, receiving: [], usage: [] });
  assert.ok(doc.output().includes('No transactions recorded for this product.'));
  assert.equal(doc.lastAutoTable.foot[0].cells[5].text.join(''), '0 Pcs');
  assert.doesNotMatch(doc.output(), /Transaction Notes/);
  const blob = doc.output('blob');
  assert.equal(blob.type, 'application/pdf');
  assert.ok(blob.size > 0);
  assert.equal(productHistoryFilename(product, 'pdf'), 'inventory-history-000123.pdf');
  assert.throws(() => productHistoryFilename(product, '../bad'), /Unsupported/);
  await assert.rejects(createProductHistoryPdf(null), /Select a product/);
  await assert.rejects(createProductHistoryPdf({ product, receiving: [{ ...receipt, date: '2026-02-30' }], usage: [] }), /invalid transaction date/);
});
