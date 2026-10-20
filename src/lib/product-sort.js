const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const text = (value) => String(value ?? '').trim();

export function sortProducts(products) {
  return [...products].sort((a, b) => {
    const left = text(a.makItemCode);
    const right = text(b.makItemCode);
    return Number(!left) - Number(!right)
      || collator.compare(left, right)
      || collator.compare(text(a.name), text(b.name))
      || collator.compare(text(a.itemCode), text(b.itemCode))
      || collator.compare(text(a.productType), text(b.productType))
      || Number(a.id) - Number(b.id);
  });
}
