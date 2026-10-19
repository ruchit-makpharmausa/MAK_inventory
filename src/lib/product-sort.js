export const productSortOptions = [
  { value: 'name-asc', label: 'Product name (A–Z)', field: 'name', direction: 1 },
  { value: 'name-desc', label: 'Product name (Z–A)', field: 'name', direction: -1 },
  { value: 'mak-code-asc', label: 'MAK Item Code (A–Z)', field: 'makItemCode', direction: 1 },
  { value: 'mak-code-desc', label: 'MAK Item Code (Z–A)', field: 'makItemCode', direction: -1 },
];

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const text = (value) => String(value ?? '').trim();

export function sortProducts(products, sortOrder = 'name-asc') {
  const { field, direction } = productSortOptions.find((option) => option.value === sortOrder) || productSortOptions[0];
  return [...products].sort((a, b) => {
    const left = text(a[field]);
    const right = text(b[field]);
    return Number(!left) - Number(!right)
      || direction * collator.compare(left, right)
      || collator.compare(text(a.name), text(b.name))
      || collator.compare(text(a.itemCode), text(b.itemCode))
      || collator.compare(text(a.productType), text(b.productType))
      || Number(a.id) - Number(b.id);
  });
}
