export function lotIdentity(productId, materialLotNumber) {
  return JSON.stringify([String(productId), materialLotNumber ?? null]);
}

export function filterLotInventory(rows, { typeId = '', productId = '', search = '', status = '' } = {}) {
  const query = search.trim().toLocaleLowerCase();
  return rows.filter((row) => (!typeId || String(row.productTypeId) === typeId)
    && (!productId || String(row.productId) === productId)
    && (!query || [row.productName, row.itemCode, row.makItemCode, row.materialLotNumber,
      row.materialLotNumber == null ? 'Unassigned N/A' : ''].some((value) => String(value ?? '').toLocaleLowerCase().includes(query)))
    && (!status || (status === 'available' && Number(row.availableBalance) > 0)
      || (status === 'exhausted' && Number(row.availableBalance) === 0)
      || (status === 'negative' && Number(row.availableBalance) < 0)
      || (status === 'unassigned' && row.materialLotNumber == null)));
}
