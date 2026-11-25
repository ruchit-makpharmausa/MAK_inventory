import assert from 'node:assert/strict';
import test from 'node:test';
import { filterTypeHistoryReport, inExportDateRange } from '../src/lib/export-date-range.js';

test('export date bounds are inclusive and optional', () => {
  const rows = [
    { date: '2026-11-01' }, { date: '2026-11-15' }, { date: '2026-11-30' }, { date: 'bad-date' },
  ];
  assert.deepEqual(rows.filter((row) => inExportDateRange(row, { fromDate: '2026-11-15', toDate: '2026-11-30' })), rows.slice(1, 3));
  assert.deepEqual(rows.filter((row) => inExportDateRange(row, { fromDate: '2026-11-15' })), rows.slice(1, 3));
  assert.deepEqual(rows.filter((row) => inExportDateRange(row, { toDate: '2026-11-15' })), rows.slice(0, 2));
  assert.deepEqual(rows.filter((row) => inExportDateRange(row)), rows);
});

test('type export date ranges filter receiving, usage, and transfer history without dropping products', () => {
  const report = { type: { id: 1, name: 'Finished Product' }, histories: [{
    product: { id: 9 },
    receiving: [{ date: '2026-11-01' }, { date: '2026-11-20' }],
    usage: [{ date: '2026-11-10' }, { date: '2026-11-21' }],
    transfers: [{ date: '2026-11-15' }],
  }, { product: { id: 10 }, receiving: [], usage: [], transfers: [] }] };
  const filtered = filterTypeHistoryReport(report, { fromDate: '2026-11-10', toDate: '2026-11-20' });
  assert.deepEqual(filtered.histories[0].receiving, [{ date: '2026-11-20' }]);
  assert.deepEqual(filtered.histories[0].usage, [{ date: '2026-11-10' }]);
  assert.deepEqual(filtered.histories[0].transfers, [{ date: '2026-11-15' }]);
  assert.deepEqual(filtered.histories[1], report.histories[1]);
  assert.deepEqual(report.histories[0].receiving, [{ date: '2026-11-01' }, { date: '2026-11-20' }]);
});
