-- Run manually as a database administrator in the existing inventory database, with the app stopped.
-- Back up the database first. Product IDs, names, codes, balances, and transactions are not changed.
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;
    DECLARE @ProductsId INT = OBJECT_ID(N'dbo.products', N'U');
    IF @ProductsId IS NULL
       OR COL_LENGTH(N'dbo.products', N'product_type_id') IS NULL
       OR COL_LENGTH(N'dbo.products', N'item_code') IS NULL
        THROW 50001, 'The existing products table, product_type_id, and item_code columns are required.', 1;

    SELECT product_type_id, item_code, COUNT(*) AS duplicate_count
    FROM dbo.products WITH (TABLOCKX, HOLDLOCK)
    GROUP BY product_type_id, item_code
    HAVING COUNT(*) > 1;
    IF @@ROWCOUNT > 0
        THROW 50002, 'Resolve the reported duplicate item codes within a product type and rerun. No schema changes were applied.', 1;

    DECLARE @GlobalIndexes TABLE (
        index_id INT PRIMARY KEY,
        name SYSNAME,
        is_unique_constraint BIT,
        is_primary_key BIT,
        has_filter BIT
    );
    INSERT INTO @GlobalIndexes (index_id, name, is_unique_constraint, is_primary_key, has_filter)
    SELECT i.index_id, i.name, i.is_unique_constraint, i.is_primary_key, i.has_filter
    FROM sys.indexes i
    WHERE i.object_id = @ProductsId AND i.is_unique = 1
      AND (SELECT COUNT(*) FROM sys.index_columns ic
           WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.key_ordinal > 0) = 1
      AND EXISTS (
          SELECT 1 FROM sys.index_columns ic JOIN sys.columns c
            ON c.object_id = ic.object_id AND c.column_id = ic.column_id
          WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id
            AND ic.key_ordinal > 0 AND c.name = N'item_code'
      );

    IF EXISTS (SELECT 1 FROM @GlobalIndexes WHERE is_primary_key = 1 OR has_filter = 1)
        THROW 50003, 'A primary key or filtered unique index uses item_code. Ask a database administrator to review it; nothing was changed.', 1;

    IF EXISTS (
        SELECT 1 FROM sys.foreign_keys fk JOIN @GlobalIndexes i ON i.index_id = fk.key_index_id
        WHERE fk.referenced_object_id = @ProductsId
    )
        THROW 50004, 'A foreign key references a global item-code key. It must be reviewed before changing uniqueness; nothing was changed.', 1;

    IF NOT EXISTS (
        SELECT 1 FROM sys.indexes i
        WHERE i.object_id = @ProductsId AND i.is_unique = 1 AND i.has_filter = 0 AND i.is_disabled = 0
          AND (SELECT COUNT(*) FROM sys.index_columns ic
               WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.key_ordinal > 0) = 2
          AND (SELECT COUNT(*) FROM sys.index_columns ic JOIN sys.columns c
                 ON c.object_id = ic.object_id AND c.column_id = ic.column_id
               WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id
                 AND ic.key_ordinal > 0 AND c.name IN (N'product_type_id', N'item_code')) = 2
    )
    BEGIN
        IF EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = @ProductsId AND name = N'UQ_products_product_type_item_code')
           OR OBJECT_ID(N'dbo.UQ_products_product_type_item_code') IS NOT NULL
            THROW 50005, 'The target constraint name is already used by a different object. Ask a database administrator to review it.', 1;

        ALTER TABLE dbo.products
            ADD CONSTRAINT UQ_products_product_type_item_code UNIQUE (product_type_id, item_code);
    END;

    -- Discover existing key names rather than assuming the SQL Server-generated constraint name.
    DECLARE @IndexId INT, @IndexName SYSNAME, @IsConstraint BIT, @Statement NVARCHAR(MAX);
    WHILE EXISTS (SELECT 1 FROM @GlobalIndexes)
    BEGIN
        SELECT TOP (1) @IndexId = index_id, @IndexName = name, @IsConstraint = is_unique_constraint
        FROM @GlobalIndexes ORDER BY index_id;
        SET @Statement = CASE WHEN @IsConstraint = 1
            THEN N'ALTER TABLE dbo.products DROP CONSTRAINT ' + QUOTENAME(@IndexName) + N';'
            ELSE N'DROP INDEX ' + QUOTENAME(@IndexName) + N' ON dbo.products;' END;
        EXEC sys.sp_executesql @Statement;
        DELETE FROM @GlobalIndexes WHERE index_id = @IndexId;
    END;

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
