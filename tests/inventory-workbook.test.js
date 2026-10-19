import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { createInventoryWorkbook } from '../src/lib/inventory-workbook.js';

const headers = ['Product Name', 'Item Code', 'MAK Item Code', 'Total Received', 'Total Used', 'Available'];
const product = (values = {}) => ({
  name: 'Sample product', itemCode: '000123', makItemCode: 'MAK-001', productType: 'Sleeve',
  totalReceived: 100000, totalUsed: 2500, availableBalance: 97500, ...values,
});

async function roundTrip(products) {
  const workbook = await createInventoryWorkbook(products);
  const buffer = await workbook.xlsx.writeBuffer();
  const read = new ExcelJS.Workbook();
  await read.xlsx.load(buffer);
  return read;
}

test('Excel workbook contains Sleeve, IFC and Bulk sheets with the six requested columns', async () => {
  const workbook = await roundTrip([
    product({ productType: ' Sleeve ', name: 'Sleeve product', totalReceived: '100000' }),
    product({ productType: 'sleeves', name: 'Another sleeve' }),
    product({ productType: 'ifc', name: '=Literal product name', itemCode: '=A1', totalReceived: 12.5, totalUsed: 0.125, availableBalance: 12.375 }),
    product({ productType: 'BULK', name: 'Bulk product', totalReceived: 0, totalUsed: 0, availableBalance: 0 }),
  ]);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['Sleeve', 'IFC', 'Bulk']);
  for (const sheet of workbook.worksheets) {
    assert.deepEqual(sheet.getRow(1).values.slice(1), headers);
    assert.equal(sheet.columnCount, 6);
    assert.equal(sheet.views[0].state, 'frozen');
    assert.equal(sheet.views[0].ySplit, 1);
    assert.equal(sheet.getCell('A1').font.bold, true);
    assert.equal(sheet.getCell('D2').type, ExcelJS.ValueType.Number);
    assert.equal(sheet.getCell('D2').alignment.horizontal, 'right');
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

test('empty exports retain all three sheets and headers', async () => {
  const workbook = await roundTrip([]);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['Sleeve', 'IFC', 'Bulk']);
  for (const sheet of workbook.worksheets) {
    assert.equal(sheet.rowCount, 1);
    assert.deepEqual(sheet.getRow(1).values.slice(1), headers);
  }
});

test('additional product types are not dropped and receive unique valid sheet names', async () => {
  const types = [undefined, 'Other', 'Label/Box', 'Label?Box', 'A'.repeat(40), `${'A'.repeat(39)}B`, "'Quoted'", 'History', `${'B'.repeat(30)}'suffix`];
  const workbook = await roundTrip(types.map((productType, index) => product({ productType, name: `Product ${index}` })));
  assert.deepEqual(workbook.worksheets.slice(0, 3).map((sheet) => sheet.name), ['Sleeve', 'IFC', 'Bulk']);
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

test('missing optional values become empty strings or zeros; invalid quantities fail explicitly', async () => {
  const workbook = await roundTrip([product({ name: null, itemCode: null, makItemCode: null, totalReceived: null, totalUsed: undefined, availableBalance: null })]);
  const sheet = workbook.getWorksheet('Sleeve');
  assert.deepEqual([sheet.getCell('D2').value, sheet.getCell('E2').value, sheet.getCell('F2').value], [0, 0, 0]);
  for (const value of [NaN, Infinity, 'not-a-number']) {
    await assert.rejects(createInventoryWorkbook([product({ totalReceived: value })]), /finite numbers/);
  }
});
