import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL('../scripts/mak-release-number.sql', import.meta.url), 'utf8');

test('release-number migration only renames the receiving column and preserves all existing values', () => {
  assert.match(migration, /EXEC sys\.sp_rename N'dbo\.receiving_transactions\.mak_rn_number', N'mak_release_number', N'COLUMN';/);
  assert.doesNotMatch(migration, /\b(?:UPDATE|INSERT|DELETE|MERGE|TRUNCATE|DROP|ADD|ALTER COLUMN)\b/i);
  assert.doesNotMatch(migration, /usage_transactions/);
});

test('release-number migration handles reruns and refuses ambiguous schemas and SQL dependencies', () => {
  assert.match(migration, /IF @OldColumnId IS NOT NULL AND @NewColumnId IS NOT NULL\s+THROW 50002/);
  assert.match(migration, /IF @OldColumnId IS NULL AND @NewColumnId IS NULL\s+THROW 50003/);
  assert.match(migration, /IF @OldColumnId IS NOT NULL\s+BEGIN/);
  assert.match(migration, /sys\.sql_expression_dependencies/);
  assert.match(migration, /referenced_id = @ReceivingId AND referenced_minor_id IN \(0, @OldColumnId\)/);
  assert.ok(migration.indexOf('THROW 50004') < migration.indexOf('EXEC sys.sp_rename'));
});

test('release-number migration is locked and transactional with rollback on failure', () => {
  assert.match(migration, /SET XACT_ABORT ON/);
  assert.match(migration, /BEGIN TRANSACTION/);
  assert.match(migration, /WITH \(TABLOCKX, HOLDLOCK\)/);
  assert.match(migration, /COMMIT TRANSACTION/);
  assert.match(migration, /BEGIN CATCH\s+IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;\s+THROW;/);
});
