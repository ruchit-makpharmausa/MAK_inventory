import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL('../scripts/product-code-uniqueness.sql', import.meta.url), 'utf8');

test('product-code migration makes nonblank MAK Item Codes unique per type and leaves Item Codes reusable', () => {
  assert.match(migration, /CREATE UNIQUE INDEX UX_products_product_type_mak_item_code\s+ON dbo\.products \(product_type_id, mak_item_code\)/);
  assert.match(migration, /WHERE mak_item_code IS NOT NULL AND mak_item_code <> N''/);
  assert.match(migration, /GROUP BY product_type_id, mak_item_code\s+HAVING COUNT\(\*\) > 1/);
  assert.match(migration, /IF @@ROWCOUNT > 0\s+THROW 50002/);
  assert.match(migration, /c\.name IN \(N'item_code', N'mak_item_code'\)/);
  assert.match(migration, /c\.name IN \(N'item_code', N'mak_item_code'\)/);
  assert.doesNotMatch(migration, /ADD CONSTRAINT [^\n]*item_code UNIQUE \(product_type_id, item_code\)/);
  assert.doesNotMatch(migration, /\b(?:UPDATE|DELETE FROM|INSERT INTO|MERGE)\s+(?:dbo\.)?(?:products|receiving_transactions|usage_transactions)\b/i);
  assert.doesNotMatch(migration, /ALTER COLUMN|DROP TABLE|ADD\s+(?:CONSTRAINT\s+\w+\s+)?FOREIGN KEY|TRUNCATE TABLE/i);
});

test('product-code migration discovers legacy code keys safely and guards dependencies', () => {
  assert.match(migration, /i\.object_id = @ProductsId AND i\.is_unique = 1/);
  assert.match(migration, /ic\.key_ordinal > 0\) = 1/);
  assert.match(migration, /ic\.key_ordinal > 0\) = 2/);
  assert.match(migration, /WHERE is_primary_key = 1 OR has_filter = 1/);
  assert.match(migration, /sys\.foreign_keys fk JOIN @Indexes i ON i\.index_id = fk\.key_index_id/);
  assert.match(migration, /fk\.referenced_object_id = @ProductsId/);
  assert.match(migration, /ALTER TABLE dbo\.products DROP CONSTRAINT/);
  assert.match(migration, /DROP INDEX/);
  assert.match(migration, /QUOTENAME\(@IndexName\)/);
});

test('product-code migration is atomic and safe to rerun', () => {
  assert.match(migration, /SET XACT_ABORT ON/);
  assert.match(migration, /BEGIN TRANSACTION/);
  assert.match(migration, /WITH \(TABLOCKX, HOLDLOCK\)/);
  assert.match(migration, /i\.name = N'UX_products_product_type_mak_item_code'/);
  assert.match(migration, /COMMIT TRANSACTION/);
  assert.match(migration, /BEGIN CATCH\s+IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;\s+THROW;/);
});
