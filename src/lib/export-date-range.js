export function inExportDateRange(row, { fromDate = '', toDate = '' } = {}) {
  if (!fromDate && !toDate) return true;
  const date = String(row?.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  return (!fromDate || date >= fromDate) && (!toDate || date <= toDate);
}

export function filterTypeHistoryReport(report, range) {
  return {
    ...report,
    histories: report.histories.map((history) => ({
      ...history,
      receiving: history.receiving.filter((row) => inExportDateRange(row, range)),
      usage: history.usage.filter((row) => inExportDateRange(row, range)),
      transfers: history.transfers.filter((row) => inExportDateRange(row, range)),
    })),
  };
}
