import { downloadBlob } from './download.js';

export async function createWorkbook() {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'MAK Inventory';
  return workbook;
}

export function numericQuantity(value) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) throw new Error('Inventory quantities must be finite numbers.');
  return number;
}

export async function downloadWorkbook(workbook, filename) {
  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
}
