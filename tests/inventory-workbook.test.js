import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { createInventoryWorkbook, exportInventoryWorkbook } from '../src/lib/inventory-workbook.js';

const types = [{ id: 1, name: 'Bulk' }, { id: 2, name: 'IFC' }, { id: 3, name: 'Label' }];
const headers = ['Product Name', 'Item Code', 'MAK Item Code', 'Lot Numbers', 'Total Received', 'Total Used', 'Balance'];
const product = (values = {}) => ({ id: 17, productTypeId: 1, productType: 'Bulk', name: 'Sample product',
  itemCode: '000123', makItemCode: 'TRV2583', unit: 'kgs', totalReceived: 0, totalUsed: 0, availableBalance: 0, ...values });
const roundTrip = async (products, catalogTypes = types, transactions = {}) => {
  const workbook = await createInventoryWorkbook(products, catalogTypes, transactions);
  const result = new ExcelJS.Workbook();
  await result.xlsx.load(await workbook.xlsx.writeBuffer());
  return result;
};

test('All-types dashboard export creates lot-wise rows and merges product identity across its lots', async () => {
  const workbook = await roundTrip([
    product({ totalReceived: 36, totalUsed: 9, availableBalance: 27 }),
    product({ id: 18, name: 'Second Bulk product', itemCode: '000124', makItemCode: 'TRV2584', totalReceived: 10, totalUsed: 0, availableBalance: 10 }),
    product({ id: 19, productTypeId: 2, productType: 'IFC', name: 'Shared MAK code IFC', makItemCode: 'TRV2583' }),
  ], types, {
    receiving: [
      { productId: 17, quantity: 30, materialLotNumber: '00123' },
      { productId: '17', quantity: 5, materialLotNumber: '00001' },
      { productId: 17, quantity: 5, materialLotNumber: '00123' },
      { productId: 17, quantity: 10, materialLotNumber: 'lot10' },
      { productId: 18, quantity: 10, materialLotNumber: 'ONLY-SECOND' },
      { productId: 19, quantity: 7, materialLotNumber: 'OTHER-TYPE' },
      { productId: 17, quantity: 1, materialLotNumber: 'N/A' },
      { productId: 17, quantity: 2, materialLotNumber: null },
      { productId: 19, quantity: 100, materialLotNumber: 'Orphan' },
    ],
    usage: [
      { productId: 17, quantity: 8, materialLotNumber: '00123' },
      { productId: 17, quantity: 1, materialLotNumber: 'lot10' },
      { productId: 18, quantity: 3, materialLotNumber: 'N/A' },
      { productId: 17, quantity: 4, materialLotNumber: null },
      { productId: 19, quantity: 2, materialLotNumber: 'OTHER-TYPE' },
    ],
  });
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['Bulk', 'IFC', 'Label']);
  const sheet = workbook.getWorksheet('Bulk');
  assert.deepEqual(sheet.getRow(1).values.slice(1), headers);
  assert.equal(sheet.views[0].ySplit, 1);
  assert.equal(sheet.rowCount, 8);
  assert.deepEqual([2, 3, 4, 5, 6, 7, 8].map((row) => sheet.getCell(`D${row}`).value),
    ['00001', '00123', 'lot10', 'N/A', 'Unassigned (N/A)', 'N/A', 'ONLY-SECOND']);
  assert.deepEqual([2, 3, 4, 5, 6, 7, 8].map((row) => [sheet.getCell(`E${row}`).value, sheet.getCell(`F${row}`).value, sheet.getCell(`G${row}`).value]),
    [[5, 0, 5], [35, 8, 27], [10, 1, 9], [1, 0, 1], [2, 4, -2], [0, 3, -3], [10, 0, 10]]);
  assert.deepEqual([sheet.getCell('A2').value, sheet.getCell('B2').value, sheet.getCell('C2').value], ['Sample product', '000123', 'TRV2583']);
  for (const address of ['A3', 'A4', 'A5', 'A6', 'B3', 'C3', 'B6']) assert.equal(sheet.getCell(address).isMerged, true);
  assert.deepEqual(Object.values(sheet._merges).map((merge) => merge.range).sort(), ['A2:A6', 'A7:A8', 'B2:B6', 'B7:B8', 'C2:C6', 'C7:C8']);
  assert.equal(sheet.getCell('G2').numFmt, '#,##0.###');
  assert.equal(sheet.getCell('E3').type, ExcelJS.ValueType.Number);
  assert.equal(sheet.getCell('B2').note, 'Item Code: 000123');
  assert.match(sheet.getCell('C2').note, /Unit: kgs/);
  assert.equal(sheet.getCell('D2').alignment.wrapText, true);
  assert.equal(sheet.autoFilter, 'A1:G8');
  assert.deepEqual([workbook.getWorksheet('IFC').getCell('D2').value, workbook.getWorksheet('IFC').getCell('E2').value], ['Orphan', 100]);
  assert.deepEqual([workbook.getWorksheet('IFC').getCell('D3').value, workbook.getWorksheet('IFC').getCell('E3').value,
    workbook.getWorksheet('IFC').getCell('F3').value, workbook.getWorksheet('IFC').getCell('G3').value], ['OTHER-TYPE', 7, 2, 5]);
  assert.deepEqual(workbook.getWorksheet('Label').getRow(1).values.slice(1), headers);
});

