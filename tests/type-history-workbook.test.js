import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { createTypeHistoryWorkbook, exportTypeHistoryWorkbook, typeHistoryFilename } from '../src/lib/type-history-workbook.js';

const type = { id: 7, name: 'Packaging' };
const product = { id: 1, name: 'Carton', itemCode: '000123', makItemCode: 'MAK-001', productType: 'Packaging', unit: 'Pcs' };
const receipt = (values = {}) => ({ id: 1, date: '2026-10-12', quantity: 3600, makReleaseNumber: '000001', materialLotNumber: 'REC-MAT-001', remarks: 'Received stock', ...values });
const usage = (values = {}) => ({ id: 1, date: '2026-10-13', quantity: 1200, makLotNumber: '000083', materialLotNumber: 'USE-MAT-001', remarks: 'Production use', ...values });
const history = (values = {}) => ({ product, receiving: [receipt()], usage: [usage()], ...values });
const report = (histories = [history()], selectedType = type) => ({ type: selectedType, histories });
const noteText = (cell) => typeof cell.note === 'string' ? cell.note : (cell.note?.texts || []).map((part) => part.text).join('');

async function roundTrip(value) {
  const workbook = await createTypeHistoryWorkbook(value);
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(await workbook.xlsx.writeBuffer());
  return loaded;
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

test('every selected product gets its own complete six-column ledger in natural MAK-code order', async () => {
  const workbook = await roundTrip(report([
    history({ product: { ...product, id: 10, name: 'Tenth', makItemCode: 'MAK-10' }, receiving: [receipt({ makReleaseNumber: 'RN-TENTH', quantity: 10 })], usage: [] }),
    history({ product: { ...product, id: 2, name: 'Second', makItemCode: 'MAK-2' }, receiving: [receipt({ makReleaseNumber: 'RN-SECOND', quantity: 20 })], usage: [usage({ makLotNumber: 'SECOND-LOT', quantity: 5 })] }),
  ]));
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['MAK-2', 'MAK-10']);
  const [second, tenth] = workbook.worksheets;
  assert.deepEqual(second.getRow(1).values.slice(1), ['Date', 'MAK Release Number', 'Item/Description', 'Qty', 'Used Qty', 'Used Against(MAK Lot No)']);
  assert.equal(second.columnCount, 6);
  assert.equal(second.rowCount, 4);
  assert.equal(tenth.rowCount, 3);
  assert.equal(second.getCell('B2').value, 'RN-SECOND');
  assert.equal(second.getCell('C2').value, 'Second');
  assert.equal(second.getCell('F3').value, '#SECOND-LOT');
  assert.equal(second.getCell('D4').value, 15);
  assert.equal(tenth.getCell('B2').value, 'RN-TENTH');
  assert.equal(tenth.getCell('D3').value, 10);
  assert.equal(tenth.getCell('F2').text, '');
  assert.equal(workbook.creator, 'MAK Inventory');
  for (const sheet of workbook.worksheets) {
    assert.equal(sheet.views[0].state, 'frozen');
    assert.equal(sheet.views[0].ySplit, 1);
    assert.ok(sheet.getColumn(3).width >= 40);
    assert.ok(sheet.getColumn(6).width >= 25);
    assert.match(noteText(sheet.getCell('C1')), /Type: Packaging\nType ID: 7/);
  }
});

test('separate type reports cannot leak other type or product transactions', async () => {
  const packaging = await roundTrip(report([history({ receiving: [receipt({ makReleaseNumber: 'PACKAGING-ONLY' })], usage: [] })]));
  const ingredients = await roundTrip(report([history({
    product: { ...product, id: 80, name: 'Ingredient', makItemCode: 'ING-80', productType: 'Ingredients' },
    receiving: [], usage: [usage({ makLotNumber: 'INGREDIENTS-ONLY' })],
  })], { id: 8, name: 'Ingredients' }));
  assert.deepEqual(packaging.worksheets.map((sheet) => sheet.name), ['MAK-001']);
  assert.deepEqual(ingredients.worksheets.map((sheet) => sheet.name), ['ING-80']);
  assert.equal(packaging.worksheets[0].getCell('B2').value, 'PACKAGING-ONLY');
  assert.equal(ingredients.worksheets[0].getCell('F2').value, '#INGREDIENTS-ONLY');
  assert.doesNotMatch(noteText(ingredients.worksheets[0].getCell('C1')), /Packaging|Carton/);
  assert.doesNotMatch(noteText(packaging.worksheets[0].getCell('C1')), /Ingredients|Ingredient/);
});

