import { createWorkbook, downloadWorkbook, numericQuantity, worksheetName } from './excel.js';

const columns = [
  { header: 'Product Name', key: 'name', width: 44 },
  { header: 'Item Code', key: 'itemCode', width: 20 },
  { header: 'MAK Item Code', key: 'makItemCode', width: 22 },
  { header: 'Total Received', key: 'totalReceived', width: 18 },
  { header: 'Total Used', key: 'totalUsed', width: 18 },
  { header: 'Available', key: 'availableBalance', width: 18 },
];

const productTypeName = (value) => String(value ?? '').trim() || 'Other';

export async function createInventoryWorkbook(products, types = []) {
  const workbook = await createWorkbook();
  const groups = new Map(types.map((type) => [`id:${type.id}`, { name: productTypeName(type.name), products: [] }]));
  const typeKeysByName = new Map(types.map((type) => [productTypeName(type.name).toLowerCase(), `id:${type.id}`]));
  for (const product of products) {
    const name = productTypeName(product.productType);
    const key = product.productTypeId != null ? `id:${product.productTypeId}`
      : typeKeysByName.get(name.toLowerCase()) || `name:${name.toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, { name, products: [] });
    groups.get(key).products.push(product);
  }
  if (!groups.size) groups.set('empty', { name: 'Inventory', products: [] });

  const usedNames = new Set();
  for (const group of groups.values()) {
    const sheet = workbook.addWorksheet(worksheetName(group.name, usedNames), {
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
      sheet.getColumn(column).numFmt = '#,##0;-#,##0;;@';
      sheet.getColumn(column).alignment = { horizontal: 'right' };
      sheet.getColumn(column).eachCell((cell, row) => {
        if (row > 1 && !Number.isInteger(cell.value)) cell.numFmt = '#,##0.0##;-#,##0.0##;;@';
      });
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

export async function exportInventoryWorkbook(products, types = []) {
  const workbook = await createInventoryWorkbook(products, types);
  await downloadWorkbook(workbook, 'mak-inventory-summary.xlsx');
}
