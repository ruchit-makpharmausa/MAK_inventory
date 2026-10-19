import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL('../scripts/usage-material-lot-required.sql', import.meta.url), 'utf8');

test('manual migration requires nonblank usage material lots without linking receiving or other fields', () => {
  assert.match(migration, /ALTER COLUMN material_lot_number NVARCHAR\(255\) NOT NULL/);
  assert.match(migration, /ALTER TABLE dbo\.usage_transactions WITH CHECK\s+ADD CONSTRAINT CK_usage_transactions_material_lot_number_required/);
  assert.match(migration, /CHECK \(LEN\(REPLACE\(REPLACE\(REPLACE\(material_lot_number,\s+NCHAR\(9\), N''\), NCHAR\(10\), N''\), NCHAR\(13\), N''\)\) > 0\)/);
  assert.match(migration, /WITH CHECK\s+CHECK CONSTRAINT CK_usage_transactions_material_lot_number_required/);
  assert.doesNotMatch(migration, /receiving_transactions|mak_lot_number|FOREIGN KEY|REFERENCES/i);
});

test('manual migration stops on invalid history and rolls back without rewriting records', () => {
  assert.match(migration, /SET XACT_ABORT ON/);
  assert.match(migration, /BEGIN TRANSACTION/);
  assert.match(migration, /WITH \(TABLOCKX, HOLDLOCK\)/);
  assert.match(migration, /WHERE material_lot_number IS NULL/);
  assert.match(migration, /IF @@ROWCOUNT > 0\s+THROW 50002/);
  assert.match(migration, /DATALENGTH\(CONVERT\(NVARCHAR\(MAX\), material_lot_number\)\) > 510/);
  assert.ok(migration.indexOf('THROW 50003') < migration.indexOf('ALTER COLUMN'));
  assert.match(migration, /IF NOT EXISTS \([\s\S]+sys\.check_constraints/);
  assert.match(migration, /COMMIT TRANSACTION/);
  assert.match(migration, /BEGIN CATCH\s+IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;\s+THROW;/);
  assert.doesNotMatch(migration, /^\s*(UPDATE|DELETE|INSERT|MERGE)\b/im);
});