test('chronological dates, receipt-first ties, release numbers, and usage fields survive XLSX roundtrip', async () => {
  const day = '2026-10-12';
  const workbook = await roundTrip(report([history({
    receiving: [receipt({ id: 2, makReleaseNumber: '000002', quantity: '10' }), receipt({ id: 1, makReleaseNumber: '000001', quantity: 12.5 }), receipt({ id: 3, date: '2026-10-14', quantity: 20 })],
    usage: [usage({ id: 2, date: day, quantity: 0.125, makLotNumber: 'Lot # #00002' }), usage({ id: 1, date: day, quantity: 0.5, makLotNumber: '###00001' }), usage({ id: 3, date: '2026-10-11', quantity: 1, makLotNumber: 'EARLIER' })],
  })]));
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.getCell('A2').type, ExcelJS.ValueType.Date);
  assert.equal(sheet.getCell('A2').value.toISOString(), '2026-10-11T00:00:00.000Z');
  assert.equal(sheet.getCell('A2').numFmt, 'm/d/yy');
  assert.equal(sheet.getCell('F2').value, '#EARLIER');
  assert.equal(sheet.getCell('B3').value, '000001');
  assert.equal(sheet.getCell('B3').type, ExcelJS.ValueType.String);
  assert.equal(sheet.getCell('B4').value, '000002');
  assert.equal(sheet.getCell('D4').value, 10);
  assert.equal(sheet.getCell('F5').value, '#00001');
  assert.equal(sheet.getCell('E5').value, 0.5);
  assert.equal(sheet.getCell('F6').value, '#00002');
  assert.equal(sheet.getCell('E6').value, 0.125);
  assert.equal(sheet.getCell('A7').value.toISOString().slice(0, 10), '2026-10-14');
  for (const row of [3, 4, 7]) {
    for (let column = 1; column <= 6; column++) assert.equal(sheet.getRow(row).getCell(column).font.bold, true);
    assert.equal(sheet.getRow(row).getCell(5).value, null);
  }
  for (const row of [2, 5, 6]) {
    assert.equal(sheet.getRow(row).getCell(2).text, '');
    assert.equal(sheet.getRow(row).getCell(3).text, '');
    assert.equal(sheet.getRow(row).getCell(4).value, null);
    for (const column of [5, 6]) assert.equal(sheet.getRow(row).getCell(column).font.color.argb, 'FFFF0000');
  }
});

test('header and transaction notes preserve identifying metadata, leading zeros, lots, and remarks', async () => {
  const workbook = await roundTrip(report());
  const sheet = workbook.worksheets[0];
  const metadata = noteText(sheet.getCell('C1'));
  for (const value of ['Product: Carton', 'Product ID: 1', 'Type: Packaging', 'Type ID: 7', 'Product Type: Packaging', 'Item Code: 000123', 'MAK Item Code: MAK-001', 'Unit: Pcs']) assert.ok(metadata.includes(value), value);
  assert.equal(noteText(sheet.getCell('D1')), 'Unit: Pcs');
  assert.equal(noteText(sheet.getCell('E1')), 'Unit: Pcs');
  assert.match(noteText(sheet.getCell('B2')), /MAK Release Number: 000001/);
  assert.match(noteText(sheet.getCell('B2')), /Material lot number: REC-MAT-001/);
  assert.match(noteText(sheet.getCell('B2')), /Remarks: Received stock/);
  assert.match(noteText(sheet.getCell('F3')), /Material lot number: USE-MAT-001/);
  assert.match(noteText(sheet.getCell('F3')), /Remarks: Production use/);
});

