import { createWorkbook, downloadWorkbook } from './excel.js';
import { productHistoryEntries, productHistoryFilename, productHistoryHeaders } from './product-history-report.js';

export { productHistoryFilename } from './product-history-report.js';

export async function createProductHistoryWorkbook(history) {
  const transactions = productHistoryEntries(history);
  const workbook = await createWorkbook();
  const sheet = workbook.addWorksheet('Product History', { views: [{ state: 'frozen', ySplit: 1, showGridLines: true }] });
  const widths = [15, 28, 60, 18, 18, 36];
  sheet.columns = widths.map((width, index) => ({ header: productHistoryHeaders[index], width }));
  sheet.getColumn(1).numFmt = 'm/d/yy';
  for (const column of [4, 5]) {
    sheet.getColumn(column).numFmt = '#,##0.###';
    sheet.getColumn(column).alignment = { horizontal: 'right', vertical: 'middle' };
  }
  const textColumns = [2, 3, 6];
  for (const column of textColumns) sheet.getColumn(column).alignment = { wrapText: true, vertical: 'middle' };

  for (const entry of transactions) {
    const row = sheet.addRow([entry.date, entry.materialLotNumber, entry.description, entry.receivedQuantity, entry.usedQuantity, entry.usedAgainst]);
    row.font = { name: 'Calibri', size: 12, bold: entry.receiving };
    row.height = Math.max(20, ...textColumns.map((column) => {
      const lines = String(row.getCell(column).value ?? '').split(/\r?\n/);
      return 18 * lines.reduce((count, line) => count + Math.max(1, Math.ceil(line.length / (widths[column - 1] * 0.8))), 0) + 2;
    }));
    row.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
    if (!entry.receiving) {
      for (const column of [5, 6]) row.getCell(column).font = { name: 'Calibri', size: 12, color: { argb: 'FFFF0000' } };
    }
    if (entry.notes) row.getCell(entry.receiving ? 3 : 6).note = entry.notes;
  }

  sheet.getRow(1).height = 36;
  sheet.getRow(1).eachCell((cell) => {
    cell.font = { name: 'Calibri', size: 12, bold: true };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
  const codes = [
    history.product.itemCode ? `Item Code: ${history.product.itemCode}` : '',
    history.product.makItemCode ? `MAK Item Code: ${history.product.makItemCode}` : '',
  ].filter(Boolean);
  if (codes.length) sheet.getCell('C1').note = codes.join('\n');
  if (history.product.unit) {
    sheet.getCell('D1').note = `Unit: ${history.product.unit}`;
    sheet.getCell('E1').note = `Unit: ${history.product.unit}`;
  }
  return workbook;
}

export async function exportProductHistoryWorkbook(history) {
  const workbook = await createProductHistoryWorkbook(history);
  await downloadWorkbook(workbook, productHistoryFilename(history.product));
}
