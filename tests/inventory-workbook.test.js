import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { createInventoryWorkbook, exportInventoryWorkbook } from '../src/lib/inventory-workbook.js';

const types = [
  { id: 1, name: 'Sleeve' }, { id: 2, name: 'IFC' }, { id: 3, name: 'Bulk' },
  { id: 4, name: 'Label' }, { id: 5, name: 'Carton' },
];

const headers = ['Product Name', 'Item Code', 'MAK Item Code', 'Total Received', 'Total Used', 'Available'];
const product = (values = {}) => ({
  name: 'Sample product', itemCode: '000123', makItemCode: 'MAK-001', productType: 'Sleeve',
  totalReceived: 100000, totalUsed: 2500, availableBalance: 97500, ...values,
});

async function roundTrip(products, catalogTypes = []) {
  const workbook = await createInventoryWorkbook(products, catalogTypes);
  const buffer = await workbook.xlsx.writeBuffer();
  const read = new ExcelJS.Workbook();
  await read.xlsx.load(buffer);
  return read;
}

test('Excel workbook has one sheet per registered type with the six requested columns', async () => {
  const workbook = await roundTrip([
    product({ productTypeId: 1, productType: ' Sleeve ', name: 'Sleeve product', totalReceived: '100000' }),
    product({ productTypeId: '1', productType: 'Sleeve', name: 'Another sleeve' }),
    product({ productTypeId: 2, productType: 'ifc', name: '=Literal product name', itemCode: '=A1', totalReceived: 12.5, totalUsed: 0.125, availableBalance: 12.375 }),
    product({ productTypeId: 3, productType: 'BULK', name: 'Bulk product', totalReceived: 0, totalUsed: 0, availableBalance: 0 }),
  ], types);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), types.map((type) => type.name));
  for (const sheet of workbook.worksheets) {
    assert.deepEqual(sheet.getRow(1).values.slice(1), headers);
    assert.equal(sheet.columnCount, 6);
    assert.equal(sheet.views[0].state, 'frozen');
    assert.equal(sheet.views[0].ySplit, 1);
    assert.equal(sheet.getCell('A1').font.bold, true);
    if (sheet.rowCount > 1) {
      assert.equal(sheet.getCell('D2').type, ExcelJS.ValueType.Number);
      assert.equal(sheet.getCell('D2').alignment.horizontal, 'right');
    }
  }
  const sleeve = workbook.getWorksheet('Sleeve');
  assert.equal(sleeve.rowCount, 3);
  assert.deepEqual(sleeve.getRow(2).values.slice(1), ['Sleeve product', '000123', 'MAK-001', 100000, 2500, 97500]);
  assert.equal(sleeve.getCell('B2').type, ExcelJS.ValueType.String);
  const ifc = workbook.getWorksheet('IFC');
  assert.deepEqual(ifc.getRow(2).values.slice(1), ['=Literal product name', '=A1', 'MAK-001', 12.5, 0.125, 12.375]);
  assert.equal(ifc.getCell('A2').type, ExcelJS.ValueType.String);
  assert.equal(ifc.getCell('B2').formula, undefined);
  assert.equal(workbook.getWorksheet('Bulk').getCell('F2').value, 0);
});

test('empty exports retain every registered type, with no hardcoded default worksheets', async () => {
  const configured = [{ id: 4, name: 'Label' }, { id: 6, name: 'New packaging type' }];
  const workbook = await roundTrip([], configured);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), configured.map((type) => type.name));
  for (const sheet of workbook.worksheets) {
    assert.equal(sheet.rowCount, 1);
    assert.deepEqual(sheet.getRow(1).values.slice(1), headers);
  }
});

test('additional product types are not dropped and receive unique valid sheet names', async () => {
  const types = [undefined, 'Other', 'Label/Box', 'Label?Box', 'A'.repeat(40), `${'A'.repeat(39)}B`, "'Quoted'", 'History', `${'B'.repeat(30)}'suffix`];
  const workbook = await roundTrip(types.map((productType, index) => product({ productType, name: `Product ${index}` })));
  assert.equal(workbook.worksheets.length, types.length - 1);
  const names = workbook.worksheets.map((sheet) => sheet.name);
  assert.equal(new Set(names.map((name) => name.toLowerCase())).size, names.length);
  for (const name of names) {
    assert.ok(name.length > 0 && name.length <= 31);
    assert.doesNotMatch(name, /[\\/?*[\]:]/);
    assert.ok(!name.startsWith("'") && !name.endsWith("'"));
  }
  const rows = workbook.worksheets.reduce((count, sheet) => count + sheet.rowCount - 1, 0);
  assert.equal(rows, types.length);
  assert.equal(workbook.getWorksheet('Other').rowCount, 3);
  assert.ok(workbook.getWorksheet('History Items'));
});

