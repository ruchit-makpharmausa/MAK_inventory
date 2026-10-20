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

export function worksheetName(name, usedNames) {
  let base = String(name ?? '').replace(/[\\/?*[\]:\u0000-\u001f\u007f]/g, '-').replace(/^['\s]+|['\s]+$/g, '') || 'Other';
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

export async function downloadWorkbook(workbook, filename) {
  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
}
