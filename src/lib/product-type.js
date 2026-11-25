export function isFinishedGoodsType(value) {
  const name = String(value || '').trim().toLowerCase();
  return name === 'finished goods' || name === 'finished product';
}