test('closing balances are numeric and green, include units, and never hide zero', async () => {
  const workbook = await roundTrip(report([
    history(),
    history({ product: { ...product, id: 2, makItemCode: 'MAK-002', unit: 'kg' }, receiving: [receipt({ quantity: 1000.125 })], usage: [usage({ quantity: 1000.125 })] }),
    history({ product: { ...product, id: 3, makItemCode: 'MAK-003', unit: 'kg' }, receiving: [], usage: [usage({ quantity: 12.125 })] }),
  ]));
  const expected = [2400, 0, -12.125];
  for (const [index, sheet] of workbook.worksheets.entries()) {
    const closing = sheet.lastRow;
    assert.equal(closing.getCell(3).value, 'Closing Balance');
    assert.equal(closing.getCell(4).type, ExcelJS.ValueType.Number);
    assert.equal(closing.getCell(4).value, expected[index]);
    assert.equal(closing.getCell(4).alignment.horizontal, 'right');
    assert.match(closing.getCell(4).numFmt, index === 0 ? /" Pcs"/ : /" kg"/);
    assert.match(closing.getCell(4).numFmt.split(';')[2], /^0/);
    for (let column = 1; column <= 6; column++) {
      assert.equal(closing.getCell(column).font.color.argb, 'FF008000');
      assert.equal(closing.getCell(column).font.bold, true);
      assert.equal(closing.getCell(column).fill.fgColor.argb, 'FFE2F0D9');
    }
  }
  assert.match(workbook.worksheets[2].lastRow.getCell(4).numFmt, /^#,##0\.0##/);
});

test('optional zero quantities display blank, integers have no trailing dot, and fractions keep three places', async () => {
  const workbook = await roundTrip(report([history({
    receiving: [receipt({ id: 1, quantity: 12000 }), receipt({ id: 2, quantity: 12.125 }), receipt({ id: 3, quantity: 0 }), receipt({ id: 4, quantity: null })],
    usage: [usage({ quantity: 0 })],
  })]));
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.getCell('D2').value, 12000);
  assert.equal(sheet.getCell('D2').numFmt, '#,##0;-#,##0;;@');
  assert.equal(sheet.getCell('D3').value, 12.125);
  assert.equal(sheet.getCell('D3').numFmt, '#,##0.0##;-#,##0.0##;;@');
  assert.equal(sheet.getCell('D4').value, 0);
  assert.equal(sheet.getCell('D5').value, 0);
  assert.equal(sheet.getCell('E6').value, 0);
  for (const address of ['D4', 'D5', 'E6']) assert.equal(sheet.getCell(address).numFmt.split(';')[2], '');
});

test('unsafe, reserved, duplicate, and missing MAK codes never drop products or create invalid sheet names', async () => {
  const products = [
    { id: 1, makItemCode: ' A/B ' }, { id: 2, makItemCode: 'A?B' },
    { id: 3, makItemCode: 'same' }, { id: 4, makItemCode: 'SAME' },
    { id: 5, makItemCode: 'History' }, { id: 6, makItemCode: "  'Quoted'  " },
    { id: 7, makItemCode: 'Long'.repeat(20) }, { id: 8, makItemCode: 'Long'.repeat(20) },
    { id: 9, makItemCode: '   ', itemCode: ' 000009 ' },
    { id: 10, makItemCode: '', itemCode: ' ', name: 'Fallback Name' },
    { id: 11, makItemCode: null, name: ' ', itemCode: null },
    { id: 12, makItemCode: '[]:*?\\/\u0001' },
  ];
  const workbook = await roundTrip(report(products.map((value) => history({ product: value, receiving: [], usage: [] }))));
  assert.equal(workbook.worksheets.length, products.length);
  const names = workbook.worksheets.map((sheet) => sheet.name);
  assert.equal(new Set(names.map((name) => name.toLowerCase())).size, products.length);
  for (const name of names) {
    assert.ok(name.length > 0 && name.length <= 31);
    assert.doesNotMatch(name, /[\\/?*\[\]:\u0000-\u001f\u007f]/);
    assert.doesNotMatch(name, /^'|'$/);
    assert.notEqual(name.toLowerCase(), 'history');
  }
  for (const expected of ['A-B', 'A-B (2)', 'same', 'SAME (2)', 'History Items', 'Quoted', '000009', 'Fallback Name', 'Product-11']) assert.ok(names.includes(expected), expected);
  const metadata = workbook.worksheets.map((sheet) => noteText(sheet.getCell('C1')));
  for (const value of products) assert.equal(metadata.filter((note) => note.split('\n').includes(`Product ID: ${value.id}`)).length, 1);
});

