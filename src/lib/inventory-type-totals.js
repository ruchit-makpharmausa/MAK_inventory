import { unitOption } from './format.js';

export function inventoryTypeTotals(products, types) {
  const groups = new Map(types.map((type) => [String(type.id), { id: String(type.id), name: type.name, units: new Map() }]));
  for (const product of products) {
    const typeId = String(product.productTypeId ?? 'other');
    if (!groups.has(typeId)) groups.set(typeId, { id: typeId, name: product.productType || 'Other', units: new Map() });
    const group = groups.get(typeId);
    const unit = unitOption(product.unit);
    if (!group.units.has(unit)) group.units.set(unit, { unit, received: 0, used: 0, balance: 0 });
    const totals = group.units.get(unit);
    const received = Number(product.totalReceived ?? 0);
    const used = Number(product.totalUsed ?? 0);
    totals.received += received;
    totals.used += used;
    totals.balance += Number(product.availableBalance ?? received - used);
  }
  return [...groups.values()].map((group) => ({ ...group, units: [...group.units.values()] }));
}
