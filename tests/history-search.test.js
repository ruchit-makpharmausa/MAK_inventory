import assert from 'node:assert/strict';
import test from 'node:test';
import { filterTransactionHistory } from '../src/lib/history-search.js';

const rows = [
  { id: 1, materialLotNumber: 'MAT-A2A', location: 'A2A', makReleaseNumber: 'RN-11', remarks: 'Received' },
  { id: 2, materialLotNumber: 'MAT-B4', makLotNumber: 'TRV-LOT-25', remarks: 'Issued' },
  { id: 3, materialLotNumber: null, makLotNumber: 'TRV-LOT-26' },
];

test('transaction history search matches Material Lot number, location, release/MAK lot, transfer and remarks', () => {
  for (const [query, expectedId] of [
    ['mat-a2a', 1], ['A2A', 1], ['rn-11', 1], ['TRV-LOT-25', 2], ['issued', 2], ['unmatched', undefined],
  ]) {
    assert.deepEqual(filterTransactionHistory(rows, query).map((row) => row.id), expectedId === undefined ? [] : [expectedId]);
  }
  const transfers = [{ id: 4, sourceMaterialLotNumber: 'TRANSFER-SOURCE', destinationMakLotNumber: 'TRV-MAK-4' }];
  assert.deepEqual(filterTransactionHistory(transfers, 'transfer-source'), transfers);
  assert.deepEqual(filterTransactionHistory(transfers, 'TRV-MAK-4'), transfers);
  assert.deepEqual(filterTransactionHistory(rows, '  '), rows);
});
