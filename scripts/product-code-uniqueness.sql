-- Run manually as a database administrator in the existing inventory database, with the app stopped.
-- Back up the database first. Item Codes become reusable; nonblank MAK Item Codes stay unique per product type.
-- Product IDs, names, codes, balances, and transactions are not changed.
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;
    DECLARE @ProductsId INT = OBJECT_ID(N'dbo.products', N'U');
    IF @ProductsId IS NULL
       OR COL_LENGTH(N'dbo.products', N'product_type_id') IS NULL
       OR COL_LENGTH(N'dbo.products', N'item_code') IS NULL
       OR COL_LENGTH(N'dbo.products', N'mak_item_code') IS NULL
        THROW 50001, 'The existing products table and product_type_id, item_code, and mak_item_code columns are required.', 1;

    SELECT product_type_id, mak_item_code, COUNT(*) AS duplicate_count
    FROM dbo.products WITH (TABLOCKX, HOLDLOCK)
    WHERE mak_item_code IS NOT NULL AND mak_item_code <> N''
    GROUP BY product_type_id, mak_item_code
    HAVING COUNT(*) > 1;
    IF @@ROWCOUNT > 0
        THROW 50002, 'Resolve the reported duplicate MAK Item Codes within each product type and rerun. No schema changes were applied.', 1;

    DECLARE @Indexes TABLE (
        index_id INT PRIMARY KEY,
        name SYSNAME,
        is_unique_constraint BIT,
        is_primary_key BIT,
        has_filter BIT
    );
    INSERT INTO @Indexes (index_id, name, is_unique_constraint, is_primary_key, has_filter)
    SELECT i.index_id, i.name, i.is_unique_constraint, i.is_primary_key, i.has_filter
    FROM sys.indexes i
    WHERE i.object_id = @ProductsId AND i.is_unique = 1
      AND i.name <> N'UX_products_product_type_mak_item_code'
      AND (
          ((SELECT COUNT(*) FROM sys.index_columns ic
            WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.key_ordinal > 0) = 1
           AND EXISTS (
              SELECT 1 FROM sys.index_columns ic JOIN sys.columns c
                ON c.object_id = ic.object_id AND c.column_id = ic.column_id
              WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id
                AND ic.key_ordinal > 0 AND c.name IN (N'item_code', N'mak_item_code')
           ))
          OR
          ((SELECT COUNT(*) FROM sys.index_columns ic
            WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.key_ordinal > 0) = 2
           AND EXISTS (
              SELECT 1 FROM sys.index_columns ic JOIN sys.columns c
                ON c.object_id = ic.object_id AND c.column_id = ic.column_id
              WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id
                AND ic.key_ordinal > 0 AND c.name = N'product_type_id'
           )
           AND EXISTS (
              SELECT 1 FROM sys.index_columns ic JOIN sys.columns c
                ON c.object_id = ic.object_id AND c.column_id = ic.column_id
              WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id
                AND ic.key_ordinal > 0 AND c.name IN (N'item_code', N'mak_item_code')
           ))
      );

    IF EXISTS (SELECT 1 FROM @Indexes WHERE is_primary_key = 1 OR has_filter = 1)
        THROW 50003, 'A primary key or filtered unique product-code index requires administrator review; nothing was changed.', 1;

    IF EXISTS (
        SELECT 1 FROM sys.foreign_keys fk JOIN @Indexes i ON i.index_id = fk.key_index_id
        WHERE fk.referenced_object_id = @ProductsId
    )
        THROW 50004, 'A foreign key references a product-code unique key. Review it before changing uniqueness; nothing was changed.', 1;

    -- Remove item-code and MAK-code uniqueness keys so the exact policy below can be installed safely.
    DECLARE @IndexId INT, @IndexName SYSNAME, @IsConstraint BIT, @Statement NVARCHAR(MAX);
    WHILE EXISTS (SELECT 1 FROM @Indexes)
    BEGIN
        SELECT TOP (1) @IndexId = index_id, @IndexName = name, @IsConstraint = is_unique_constraint
        FROM @Indexes ORDER BY index_id;
        SET @Statement = CASE WHEN @IsConstraint = 1
            THEN N'ALTER TABLE dbo.products DROP CONSTRAINT ' + QUOTENAME(@IndexName) + N';'
            ELSE N'DROP INDEX ' + QUOTENAME(@IndexName) + N' ON dbo.products;' END;
        EXEC sys.sp_executesql @Statement;
        DELETE FROM @Indexes WHERE index_id = @IndexId;
    END;

    IF EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = @ProductsId AND name = N'UX_products_product_type_mak_item_code')
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM sys.indexes i
            WHERE i.object_id = @ProductsId AND i.name = N'UX_products_product_type_mak_item_code'
              AND i.is_unique = 1 AND i.has_filter = 1 AND i.is_disabled = 0
              AND (SELECT COUNT(*) FROM sys.index_columns ic
                   WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.key_ordinal > 0) = 2
              AND (SELECT COUNT(*) FROM sys.index_columns ic JOIN sys.columns c
                     ON c.object_id = ic.object_id AND c.column_id = ic.column_id
                   WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id
                     AND ic.key_ordinal > 0 AND c.name IN (N'product_type_id', N'mak_item_code')) = 2
        )
            THROW 50005, 'The target index name is already in use by an unrelated index. Ask a database administrator to review it.', 1;
    END
    ELSE
        CREATE UNIQUE INDEX UX_products_product_type_mak_item_code
            ON dbo.products (product_type_id, mak_item_code)
            WHERE mak_item_code IS NOT NULL AND mak_item_code <> N'';

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
