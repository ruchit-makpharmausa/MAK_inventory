export const inventoryHistoryRows = (history) => [
  ...history.receiving.map((row) => ['Receiving', row.date, row.makReleaseNumber, '', row.quantity, row.remarks]),
  ...history.usage.map((row) => ['Usage', row.date, '', row.makLotNumber, row.quantity, row.remarks]),
];

export const exportCsv = (filename, headers, rows) => {
  const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const csv = [headers, ...rows].map((row) => row.map(escape).join(',')).join('\r\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 0);
};
