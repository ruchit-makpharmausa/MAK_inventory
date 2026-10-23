import { createWorkbook, downloadWorkbook, numericQuantity, worksheetName } from './excel.js';
import { sortProducts } from './product-sort.js';

const columns = [
  { header: 'Product Name', key: 'name', width: 44 },
  { header: 'Item Code', key: 'itemCode', width: 20 },
  { header: 'MAK Item Code', key: 'makItemCode', width: 22 },
  { header: 'Lot Numbers', key: 'lotNumber', width: 24 },
  { header: 'Total Received', key: 'totalReceived', width: 19 },
  { header: 'Total Used', key: 'totalUsed', width: 19 },
  { header: 'Balance', key: 'balance', width: 19 },
];

const productTypeName = (value) => String(value ?? '').trim() || 'Other';
const normalizedLot = (value) => value == null || !String(value).trim() ? null : String(value).trim();
const productId = (product, index) => product.id == null ? `missing:${index}` : String(product.id);
const balanceNumberFormat = '#,##0.###';

function productLots(products, receivingRows, usageRows) {
  const quantities = new Map();
  for (const [rows, field] of [[receivingRows, 'received'], [usageRows, 'used']]) {
    for (const transaction of rows) {
      const id = String(transaction.productId);
      if (!quantities.has(id)) quantities.set(id, new Map());
      const lots = quantities.get(id);
      const lotNumber = normalizedLot(transaction.materialLotNumber);
      const key = JSON.stringify(lotNumber);
      const current = lots.get(key) || { lotNumber, received: 0, used: 0 };
      current[field] += numericQuantity(transaction.quantity);
      lots.set(key, current);
    }
  }

  return sortProducts(products).flatMap((product, index) => {
    const lots = [...(quantities.get(productId(product, index))?.values() || [])];
    if (!lots.length) lots.push({ lotNumber: null, received: 0, used: 0 });
    lots.sort((a, b) => (a.lotNumber == null ? 1 : 0) - (b.lotNumber == null ? 1 : 0)
      || String(a.lotNumber ?? '').localeCompare(String(b.lotNumber ?? ''), undefined, { numeric: true, sensitivity: 'base' }));
    return lots.map((lot) => {
      const balance = lot.received - lot.used;
      if (![lot.received, lot.used, balance].every(Number.isFinite)) {
        throw new Error('Lot inventory quantities must be finite numbers.');
      }
      return { product, lotNumber: lot.lotNumber === null ? 'Unassigned (N/A)' : lot.lotNumber,
        totalReceived: lot.received, totalUsed: lot.used, balance };
    });
  });
}

export async function createInventoryWorkbook(products, types = [], transactions = {}) {
  const workbook = await createWorkbook();
  const groups = new Map();
  const typeKeysByName = new Map();
  for (const type of types) {
    const name = productTypeName(type.name);
    const transactionKey = type.id == null ? `name:${name.toLowerCase()}` : `id:${type.id}`;
    groups.set(transactionKey, { name, transactionKey, products: [] });
    typeKeysByName.set(name.toLowerCase(), transactionKey);
  }
  for (const product of products) {
    const name = productTypeName(product.productType);
    const key = product.productTypeId != null ? `id:${product.productTypeId}`
      : typeKeysByName.get(name.toLowerCase()) || `name:${name.toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, { name, transactionKey: key, products: [] });
    groups.get(key).products.push(product);
  }
  if (!groups.size) groups.set('empty', { name: 'Inventory', transactionKey: 'empty', products: [] });

  const typeKeyByProductId = new Map();
  for (const [typeKey, group] of groups) {
    for (const product of group.products) {
      if (product.id != null) typeKeyByProductId.set(String(product.id), typeKey);
    }
  }
  const rowsByType = { receiving: new Map(), usage: new Map() };
  for (const kind of ['receiving', 'usage']) {
    for (const row of transactions[kind] || []) {
      const typeKey = typeKeyByProductId.get(String(row.productId));
      if (typeKey == null) continue;
      if (!rowsByType[kind].has(typeKey)) rowsByType[kind].set(typeKey, []);
      rowsByType[kind].get(typeKey).push(row);
    }
  }

  const usedNames = new Set();
  for (const group of groups.values()) {
    const sheet = workbook.addWorksheet(worksheetName(group.name, usedNames), {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    sheet.columns = columns.map((column) => ({ ...column }));
    const rows = productLots(group.products, rowsByType.receiving.get(group.transactionKey) || [], rowsByType.usage.get(group.transactionKey) || []);
    let rowIndex = 2;
    for (let offset = 0; offset < rows.length;) {
      const product = rows[offset].product;
      let end = offset + 1;
      while (end < rows.length && rows[end].product === product) end++;
      const firstRow = rowIndex;
      for (const row of rows.slice(offset, end)) {
        const excelRow = sheet.addRow({
          name: String(product.name ?? ''), itemCode: String(product.itemCode ?? ''),
          makItemCode: String(product.makItemCode ?? ''), lotNumber: row.lotNumber,
          totalReceived: row.totalReceived, totalUsed: row.totalUsed, balance: row.balance,
        });
        excelRow.font = { name: 'Calibri', size: 12 };
        excelRow.height = 23;
        excelRow.getCell(4).alignment = { vertical: 'middle', wrapText: true };
        for (const column of [5, 6, 7]) {
          excelRow.getCell(column).numFmt = balanceNumberFormat;
          excelRow.getCell(column).alignment = { horizontal: 'right', vertical: 'middle' };
        }
        for (const column of [2, 3]) excelRow.getCell(column).font = { name: 'Calibri', size: 12, color: { argb: 'FF000000' } };
      }
      if (end - offset > 1) {
        for (const column of [1, 2, 3]) sheet.mergeCells(firstRow, column, firstRow + end - offset - 1, column);
      }
      for (const column of [1, 2, 3]) sheet.getCell(firstRow, column).alignment = { vertical: 'middle', wrapText: column === 1 };
      if (product.itemCode) sheet.getCell(firstRow, 2).note = `Item Code: ${product.itemCode}`;
      const productNotes = [product.makItemCode ? `MAK Item Code: ${product.makItemCode}` : '', product.unit ? `Unit: ${product.unit}` : ''].filter(Boolean);
      if (productNotes.length) sheet.getCell(firstRow, 3).note = productNotes.join('\n');
      rowIndex += end - offset;
      offset = end;
    }
    sheet.getRow(1).height = 34;
    sheet.getRow(1).eachCell((cell, column) => {
      cell.font = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF102B4E' } };
      cell.alignment = { vertical: 'middle', horizontal: column >= 5 ? 'right' : 'left', wrapText: true };
    });
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: sheet.rowCount, column: columns.length } };
  }
  return workbook;
}

export async function exportInventoryWorkbook(products, types = [], transactions = {}) {
  const workbook = await createInventoryWorkbook(products, types, transactions);
  await downloadWorkbook(workbook, 'mak-inventory-summary.xlsx');
}
