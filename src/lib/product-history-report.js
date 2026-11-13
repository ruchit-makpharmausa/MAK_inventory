import { numericQuantity } from './excel.js';

export const productHistoryHeaders = ['Date', 'Material Lot Number', 'Location', 'Item/Description', 'Qty', 'Used Qty', 'Used Against(MAK Lot No)'];

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
  const transfers = (history.transfers || []).map((transfer) => {
    const incoming = transfer.direction === 'in';
    const otherProduct = incoming ? transfer.sourceProductName : transfer.destinationProductName;
    const otherCode = incoming ? transfer.sourceItemCode : transfer.destinationItemCode;
    const remarks = `Inventory transfer #${transfer.id}: ${incoming ? 'from' : 'to'} ${otherProduct} (${otherCode}); destination MAK lot ${transfer.destinationMakLotNumber}${transfer.addedBy ? `; added by ${transfer.addedBy}` : ''}.`;
    return {
      row: {
        id: -Math.abs(Number(transfer.id)), date: transfer.date, quantity: transfer.quantity,
        materialLotNumber: incoming ? null : transfer.sourceMaterialLotNumber,
        location: '', makReleaseNumber: '', makLotNumber: transfer.destinationMakLotNumber,
        remarks, transfer: true,
      },
      receiving: incoming, transfer: true, otherProduct, date: transactionDate(transfer.date),
    };
  });
  return [
    ...(history.receiving || []).map((row) => ({ row, receiving: true, transfer: false, date: transactionDate(row.date) })),
    ...(history.usage || []).map((row) => ({ row, receiving: false, transfer: false, date: transactionDate(row.date) })),
    ...transfers,
  ].sort((a, b) => a.date.getTime() - b.date.getTime() || Number(b.receiving) - Number(a.receiving) || Number(a.row.id || 0) - Number(b.row.id || 0))
    .map(({ row, receiving, transfer, otherProduct, date }) => {
      const amount = numericQuantity(row.quantity);
      return {
        date, receiving, transfer,
        materialLotNumber: String(row.materialLotNumber ?? '').trim() || (receiving ? '' : 'N/A'),
        location: receiving ? String(row.location ?? '').trim() : '',
        releaseNumber: receiving ? String(row.makReleaseNumber ?? '') : '',
        description: transfer ? `${receiving ? 'Transfer in from' : 'Transfer out to'} ${otherProduct} · MAK lot ${row.makLotNumber}`
          : receiving ? String(history.product.name ?? '') : '',
        receivedQuantity: receiving ? amount : null,
        usedQuantity: receiving ? null : amount,
        usedAgainst: receiving ? '' : usedAgainst(row.makLotNumber),
        notes: [
          !transfer && receiving && row.makReleaseNumber ? `MAK Release Number: ${row.makReleaseNumber}` : '',
          row.materialLotNumber ? `Material lot number: ${row.materialLotNumber}` : '',
          row.remarks ? `Remarks: ${row.remarks}` : '',
        ].filter(Boolean).join('\n'),
      };
    });
}
