import { numericQuantity } from './excel.js';

export const productHistoryHeaders = ['Date', 'Material Lot Number', 'Item/Description', 'Qty', 'Used Qty', 'Used Against(MAK Lot No)'];

function transactionDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('History contains an invalid transaction date.');
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('History contains an invalid transaction date.');
  return date;
}

function usedAgainst(value) {
  const lot = String(value ?? '').trim().replace(/^(?:lot\s*#\s*|#+\s*)+/i, '').trim();
  return lot ? `#${lot}` : '';
}

export function productHistoryFilename(product, extension = 'xlsx') {
  if (!['xlsx', 'pdf'].includes(extension)) throw new Error('Unsupported history export format.');
  const code = String(product.itemCode || product.name || 'product')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim() || 'product';
  return `inventory-history-${Array.from(code).slice(0, 80).join('')}.${extension}`;
}

export function productHistoryEntries(history) {
  if (!history?.product) throw new Error('Select a product before exporting its history.');
  return [
    ...(history.receiving || []).map((row) => ({ row, receiving: true, date: transactionDate(row.date) })),
    ...(history.usage || []).map((row) => ({ row, receiving: false, date: transactionDate(row.date) })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime() || Number(b.receiving) - Number(a.receiving) || Number(a.row.id || 0) - Number(b.row.id || 0))
    .map(({ row, receiving, date }) => {
      const amount = numericQuantity(row.quantity);
      return {
        date, receiving,
        materialLotNumber: String(row.materialLotNumber ?? '').trim() || (receiving ? '' : 'N/A'),
        releaseNumber: receiving ? String(row.makReleaseNumber ?? '') : '',
        description: receiving ? String(history.product.name ?? '') : '',
        receivedQuantity: receiving ? amount : null,
        usedQuantity: receiving ? null : amount,
        usedAgainst: receiving ? '' : usedAgainst(row.makLotNumber),
        notes: [
          receiving && row.makReleaseNumber ? `MAK Release Number: ${row.makReleaseNumber}` : '',
          row.materialLotNumber ? `Material lot number: ${row.materialLotNumber}` : '',
          row.remarks ? `Remarks: ${row.remarks}` : '',
        ].filter(Boolean).join('\n'),
      };
    });
}
