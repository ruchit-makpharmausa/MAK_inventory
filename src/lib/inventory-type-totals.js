import { unitOption } from './format.js';

export function inventoryTypeTotals(products, types, shipments = []) {
  const groups = new Map(types.map((type) => [String(type.id), { id: String(type.id), name: type.name, units: new Map() }]));
  const shippedByProductId = new Map();
  for (const shipment of shipments) {
    const key = String(shipment.shippedProductId);
    shippedByProductId.set(key, (shippedByProductId.get(key) || 0) + Number(shipment.quantity || 0));
  }
  for (const product of products) {
    const typeId = String(product.productTypeId ?? 'other');
    if (!groups.has(typeId)) groups.set(typeId, { id: typeId, name: product.productType || 'Other', units: new Map() });
    const group = groups.get(typeId);
    const unit = unitOption(product.unit);
    if (!group.units.has(unit)) group.units.set(unit, { unit, received: 0, used: 0, balance: 0, shipped: 0 });
    const totals = group.units.get(unit);
    const received = Number(product.totalReceived ?? 0);
    const used = Number(product.totalUsed ?? 0);
    totals.received += received;
    totals.used += used;
    totals.balance += Number(product.availableBalance ?? received - used);
    totals.shipped += shippedByProductId.get(String(product.id)) || 0;
  }
  return [...groups.values()].map((group) => ({ ...group, units: [...group.units.values()] }));
}
