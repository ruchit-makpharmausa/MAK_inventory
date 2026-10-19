import { createWorkbook, downloadWorkbook, numericQuantity } from './excel.js';

const columns = [
  { header: 'Product Name', key: 'name', width: 44 },
  { header: 'Item Code', key: 'itemCode', width: 20 },
  { header: 'MAK Item Code', key: 'makItemCode', width: 22 },
  { header: 'Total Received', key: 'totalReceived', width: 18 },
  { header: 'Total Used', key: 'totalUsed', width: 18 },
  { header: 'Available', key: 'availableBalance', width: 18 },
];

function productTypeName(value) {
  const name = String(value ?? '').trim() || 'Other';
  if (/^sleeves?$/i.test(name)) return 'Sleeve';
  if (/^ifc$/i.test(name)) return 'IFC';
  if (/^bulk$/i.test(name)) return 'Bulk';
  return name;
}

function sheetName(name, usedNames) {
  let base = name.replace(/[\\/?*[\]:\u0000-\u001f\u007f]/g, '-').replace(/^['\s]+|['\s]+$/g, '') || 'Other';
  if (base.toLowerCase() === 'history') base = 'History Items';
  const prefix = (length) => base.slice(0, length).replace(/['\uD800-\uDBFF]+$/g, '') || 'Other';
  let candidate = prefix(31);
  let suffix = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    const ending = ` (${suffix++})`;
    candidate = `${prefix(31 - ending.length)}${ending}`;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

export async function createInventoryWorkbook(products) {
  const workbook = await createWorkbook();
  const groups = new Map(['Sleeve', 'IFC', 'Bulk'].map((name) => [name.toLowerCase(), { name, products: [] }]));
  for (const product of products) {
    const name = productTypeName(product.productType);
    const key = name.toLowerCase();
    if (!groups.has(key)) groups.set(key, { name, products: [] });
    groups.get(key).products.push(product);
  }

  const usedNames = new Set();
  for (const group of groups.values()) {
    const sheet = workbook.addWorksheet(sheetName(group.name, usedNames), {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    sheet.columns = columns.map((column) => ({ ...column }));
    for (const product of group.products) {
      sheet.addRow({
        name: String(product.name ?? ''),
        itemCode: String(product.itemCode ?? ''),
        makItemCode: String(product.makItemCode ?? ''),
        totalReceived: numericQuantity(product.totalReceived),
        totalUsed: numericQuantity(product.totalUsed),
        availableBalance: numericQuantity(product.availableBalance),
      });
    }
    for (const column of [4, 5, 6]) {
      sheet.getColumn(column).numFmt = '#,##0.###';
      sheet.getColumn(column).alignment = { horizontal: 'right' };
    }
    sheet.getRow(1).height = 24;
    sheet.getRow(1).eachCell((cell, column) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF102B4E' } };
      cell.alignment = { vertical: 'middle', horizontal: column >= 4 ? 'right' : 'left' };
    });
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: sheet.rowCount, column: 6 } };
  }
  return workbook;
}

export async function exportInventoryWorkbook(products) {
  const workbook = await createInventoryWorkbook(products);
  await downloadWorkbook(workbook, 'mak-inventory-summary.xlsx');
}
