import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL('../scripts/product-item-code-per-type.sql', import.meta.url), 'utf8');

test('item-code migration enforces uniqueness by product type without renaming products', () => {
  assert.match(migration, /ADD CONSTRAINT UQ_products_product_type_item_code UNIQUE \(product_type_id, item_code\)/);
  assert.match(migration, /GROUP BY product_type_id, item_code\s+HAVING COUNT\(\*\) > 1/);
  assert.match(migration, /IF @@ROWCOUNT > 0\s+THROW 50002/);
  assert.ok(migration.indexOf('THROW 50002') < migration.indexOf('ADD CONSTRAINT'));
  assert.doesNotMatch(migration, /\b(?:UPDATE|DELETE FROM|INSERT INTO|MERGE)\s+(?:dbo\.)?(?:products|receiving_transactions|usage_transactions)\b/i);
  assert.doesNotMatch(migration, /ALTER COLUMN|DROP TABLE|ADD\s+(?:CONSTRAINT\s+\w+\s+)?FOREIGN KEY|TRUNCATE TABLE/i);
});

test('item-code migration discovers only single-key item-code unique indexes and guards dependencies', () => {
  assert.match(migration, /i\.object_id = @ProductsId AND i\.is_unique = 1/);
  assert.match(migration, /ic\.key_ordinal > 0\) = 1/);
  assert.match(migration, /ic\.key_ordinal > 0 AND c\.name = N'item_code'/);
  assert.match(migration, /WHERE is_primary_key = 1 OR has_filter = 1/);
  assert.match(migration, /sys\.foreign_keys fk JOIN @GlobalIndexes i ON i\.index_id = fk\.key_index_id/);
  assert.match(migration, /fk\.referenced_object_id = @ProductsId/);
  assert.match(migration, /ALTER TABLE dbo\.products DROP CONSTRAINT/);
  assert.match(migration, /DROP INDEX/);
  assert.match(migration, /QUOTENAME\(@IndexName\)/);
});

test('item-code migration is atomic and accepts equivalent existing per-type unique keys', () => {
  assert.match(migration, /SET XACT_ABORT ON/);
  assert.match(migration, /BEGIN TRANSACTION/);
  assert.match(migration, /WITH \(TABLOCKX, HOLDLOCK\)/);
  assert.match(migration, /IF NOT EXISTS \([\s\S]+i\.has_filter = 0 AND i\.is_disabled = 0/);
  assert.match(migration, /ic\.key_ordinal > 0\) = 2/);
  assert.match(migration, /c\.name IN \(N'product_type_id', N'item_code'\)\) = 2/);
  assert.ok(migration.indexOf('ADD CONSTRAINT') < migration.indexOf('DROP CONSTRAINT'));
  assert.match(migration, /COMMIT TRANSACTION/);
  assert.match(migration, /BEGIN CATCH\s+IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;\s+THROW;/);
});
