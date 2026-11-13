import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { expectedColumns } from '../server/database.js';

const migration = readFileSync(new URL('../scripts/receiving-location.sql', import.meta.url), 'utf8');

test('receiving location is required in the app schema and added without fabricating historical values', () => {
  assert.ok(expectedColumns.receiving_transactions.includes('location'));
  assert.match(migration, /ALTER TABLE dbo\.receiving_transactions ADD location NVARCHAR\(50\) NULL/);
  assert.match(migration, /historical locations stay NULL/);
  assert.match(migration, /BEGIN TRANSACTION/);
  assert.match(migration, /BEGIN CATCH\s+IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;/);
  assert.doesNotMatch(migration, /UPDATE dbo\.receiving_transactions|DELETE FROM dbo\.receiving_transactions/);
});