test('repeated product IDs and shared product references still get separate ledgers', async () => {
  const workbook = await roundTrip(report([
    history({ receiving: [receipt({ quantity: 10, makReleaseNumber: 'FIRST' })], usage: [] }),
    history({ receiving: [receipt({ quantity: 20, makReleaseNumber: 'SECOND' })], usage: [] }),
    history({ product: { ...product }, receiving: [receipt({ quantity: 30, makReleaseNumber: 'THIRD' })], usage: [] }),
  ]));
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['MAK-001', 'MAK-001 (2)', 'MAK-001 (3)']);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.getCell('B2').value), ['FIRST', 'SECOND', 'THIRD']);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.lastRow.getCell(4).value), [10, 20, 30]);
});

test('literal formula-like names, releases, lots, and units remain data rather than formulas', async () => {
  const source = await createTypeHistoryWorkbook(report([history({
    product: { ...product, name: '=SUM(1,2)', makItemCode: '=1+1', unit: 'kg "net" \\ unit' },
    receiving: [receipt({ makReleaseNumber: '=2+2' })],
    usage: [usage({ makLotNumber: '=3+3' })],
  })]));
  assert.match(source.worksheets[0].lastRow.getCell(4).numFmt, /kg \\"net\\" \\\\ unit/);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await source.xlsx.writeBuffer());
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.name, '=1+1');
  assert.equal(sheet.getCell('C2').value, '=SUM(1,2)');
  assert.equal(sheet.getCell('B2').value, '=2+2');
  assert.equal(sheet.getCell('F3').value, '#=3+3');
  for (const address of ['C2', 'B2', 'F3']) {
    assert.equal(sheet.getCell(address).type, ExcelJS.ValueType.String);
    assert.equal(sheet.getCell(address).formula, undefined);
  }
  assert.equal(noteText(sheet.getCell('D1')), 'Unit: kg "net" \\ unit');
});

test('empty products retain a header and visible zero closing balance even without optional metadata', async () => {
  const workbook = await roundTrip(report([history({ product: { id: 23 }, receiving: [], usage: [] })]));
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.name, 'Product-23');
  assert.equal(sheet.rowCount, 2);
  assert.equal(sheet.getCell('A2').value, null);
  assert.equal(sheet.getCell('C2').value, 'Closing Balance');
  assert.equal(sheet.getCell('D2').value, 0);
  assert.equal(sheet.getCell('D2').numFmt, '#,##0;-#,##0;0;@');
  const omittedArrays = await roundTrip(report([{ product }]));
  assert.equal(omittedArrays.worksheets[0].lastRow.getCell(4).value, 0);
});

test('empty types produce a valid type-named header-only worksheet, not fake products', async () => {
  for (const value of [report([]), { type: { id: 9, name: 'History' } }, report([], { id: 9, name: '   ' })]) {
    const workbook = await roundTrip(value);
    assert.equal(workbook.worksheets.length, 1);
    const sheet = workbook.worksheets[0];
    assert.equal(sheet.rowCount, 1);
    assert.equal(sheet.columnCount, 6);
    assert.equal(sheet.views[0].ySplit, 1);
    assert.doesNotMatch(noteText(sheet.getCell('C1')), /Product:|Product ID:/);
    assert.match(noteText(sheet.getCell('C1')), /Type ID:/);
  }
  assert.equal((await roundTrip(report([]))).worksheets[0].name, 'Packaging');
});

