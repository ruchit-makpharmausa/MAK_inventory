import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { createProductHistoryWorkbook, productHistoryFilename } from '../src/lib/product-history-workbook.js';
import { productHistoryEntries } from '../src/lib/product-history-report.js';

const product = { id: 1, name: 'Qunol Ultra CoQ10 100mg 30ct - IFC', itemCode: '000123', makItemCode: 'MAK-001', unit: 'Pcs' };
const receipt = (values = {}) => ({ id: 1, date: '2026-10-12', quantity: 3600, location: 'A2A', makReleaseNumber: 'RN-001', materialLotNumber: 'REC-MAT-001', remarks: 'Received stock', ...values });
const usage = (values = {}) => ({ id: 1, date: '2026-10-13', quantity: 3600, makLotNumber: '0826083', materialLotNumber: 'USE-MAT-001', remarks: 'Production use', ...values });
const noteText = (cell) => typeof cell.note === 'string' ? cell.note : (cell.note?.texts || []).map((part) => part.text).join('');

async function roundTrip(history) {
  const workbook = await createProductHistoryWorkbook(history);
  const read = new ExcelJS.Workbook();
  await read.xlsx.load(await workbook.xlsx.writeBuffer());
  return read;
}

test('selected-product export includes receiving location in its ledger', async () => {
  const history = {
    product,
    receiving: [receipt({ id: 2, date: '2026-10-15', quantity: 1000 }), receipt()],
    usage: [usage({ id: 2, date: '2026-10-14', makLotNumber: '0926103', quantity: 29743 }), usage()],
  };
  const original = JSON.stringify(history);
  const workbook = await roundTrip(history);
  assert.equal(workbook.worksheets.length, 1);
  const sheet = workbook.getWorksheet('Product History');
  assert.deepEqual(sheet.getRow(1).values.slice(1), ['Date', 'Material Lot Number', 'Location', 'Item/Description', 'Qty', 'Used Qty', 'Used Against(MAK Lot No)']);
  assert.equal(sheet.columnCount, 7);
  assert.equal(sheet.rowCount, 5);
  assert.equal(sheet.views[0].ySplit, 1);
  assert.equal(sheet.getCell('A2').type, ExcelJS.ValueType.Date);
  assert.equal(sheet.getCell('A2').value.toISOString(), '2026-10-12T00:00:00.000Z');
  assert.equal(sheet.getCell('A2').numFmt, 'm/d/yy');
  assert.equal(sheet.getCell('B2').value, 'REC-MAT-001');
  assert.equal(sheet.getCell('B3').value, 'USE-MAT-001');
  assert.equal(sheet.getCell('C2').value, 'A2A');
  assert.equal(sheet.getCell('D2').value, product.name);
  assert.equal(sheet.getCell('E2').value, 3600);
  assert.equal(sheet.getCell('F2').value, null);
  assert.equal(sheet.getCell('D2').font.bold, true);
  assert.equal(sheet.getCell('E2').alignment.horizontal, 'right');
  assert.equal(sheet.getCell('E2').numFmt, '#,##0');
  assert.equal(sheet.getCell('A3').value.toISOString().slice(0, 10), '2026-10-13');
  assert.equal(sheet.getCell('D3').text, '');
  assert.equal(sheet.getCell('E3').value, null);
  assert.equal(sheet.getCell('F3').value, 3600);
  assert.equal(sheet.getCell('G3').value, '#0826083');
  assert.equal(sheet.getCell('F3').font.color.argb, 'FFFF0000');
  assert.equal(sheet.getCell('G3').font.color.argb, 'FFFF0000');
  assert.equal(sheet.getCell('F3').alignment.horizontal, 'right');
  assert.equal(sheet.getCell('G4').value, '#0926103');
  assert.equal(sheet.getCell('E5').value, 1000);
  assert.match(noteText(sheet.getCell('D2')), /MAK Release Number: RN-001/);
  assert.match(noteText(sheet.getCell('D2')), /Material lot number: REC-MAT-001/);
  assert.match(noteText(sheet.getCell('G3')), /Material lot number: USE-MAT-001/);
  assert.match(noteText(sheet.getCell('D2')), /Remarks: Received stock/);
  assert.match(noteText(sheet.getCell('G3')), /Remarks: Production use/);
  assert.match(noteText(sheet.getCell('D1')), /Item Code: 000123/);
  assert.match(noteText(sheet.getCell('D1')), /MAK Item Code: MAK-001/);
  for (const address of ['E1', 'F1']) assert.equal(noteText(sheet.getCell(address)), 'Unit: Pcs');
  assert.ok(sheet.getRow(1).height >= 36);
  for (let row = 1; row <= sheet.rowCount; row++) {
    for (let column = 1; column <= sheet.columnCount; column++) assert.equal(sheet.getRow(row).getCell(column).font.size, 12);
    if (row > 1) assert.ok(sheet.getRow(row).height >= 20);
  }
  for (const column of [2, 3, 4, 7]) assert.equal(sheet.getColumn(column).alignment.wrapText, true);
  assert.equal(JSON.stringify(history), original);
});

