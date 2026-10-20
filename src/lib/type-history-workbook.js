import { createWorkbook, downloadWorkbook, worksheetName } from './excel.js';
import { productHistoryEntries } from './product-history-report.js';
import { sortProducts } from './product-sort.js';

const headers = ['Date', 'MAK Release Number', 'Item/Description', 'Qty', 'Used Qty', 'Used Against(MAK Lot No)'];
const widths = [14, 24, 55, 18, 18, 34];
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
  for (const column of [4, 5]) sheet.getColumn(column).alignment = { horizontal: 'right', vertical: 'middle' };
  for (const column of [2, 3, 6]) sheet.getColumn(column).alignment = { wrapText: true, vertical: 'middle' };
  sheet.getRow(1).height = 32;
  sheet.getRow(1).eachCell((cell) => {
    cell.font = { name: 'Calibri', size: 11, bold: true };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
  sheet.getCell('C1').note = [
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
    for (const column of ['D1', 'E1']) sheet.getCell(column).note = `Unit: ${text(product.unit)}`;
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
      const row = sheet.addRow([entry.date, entry.releaseNumber, entry.description, entry.receivedQuantity, entry.usedQuantity, entry.usedAgainst]);
      row.font = { name: 'Calibri', size: 11, bold: entry.receiving };
      row.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
      for (const column of [4, 5]) row.getCell(column).numFmt = quantityFormat(row.getCell(column).value);
      if (!entry.receiving) {
        for (const column of [5, 6]) row.getCell(column).font = { name: 'Calibri', size: 11, color: { argb: 'FFFF0000' } };
      }
      if (entry.notes) row.getCell(entry.receiving ? 2 : 6).note = entry.notes;
    }
    const closing = sheet.addRow([null, null, 'Closing Balance', balance === 0 ? 0 : balance, null, null]);
    closing.height = 22;
    for (let column = 1; column <= headers.length; column++) {
      const cell = closing.getCell(column);
      cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF008000' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2F0D9' } };
    }
    closing.getCell(4).numFmt = quantityFormat(balance, trimmed(product.unit), true);
  }
  return workbook;
}

export async function exportTypeHistoryWorkbook(report) {
  const workbook = await createTypeHistoryWorkbook(report);
  await downloadWorkbook(workbook, typeHistoryFilename(report.type));
}
