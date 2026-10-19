import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL('../scripts/optional-material-lots.sql', import.meta.url), 'utf8');

test('optional-lot upgrade removes the required usage check and allows NULL in both material lots', () => {
  assert.match(migration, /DROP CONSTRAINT CK_usage_transactions_material_lot_number_required/);
  for (const table of ['receiving_transactions', 'usage_transactions']) {
    assert.match(migration, new RegExp(`ALTER TABLE dbo\\.${table} ALTER COLUMN material_lot_number NVARCHAR\\(255\\) NULL`));
  }
  assert.doesNotMatch(migration, /ALTER COLUMN material_lot_number NVARCHAR\(255\) NOT NULL/);
  assert.doesNotMatch(migration, /UPDATE dbo\.usage_transactions|DELETE FROM dbo\.|TRUNCATE TABLE|FOREIGN KEY/i);
});

test('first upgrade preserves legacy receiving RN values separately and does not repeat the copy', () => {
  assert.match(migration, /IF COL_LENGTH\(N'dbo\.receiving_transactions', N'mak_rn_number'\) IS NULL\s+AND COL_LENGTH\(N'dbo\.receiving_transactions', N'mak_release_number'\) IS NULL\s+BEGIN\s+ALTER TABLE dbo\.receiving_transactions ADD mak_rn_number NVARCHAR\(255\) NULL;[\s\S]+EXEC sys\.sp_executesql N'UPDATE dbo\.receiving_transactions\s+SET mak_rn_number = material_lot_number, material_lot_number = NULL;';\s+END;/);
  assert.match(migration, /DATALENGTH\(CONVERT\(NVARCHAR\(MAX\), material_lot_number\)\) > 510/);
  assert.ok(migration.indexOf('THROW 50002') < migration.indexOf('ALTER TABLE'));
});

test('optional-lot upgrade locks existing transactions and rolls back all schema and reference changes on error', () => {
  assert.match(migration, /SET XACT_ABORT ON/);
  assert.match(migration, /BEGIN TRANSACTION/);
  assert.equal((migration.match(/WITH \(TABLOCKX, HOLDLOCK\)/g) || []).length, 2);
  assert.match(migration, /COMMIT TRANSACTION/);
  assert.match(migration, /BEGIN CATCH\s+IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;\s+THROW;/);
});