test('product history exports transfer-in and transfer-out quantities as explicit balance movements', async () => {
  const history = {
    product,
    receiving: [], usage: [],
    transfers: [
      { id: 8, direction: 'in', date: '2026-10-12', quantity: 4, sourceProductName: 'Source item', sourceItemCode: 'SRC', destinationMakLotNumber: 'TRV-LOT-8', addedBy: 'Admin' },
      { id: 9, direction: 'out', date: '2026-10-13', quantity: 2, sourceMaterialLotNumber: 'SRC-LOT', destinationProductName: 'Target item', destinationItemCode: 'DST', destinationMakLotNumber: 'TRV-LOT-9', addedBy: 'Admin' },
    ],
  };
  const workbook = await roundTrip(history);
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.getCell('D2').value, 'Transfer in from Source item · MAK lot TRV-LOT-8');
  assert.equal(sheet.getCell('E2').value, 4);
  assert.equal(sheet.getCell('D3').value, 'Transfer out to Target item · MAK lot TRV-LOT-9');
  assert.equal(sheet.getCell('F3').value, 2);
  assert.equal(sheet.getCell('G3').value, '#TRV-LOT-9');
  assert.match(noteText(sheet.getCell('D2')), /Inventory transfer #8/);
  assert.match(noteText(sheet.getCell('G3')), /Inventory transfer #9/);
});

test('same-day transactions are stable, quantities stay numeric, and lot prefixes are not duplicated', async () => {
  const day = '2026-10-12';
  const workbook = await roundTrip({
    product: { ...product, name: '=Literal description' },
    receiving: [receipt({ id: 2, quantity: 12.5 }), receipt({ id: 1, quantity: '10' })],
    usage: [usage({ id: 9, date: day, quantity: 0.125, makLotNumber: 'Lot # 00002' }), usage({ id: 8, date: day, quantity: 0.5, makLotNumber: '00001' })],
  });
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.getCell('D2').type, ExcelJS.ValueType.String);
  assert.equal(sheet.getCell('D2').formula, undefined);
  assert.equal(sheet.getCell('E2').value, 10);
  assert.equal(sheet.getCell('E3').value, 12.5);
  assert.equal(sheet.getCell('G4').value, '#00001');
  assert.equal(sheet.getCell('F5').value, 0.125);
  assert.equal(sheet.getCell('G5').value, '#00002');
});

test('MAK lot numbers use a single hash prefix without changing stored identifiers', async () => {
  const lots = ['M12345', '#M12345', ' Lot # M12345 ', '###M12345', 'Lot # #M12345', '000123', '', null];
  const history = { product, receiving: [], usage: lots.map((makLotNumber, index) => usage({ id: index + 1, makLotNumber })) };
  const original = JSON.stringify(history);
  const workbook = await roundTrip(history);
  const sheet = workbook.worksheets[0];
  const values = lots.map((_, index) => sheet.getCell(`G${index + 2}`).text);
  assert.deepEqual(values, ['#M12345', '#M12345', '#M12345', '#M12345', '#M12345', '#000123', '', '']);
  assert.equal(JSON.stringify(history), original);
});

test('empty histories and missing optional metadata still export correctly', async () => {
  const empty = await roundTrip({ product, receiving: [], usage: [] });
  assert.equal(empty.worksheets[0].rowCount, 1);
  const missing = await roundTrip({ product: { name: 'Product' }, receiving: [], usage: [usage({ makLotNumber: null, remarks: null })] });
  assert.equal(missing.worksheets[0].getCell('G2').text, '');
});