test('empty catalog exports registered header-only type sheets; an empty registry uses Inventory', async () => {
  const workbook = await roundTrip([], types);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['Bulk', 'IFC', 'Label']);
  for (const sheet of workbook.worksheets) {
    assert.equal(sheet.rowCount, 1);
    assert.deepEqual(sheet.getRow(1).values.slice(1), headers);
  }
  const noTypes = await roundTrip([], []);
  assert.deepEqual(noTypes.worksheets.map((sheet) => sheet.name), ['Inventory']);
  assert.deepEqual(noTypes.worksheets[0].getRow(1).values.slice(1), headers);
});

test('new types, duplicate MAK codes, unsafe product codes and orphan usage lots retain individual rows', async () => {
  const configured = [{ id: 1, name: 'Bulk' }, { id: 4, name: 'New type' }];
  const catalog = [product({ id: 17, makItemCode: 'TRV2583' }), product({ id: 18, makItemCode: 'TRV2583', name: 'Duplicate' }),
    product({ id: 19, makItemCode: 'A/B:*?[]\\', name: '=Literal' }), product({ id: 20, productTypeId: 4, productType: 'New type', makItemCode: '' })];
  const workbook = await roundTrip(catalog, configured, { receiving: [{ productId: 17, materialLotNumber: 'LOT-01', quantity: 4 }], usage: [
    { productId: 17, materialLotNumber: 'USED-ONLY', quantity: 2 }, { productId: 20, materialLotNumber: null, quantity: 1 },
  ] });
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['Bulk', 'New type']);
  const bulk = workbook.getWorksheet('Bulk');
  assert.deepEqual(Object.values(bulk._merges).map((merge) => merge.range).sort(), ['A4:A5', 'B4:B5', 'C4:C5']);
  assert.equal(bulk.getCell('D4').value, 'LOT-01');
  assert.equal(bulk.getCell('E4').value, 4);
  assert.equal(bulk.getCell('D5').value, 'USED-ONLY');
  assert.equal(bulk.getCell('E5').value, 0);
  assert.equal(bulk.getCell('F5').value, 2);
  assert.equal(bulk.getCell('G5').value, -2);
  assert.equal(bulk.rowCount, 5);
  assert.equal(bulk.getCell('A2').value, '=Literal');
  assert.equal(bulk.getCell('A3').value, 'Duplicate');
  assert.equal(bulk.getCell('A4').value, 'Sample product');
  assert.equal(bulk.getCell('A5').isMerged, true);
  const newType = workbook.getWorksheet('New type');
  assert.equal(newType.getCell('D2').value, 'Unassigned (N/A)');
  assert.equal(newType.getCell('F2').value, 1);
  assert.equal(newType.getCell('A2').type, ExcelJS.ValueType.String);
});

test('dashboard download exports lot-wise rows and preserves product codes as text', async (t) => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  let blob;
  let clicked = false;
  const link = { click() { clicked = true; } };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => link } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { setTimeout: (callback) => callback() } });
  t.mock.method(URL, 'createObjectURL', (value) => { blob = value; return 'blob:lot-wise-report'; });
  try {
    await exportInventoryWorkbook([product()], types, { receiving: [{ productId: 17, materialLotNumber: '000LOT', quantity: 100 }], usage: [] });
    assert.equal(clicked, true);
    assert.equal(link.download, 'mak-inventory-summary.xlsx');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await blob.arrayBuffer());
    const sheet = workbook.getWorksheet('Bulk');
    assert.equal(sheet.getCell('B2').type, ExcelJS.ValueType.String);
    assert.equal(sheet.getCell('B2').value, '000123');
    assert.equal(sheet.getCell('D2').value, '000LOT');
    assert.equal(sheet.getCell('E2').value, 100);
  } finally {
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else delete globalThis.document;
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else delete globalThis.window;
  }
});

test('invalid quantities fail explicitly and none of the report generation mutates source data', async () => {
  for (const value of [NaN, Infinity, 'not-a-number']) {
    await assert.rejects(createInventoryWorkbook([product()], types, { receiving: [{ productId: 17, materialLotNumber: 'LOT', quantity: value }] }), /finite numbers/);
  }
  const input = { products: [product()], receiving: [{ productId: 17, materialLotNumber: ' LOT ', quantity: 10 }], usage: [] };
  const original = JSON.stringify(input);
  await createInventoryWorkbook(input.products, types, input);
  assert.equal(JSON.stringify(input), original);
});