test('integer quantities use comma grouping without decimal points and zeros are only visually blank', async () => {
  const workbook = await roundTrip([
    product({ totalReceived: 100000, totalUsed: 0, availableBalance: 100000 }),
    product({ totalReceived: 12.5, totalUsed: 0.125, availableBalance: 12.375 }),
    product({ totalReceived: 0, totalUsed: 100000, availableBalance: -100000 }),
    product({ totalReceived: 0, totalUsed: 0.25, availableBalance: -0.25 }),
  ]);
  const sheet = workbook.getWorksheet('Sleeve');
  for (const address of ['D2', 'E2', 'F2', 'D4', 'E4', 'F4', 'D5']) {
    assert.equal(sheet.getCell(address).numFmt, '#,##0;-#,##0;;@');
    assert.doesNotMatch(sheet.getCell(address).numFmt, /\./);
  }
  for (const address of ['D3', 'E3', 'F3', 'E5', 'F5']) {
    assert.equal(sheet.getCell(address).numFmt, '#,##0.0##;-#,##0.0##;;@');
    assert.equal(sheet.getCell(address).numFmt.split(';')[2], '');
  }
  assert.equal(sheet.getCell('E2').value, 0);
  assert.equal(sheet.getCell('E2').type, ExcelJS.ValueType.Number);
  assert.equal(sheet.getCell('E2').numFmt.split(';')[2], '');
  assert.equal(sheet.getCell('D2').value, 100000);
  assert.equal(sheet.getCell('F4').value, -100000);
  assert.equal(sheet.getCell('F5').value, -0.25);
  assert.equal(sheet.getCell('F3').value, 12.375);
});

test('new and renamed catalog types determine worksheets by ID without merging similar type names', async () => {
  const configured = [{ id: 10, name: 'Sleeve' }, { id: 11, name: 'Sleeves' }, { id: 12, name: 'New type' }];
  const items = [product({ productTypeId: 10, productType: 'Old name', name: 'First' }),
    product({ productTypeId: '11', productType: 'Sleeves', name: 'Second' })];
  const original = JSON.stringify({ configured, items });
  const workbook = await roundTrip(items, configured);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['Sleeve', 'Sleeves', 'New type']);
  assert.equal(workbook.getWorksheet('Sleeve').getCell('A2').value, 'First');
  assert.equal(workbook.getWorksheet('Sleeves').getCell('A2').value, 'Second');
  assert.equal(workbook.getWorksheet('New type').rowCount, 1);
  assert.equal(JSON.stringify({ configured, items }), original);
  const renamed = await roundTrip(items, configured.map((type) => type.id === 10 ? { ...type, name: 'Renamed type' } : type));
  assert.equal(renamed.getWorksheet('Renamed type').getCell('A2').value, 'First');
});

test('configured types with colliding Excel names remain separate and an entirely empty system exports headers', async () => {
  const configured = [{ id: 1, name: 'Label/Box' }, { id: 2, name: 'Label?Box' }];
  const workbook = await roundTrip([], configured);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['Label-Box', 'Label-Box (2)']);
  const empty = await roundTrip([]);
  assert.deepEqual(empty.worksheets.map((sheet) => sheet.name), ['Inventory']);
  assert.deepEqual(empty.worksheets[0].getRow(1).values.slice(1), headers);
  const withoutMetadata = await roundTrip([product({ productType: 'Label' })]);
  assert.deepEqual(withoutMetadata.worksheets.map((sheet) => sheet.name), ['Label']);
});

test('dashboard download passes all registered types into the actual XLSX blob', async (t) => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  let blob;
  let clicked = false;
  const link = { click() { clicked = true; } };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => link } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { setTimeout: (callback) => callback() } });
  t.mock.method(URL, 'createObjectURL', (value) => { blob = value; return 'blob:workbook'; });
  const revoke = t.mock.method(URL, 'revokeObjectURL', () => {});
  try {
    await exportInventoryWorkbook([product({ productTypeId: 4, productType: 'Label', totalUsed: 0 })], types);
    assert.equal(clicked, true);
    assert.equal(link.download, 'mak-inventory-summary.xlsx');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await blob.arrayBuffer());
    assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), types.map((type) => type.name));
    assert.equal(workbook.getWorksheet('Label').getCell('E2').value, 0);
    assert.equal(workbook.getWorksheet('Label').getCell('E2').numFmt, '#,##0;-#,##0;;@');
    assert.equal(revoke.mock.callCount(), 1);
  } finally {
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else delete globalThis.document;
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else delete globalThis.window;
  }
});

test('missing optional values become empty strings or zeros; invalid quantities fail explicitly', async () => {
  const workbook = await roundTrip([product({ name: null, itemCode: null, makItemCode: null, totalReceived: null, totalUsed: undefined, availableBalance: null })]);
  const sheet = workbook.getWorksheet('Sleeve');
  assert.deepEqual([sheet.getCell('D2').value, sheet.getCell('E2').value, sheet.getCell('F2').value], [0, 0, 0]);
  for (const value of [NaN, Infinity, 'not-a-number']) {
    await assert.rejects(createInventoryWorkbook([product({ totalReceived: value })]), /finite numbers/);
  }
});
