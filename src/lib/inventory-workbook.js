import { createWorkbook, downloadWorkbook, numericQuantity, worksheetName } from './excel.js';
import { sortProducts } from './product-sort.js';

const columns = [
  { header: 'Product Name', key: 'name', width: 44 },
  { header: 'Item Code', key: 'itemCode', width: 20 },
  { header: 'MAK Item Code', key: 'makItemCode', width: 22 },
  { header: 'Customer LOT', key: 'lotNumber', width: 24 },
  { header: 'MAK Release Number', key: 'makReleaseNumber', width: 28 },
  { header: 'Total Received', key: 'totalReceived', width: 19 },
  { header: 'Total Used', key: 'totalUsed', width: 19 },
  { header: 'Balance', key: 'balance', width: 19 },
];
const bulkColumns = [
  ...columns.slice(0, 5),
  { header: 'Location', key: 'location', width: 18 },
  ...columns.slice(5),
];

const productTypeName = (value) => String(value ?? '').trim() || 'Other';
const normalizedLot = (value) => value == null || !String(value).trim() ? null : String(value).trim();
const productId = (product, index) => product.id == null ? `missing:${index}` : String(product.id);
const balanceNumberFormat = '#,##0';

function productLots(products, receivingRows, usageRows) {
  const quantities = new Map();
  for (const [rows, field] of [[receivingRows, 'received'], [usageRows, 'used']]) {
    for (const transaction of rows) {
      const id = String(transaction.productId);
      if (!quantities.has(id)) quantities.set(id, new Map());
      const lots = quantities.get(id);
      const lotNumber = normalizedLot(transaction.materialLotNumber);
      const key = JSON.stringify(lotNumber);
      const current = lots.get(key) || { lotNumber, receipts: [], used: 0 };
      const amount = numericQuantity(transaction.quantity);
      if (field === 'received') {
        current.receipts.push({
          quantity: amount,
          makReleaseNumber: typeof transaction.makReleaseNumber === 'string' ? transaction.makReleaseNumber.trim() : '',
          location: typeof transaction.location === 'string' ? transaction.location.trim() : '',
          date: String(transaction.date ?? ''),
          id: Number(transaction.id) || 0,
        });
      } else current.used += amount;
      lots.set(key, current);
    }
  }

  return sortProducts(products).flatMap((product, index) => {
    const lots = [...(quantities.get(productId(product, index))?.values() || [])];
    if (!lots.length) lots.push({ lotNumber: null, receipts: [], used: 0 });
    lots.sort((a, b) => (a.lotNumber == null ? 1 : 0) - (b.lotNumber == null ? 1 : 0)
      || String(a.lotNumber ?? '').localeCompare(String(b.lotNumber ?? ''), undefined, { numeric: true, sensitivity: 'base' }));
    return lots.flatMap((lot) => {
      lot.receipts.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
      const releases = new Map();
      for (const receipt of lot.receipts) {
        const release = releases.get(receipt.makReleaseNumber)
          || { makReleaseNumber: receipt.makReleaseNumber, received: 0, used: 0, date: receipt.date, id: receipt.id, locations: new Set() };
        release.received += receipt.quantity;
        if (receipt.location) release.locations.add(receipt.location);
        releases.set(receipt.makReleaseNumber, release);
      }
      const releaseRows = [...releases.values()].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
      let remainingUsage = lot.used;
      for (const release of releaseRows) {
        release.used = Math.min(release.received, remainingUsage);
        remainingUsage -= release.used;
      }
      if (remainingUsage > 0) {
        if (releaseRows.length) releaseRows[releaseRows.length - 1].used += remainingUsage;
        else releaseRows.push({ makReleaseNumber: '', received: 0, used: remainingUsage });
      }
      if (!releaseRows.length) releaseRows.push({ makReleaseNumber: '', received: 0, used: 0 });
      return releaseRows.map((release) => {
        const balance = release.received - release.used;
        if (![release.received, release.used, balance].every(Number.isFinite)) {
          throw new Error('Lot inventory quantities must be finite numbers.');
        }
        return {
          product, lotNumber: lot.lotNumber === null ? 'Unassigned (N/A)' : lot.lotNumber,
          makReleaseNumber: release.makReleaseNumber,
          location: [...(release.locations || [])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })).join(', '),
          totalReceived: release.received, totalUsed: release.used, balance,
        };
      });
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
    const sheetColumns = group.name.trim().toLocaleLowerCase() === 'bulk' ? bulkColumns : columns;
    sheet.columns = sheetColumns.map((column) => ({ ...column }));
    const rows = productLots(group.products, rowsByType.receiving.get(group.transactionKey) || [], rowsByType.usage.get(group.transactionKey) || []);
    for (const row of rows) {
      const product = row.product;
      const excelRow = sheet.addRow({
        name: String(product.name ?? ''), itemCode: String(product.itemCode ?? ''),
        makItemCode: String(product.makItemCode ?? ''), lotNumber: row.lotNumber,
        makReleaseNumber: row.makReleaseNumber,
        ...(sheetColumns === bulkColumns ? { location: row.location } : {}),
        totalReceived: row.totalReceived, totalUsed: row.totalUsed, balance: row.balance,
      });
      excelRow.font = { name: 'Calibri', size: 12 };
      excelRow.height = 23;
      excelRow.getCell(1).alignment = { vertical: 'middle', wrapText: true };
      excelRow.getCell(4).alignment = { vertical: 'middle', wrapText: true };
      excelRow.getCell(5).alignment = { vertical: 'middle', wrapText: true };
      const numericStart = sheetColumns === bulkColumns ? 7 : 6;
      if (sheetColumns === bulkColumns) excelRow.getCell(6).alignment = { vertical: 'middle', wrapText: true };
      for (let column = numericStart; column < numericStart + 3; column++) {
        excelRow.getCell(column).numFmt = balanceNumberFormat;
        excelRow.getCell(column).alignment = { horizontal: 'right', vertical: 'middle' };
      }
      for (const column of [2, 3]) excelRow.getCell(column).font = { name: 'Calibri', size: 12, color: { argb: 'FF000000' } };
    }
    sheet.getRow(1).height = 34;
    sheet.getRow(1).eachCell((cell, column) => {
      cell.font = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF102B4E' } };
      cell.alignment = { vertical: 'middle', horizontal: column >= (sheetColumns === bulkColumns ? 7 : 5) ? 'right' : 'left', wrapText: true };
    });
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: sheet.rowCount, column: sheetColumns.length } };
  }
  return workbook;
}

export async function exportInventoryWorkbook(products, types = [], transactions = {}) {
  const workbook = await createInventoryWorkbook(products, types, transactions);
  await downloadWorkbook(workbook, 'mak-inventory-summary.xlsx');
}
