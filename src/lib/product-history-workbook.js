import { createWorkbook, downloadWorkbook } from './excel.js';
import { productHistoryEntries, productHistoryFilename, productHistoryHeaders } from './product-history-report.js';

export { productHistoryFilename } from './product-history-report.js';

export async function createProductHistoryWorkbook(history) {
  const transactions = productHistoryEntries(history);
  const workbook = await createWorkbook();
  const sheet = workbook.addWorksheet('Product History', { views: [{ state: 'frozen', ySplit: 1, showGridLines: true }] });
  sheet.columns = [14, 55, 16, 16, 32].map((width, index) => ({ header: productHistoryHeaders[index], width }));
  sheet.getColumn(1).numFmt = 'm/d/yy';
  for (const column of [3, 4]) {
    sheet.getColumn(column).numFmt = '#,##0.###';
    sheet.getColumn(column).alignment = { horizontal: 'right' };
  }
  for (const column of [2, 5]) sheet.getColumn(column).alignment = { wrapText: true, vertical: 'middle' };

  for (const entry of transactions) {
    const row = sheet.addRow([entry.date, entry.description, entry.receivedQuantity, entry.usedQuantity, entry.usedAgainst]);
    row.font = { name: 'Calibri', size: 11, bold: entry.receiving };
    row.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
    if (!entry.receiving) {
      for (const column of [4, 5]) row.getCell(column).font = { name: 'Calibri', size: 11, color: { argb: 'FFFF0000' } };
    }
    if (entry.notes) row.getCell(entry.receiving ? 2 : 5).note = entry.notes;
  }

  sheet.getRow(1).height = 22;
  sheet.getRow(1).eachCell((cell) => {
    cell.font = { name: 'Calibri', size: 11, bold: true };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  const codes = [
    history.product.itemCode ? `Item Code: ${history.product.itemCode}` : '',
    history.product.makItemCode ? `MAK Item Code: ${history.product.makItemCode}` : '',
  ].filter(Boolean);
  if (codes.length) sheet.getCell('B1').note = codes.join('\n');
  if (history.product.unit) {
    sheet.getCell('C1').note = `Unit: ${history.product.unit}`;
    sheet.getCell('D1').note = `Unit: ${history.product.unit}`;
  }
  return workbook;
}

export async function exportProductHistoryWorkbook(history) {
  const workbook = await createProductHistoryWorkbook(history);
  await downloadWorkbook(workbook, productHistoryFilename(history.product));
}
