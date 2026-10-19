export const today = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
};
export const quantity = (value) => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });
export const dateLabel = (value) => value ? new Date(`${value}T00:00:00`).toLocaleDateString() : '—';
export const productUnits = ['Pcs', 'kgs'];
export const unitOption = (value) => {
  const unit = value?.trim().toLowerCase();
  if (unit === 'pcs') return 'Pcs';
  if (unit === 'kg' || unit === 'kgs') return 'kgs';
  return value || '';
};
