import { createWorkbook, downloadWorkbook, worksheetName } from './excel.js';
import { productHistoryEntries } from './product-history-report.js';
import { sortProducts } from './product-sort.js';

const headers = ['Date', 'Material Lot Number', 'MAK Release Number', 'Item/Description', 'Qty', 'Used Qty', 'Used Against(MAK Lot No)'];
const widths = [15, 28, 28, 60, 20, 20, 36];
const textColumns = [2, 3, 4, 7];
const text = (value) => String(value ?? '');
const trimmed = (value) => text(value).trim();

function quantityFormat(value, unit = '', showZero = false) {
  const number = Number.isInteger(value) ? '#,##0' : '#,##0.0##';
  const suffix = unit ? `" ${unit.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/["\\]/g, '\\$&')}"` : '';
  return `${number}${suffix};-${number}${suffix};${showZero ? `0${suffix}` : ''};@`;
}

function addSheet(workbook, name, usedNames, type, product) {
  const sheet = workbook.addWorksheet(worksheetName(name, usedNames), {
    views: [{ state: 'frozen', ySplit: 1, showGridLines: true }],
  });
  sheet.columns = headers.map((header, index) => ({ header, width: widths[index] }));
  sheet.getColumn(1).numFmt = 'm/d/yy';
  for (const column of [5, 6]) sheet.getColumn(column).alignment = { horizontal: 'right', vertical: 'middle' };
  for (const column of textColumns) sheet.getColumn(column).alignment = { wrapText: true, vertical: 'middle' };
  sheet.getRow(1).height = 36;
  sheet.getRow(1).eachCell((cell) => {
    cell.font = { name: 'Calibri', size: 12, bold: true };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
  sheet.getCell('D1').note = [
    `Type: ${text(type.name)}`,
    `Type ID: ${text(type.id)}`,
    ...(product ? [
      `Product: ${text(product.name)}`,
      `Product ID: ${text(product.id)}`,
      `Product Type: ${text(product.productType)}`,
      `Item Code: ${text(product.itemCode)}`,
      `MAK Item Code: ${text(product.makItemCode)}`,
      `Unit: ${text(product.unit)}`,
    ] : []),
  ].join('\n');
  if (product?.unit != null) {
    for (const column of ['E1', 'F1']) sheet.getCell(column).note = `Unit: ${text(product.unit)}`;
  }
  return sheet;
}

export function typeHistoryFilename(type) {
  const name = trimmed(type?.name)
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '-')
    .replace(/^[.\s]+|[.\s]+$/g, '');
  const safeName = (name.slice(0, 80).replace(/[.\s\uD800-\uDBFF]+$/g, '') || 'type');
  return `inventory-history-${safeName}.xlsx`;
}

export async function createTypeHistoryWorkbook(report) {
  if (!report?.type || (report.histories != null && !Array.isArray(report.histories))) {
    throw new Error('Select a product type before exporting its history.');
  }
  const histories = sortProducts((report.histories || []).map((history) => ({
    ...history?.product,
    history,
    entries: productHistoryEntries(history),
  })));
  const workbook = await createWorkbook();
  const usedNames = new Set();
  if (!histories.length) addSheet(workbook, trimmed(report.type.name) || 'Other', usedNames, report.type);

  for (const { history, entries } of histories) {
    const { product } = history;
    const name = trimmed(product.makItemCode) || trimmed(product.itemCode) || trimmed(product.name) || `Product-${text(product.id)}`;
    const sheet = addSheet(workbook, name, usedNames, report.type, product);
    let balance = 0;
    for (const entry of entries) {
      balance += (entry.receivedQuantity ?? 0) - (entry.usedQuantity ?? 0);
      if (!Number.isFinite(balance)) throw new Error('History closing balance must be a finite number.');
      const row = sheet.addRow([entry.date, entry.materialLotNumber, entry.releaseNumber, entry.description, entry.receivedQuantity, entry.usedQuantity, entry.usedAgainst]);
      row.font = { name: 'Calibri', size: 12, bold: entry.receiving };
      row.height = Math.max(20, ...textColumns.map((column) => {
        const lines = String(row.getCell(column).value ?? '').split(/\r?\n/);
        return 18 * lines.reduce((count, line) => count + Math.max(1, Math.ceil(line.length / (widths[column - 1] * 0.8))), 0) + 2;
      }));
      row.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
      for (const column of [5, 6]) row.getCell(column).numFmt = quantityFormat(row.getCell(column).value);
      if (!entry.receiving) {
        for (const column of [6, 7]) row.getCell(column).font = { name: 'Calibri', size: 12, color: { argb: 'FFFF0000' } };
      }
      if (entry.notes) row.getCell(entry.receiving ? 3 : 7).note = entry.notes;
    }
    const closing = sheet.addRow([null, null, null, 'Closing Balance', balance === 0 ? 0 : balance, null, null]);
    closing.height = 24;
    for (let column = 1; column <= headers.length; column++) {
      const cell = closing.getCell(column);
      cell.font = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FF008000' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2F0D9' } };
    }
    closing.getCell(5).numFmt = quantityFormat(balance, trimmed(product.unit), true);
  }
  return workbook;
}

export async function exportTypeHistoryWorkbook(report) {
  const workbook = await createTypeHistoryWorkbook(report);
  await downloadWorkbook(workbook, typeHistoryFilename(report.type));
}
