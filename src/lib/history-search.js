export function filterTransactionHistory(rows, search = '') {
  const query = String(search).trim().toLocaleLowerCase();
  if (!query) return rows;
  return rows.filter((row) => [row.materialLotNumber, row.sourceMaterialLotNumber, row.destinationMakLotNumber,
    row.location, row.makReleaseNumber, row.makLotNumber, row.remarks,
    row.sourceProductName, row.sourceItemCode, row.destinationProductName, row.destinationItemCode, row.addedBy]
    .some((value) => String(value ?? '').toLocaleLowerCase().includes(query)));
}