test('material lots map to one column with N/A only for missing usage lots', async () => {
  const lots = [undefined, null, '', '   ', '0000123', '=1+1', 0];
  const history = {
    product,
    receiving: lots.map((materialLotNumber, index) => receipt({ id: index + 1, materialLotNumber })),
    usage: lots.map((materialLotNumber, index) => usage({ id: index + 1, materialLotNumber })),
  };
  const original = JSON.stringify(history);
  const entries = productHistoryEntries(history);
  assert.deepEqual(entries.filter((entry) => entry.receiving).map((entry) => entry.materialLotNumber), ['', '', '', '', '0000123', '=1+1', '0']);
  assert.ok(entries.filter((entry) => entry.receiving).every((entry) => entry.location === 'A2A'));
  assert.ok(entries.filter((entry) => !entry.receiving).every((entry) => entry.location === ''));
  assert.deepEqual(entries.filter((entry) => !entry.receiving).map((entry) => entry.materialLotNumber), ['N/A', 'N/A', 'N/A', 'N/A', '0000123', '=1+1', '0']);
  assert.ok(entries.filter((entry) => entry.receiving).every((entry) => entry.releaseNumber === 'RN-001' && entry.notes.includes('MAK Release Number: RN-001')));
  assert.ok(entries.filter((entry) => !entry.receiving).every((entry) => entry.releaseNumber === '' && entry.usedAgainst === '#0826083'));
  const sheet = (await roundTrip(history)).worksheets[0];
  assert.equal(sheet.columnCount, 7);
  assert.equal(sheet.rowCount, 15);
  assert.deepEqual(lots.map((_, index) => sheet.getCell(`B${index + 2}`).text), ['', '', '', '', '0000123', '=1+1', '0']);
  assert.deepEqual(lots.map((_, index) => sheet.getCell(`B${index + 9}`).text), ['N/A', 'N/A', 'N/A', 'N/A', '0000123', '=1+1', '0']);
  assert.equal(sheet.getCell('B7').formula, undefined);
  assert.equal(sheet.getCell('B14').formula, undefined);
  assert.equal(JSON.stringify(history), original);
});

test('larger workbook fonts retain wrapped long material lots and descriptions without short rows', async () => {
  const materialLotNumber = 'LONG-MATERIAL-LOT-'.repeat(12);
  const sheet = (await roundTrip({
    product: { ...product, name: 'Long product description '.repeat(10) },
    receiving: [receipt({ materialLotNumber })], usage: [usage({ materialLotNumber })],
  })).worksheets[0];
  for (const row of [2, 3]) {
    assert.equal(sheet.getCell(`B${row}`).value, materialLotNumber);
    assert.equal(sheet.getCell(`B${row}`).font.size, 12);
    assert.equal(sheet.getCell(`B${row}`).alignment.wrapText, true);
    assert.ok(sheet.getRow(row).height >= 18 * Math.ceil(materialLotNumber.length / (sheet.getColumn(2).width * 0.8)));
  }
  assert.match(noteText(sheet.getCell('D2')), /MAK Release Number: RN-001/);
});

test('invalid dates and non-finite quantities fail instead of producing misleading reports', async () => {
  await assert.rejects(createProductHistoryWorkbook(null), /Select a product/);
  for (const date of ['2026-02-30', 'invalid', undefined]) {
    await assert.rejects(createProductHistoryWorkbook({ product, receiving: [receipt({ date })], usage: [] }), /invalid transaction date/);
  }
  await assert.rejects(createProductHistoryWorkbook({ product, receiving: [], usage: [usage({ quantity: Infinity })] }), /finite numbers/);
});

test('history filenames identify the product and are safe for Windows downloads', () => {
  assert.equal(productHistoryFilename(product), 'inventory-history-000123.xlsx');
  const filename = productHistoryFilename({ itemCode: 'A/B:C?D\\E*F"<G>|' });
  assert.doesNotMatch(filename, /[<>:"/\\|?*]/);
  assert.match(filename, /^inventory-history-.*\.xlsx$/);
  assert.equal(productHistoryFilename({}), 'inventory-history-product.xlsx');
});