test('invalid dates and quantities reject the whole export, including a later product', async () => {
  for (const date of ['invalid', '2026-02-30', '2026-13-01', '2026-10-12T00:00:00Z', '', undefined, null]) {
    await assert.rejects(createTypeHistoryWorkbook(report([history({ receiving: [receipt({ date })] })])), /invalid transaction date/);
    await assert.rejects(createTypeHistoryWorkbook(report([history(), history({ usage: [usage({ date })] })])), /invalid transaction date/);
  }
  for (const quantity of [Infinity, -Infinity, NaN, 'not a number', 'Infinity']) {
    await assert.rejects(createTypeHistoryWorkbook(report([history({ receiving: [receipt({ quantity })] })])), /finite numbers/);
    await assert.rejects(createTypeHistoryWorkbook(report([history(), history({ usage: [usage({ quantity })] })])), /finite numbers/);
  }
  await assert.rejects(createTypeHistoryWorkbook(report([history({ receiving: [receipt({ quantity: Number.MAX_VALUE }), receipt({ id: 2, quantity: Number.MAX_VALUE })], usage: [] })])), /closing balance.*finite/);
  for (const value of [null, {}, { type, histories: {} }]) await assert.rejects(createTypeHistoryWorkbook(value), /Select a product type/);
  await assert.rejects(createTypeHistoryWorkbook(report([{}])), /Select a product/);
});

test('sorting, normalizing lots, formatting, and adding closing rows never mutate report sources', async () => {
  const value = deepFreeze(report([
    history({ product: { ...product, id: 10, makItemCode: 'MAK-10' }, receiving: [receipt({ id: 2, date: '2026-10-15' }), receipt()], usage: [usage({ makLotNumber: ' Lot # #000083 ' })] }),
    history({ product: { ...product, id: 2, makItemCode: 'MAK-2' } }),
  ]));
  const before = JSON.stringify(value);
  await roundTrip(value);
  assert.equal(JSON.stringify(value), before);
});

test('type filenames are Windows-safe, bounded, deterministic, and have useful fallbacks', () => {
  assert.equal(typeHistoryFilename(type), 'inventory-history-Packaging.xlsx');
  assert.equal(typeHistoryFilename({ name: '  000123  ' }), 'inventory-history-000123.xlsx');
  for (const value of [undefined, null, {}, { name: '' }, { name: '  ...  ' }]) assert.equal(typeHistoryFilename(value), 'inventory-history-type.xlsx');
  for (const name of ['A/B:C?D\\E*F"<G>|\u0000\u007f', 'CON', 'NUL', 'COM1', '.hidden...', ' X '.repeat(200), '🙂'.repeat(100)]) {
    const filename = typeHistoryFilename({ name });
    assert.match(filename, /^inventory-history-.+\.xlsx$/);
    assert.doesNotMatch(filename, /[<>:"/\\|?*\u0000-\u001f\u007f]/);
    const basename = filename.slice('inventory-history-'.length, -'.xlsx'.length);
    assert.ok(basename.length <= 80);
    assert.doesNotMatch(basename, /[.\s\uD800-\uDBFF]$/);
    assert.equal(filename, typeHistoryFilename({ name }));
  }
});

test('download wrapper serializes the type workbook and uses its safe type filename', async (t) => {
  let downloaded;
  let clicked = false;
  let downloadBlob;
  let revoked;
  const link = { click() { clicked = true; } };
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  t.after(() => {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  });
  globalThis.document = { createElement(tag) { assert.equal(tag, 'a'); return link; } };
  globalThis.window = { setTimeout(callback) { downloaded = link.download; callback(); } };
  t.mock.method(URL, 'createObjectURL', (blob) => { downloadBlob = blob; return 'blob:type-history-test'; });
  t.mock.method(URL, 'revokeObjectURL', (url) => { revoked = url; });
  await exportTypeHistoryWorkbook(report());
  assert.equal(clicked, true);
  assert.equal(downloaded, 'inventory-history-Packaging.xlsx');
  assert.equal(revoked, 'blob:type-history-test');
  assert.equal(downloadBlob.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await downloadBlob.arrayBuffer());
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['MAK-001']);
});
