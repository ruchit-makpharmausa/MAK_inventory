-- Run manually as a database administrator in the existing inventory database.
-- Back up the database first and stop the app before running this migration.
-- Existing product types, products, and their transaction histories are assigned to Quten (TRV).
-- Company removal is archival; records are never deleted by this migration or company management.
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;

    IF OBJECT_ID(N'dbo.app_users', N'U') IS NULL
       OR OBJECT_ID(N'dbo.user_sessions', N'U') IS NULL
       OR OBJECT_ID(N'dbo.product_types', N'U') IS NULL
       OR OBJECT_ID(N'dbo.products', N'U') IS NULL
        THROW 50001, 'Existing login and inventory tables are required. Run the login and inventory setup first.', 1;

    IF OBJECT_ID(N'dbo.companies', N'U') IS NULL
    BEGIN
        CREATE TABLE dbo.companies (
            id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_companies PRIMARY KEY,
            name NVARCHAR(150) NOT NULL,
            code NVARCHAR(20) NOT NULL,
            is_active BIT NOT NULL CONSTRAINT DF_companies_is_active DEFAULT (1),
            created_at DATETIME2(3) NOT NULL CONSTRAINT DF_companies_created_at DEFAULT (SYSUTCDATETIME()),
            CONSTRAINT UQ_companies_code UNIQUE (code)
        );
    END;

    IF NOT EXISTS (SELECT 1 FROM dbo.companies WHERE code = N'TRV')
    BEGIN
        IF EXISTS (SELECT 1 FROM dbo.companies WHERE name = N'Quten')
            THROW 50002, 'A Quten company already exists without code TRV. Review the company row before rerunning.', 1;
        INSERT INTO dbo.companies (name, code) VALUES (N'Quten', N'TRV');
    END;

    DECLARE @QutenId INT = (SELECT id FROM dbo.companies WHERE code = N'TRV');
    IF NOT EXISTS (SELECT 1 FROM dbo.companies WHERE id = @QutenId AND name = N'Quten' AND is_active = 1)
        THROW 50003, 'Company code TRV must identify the active Quten company.', 1;

    IF COL_LENGTH(N'dbo.product_types', N'company_id') IS NULL
        ALTER TABLE dbo.product_types ADD company_id INT NULL;
    IF COL_LENGTH(N'dbo.products', N'company_id') IS NULL
        ALTER TABLE dbo.products ADD company_id INT NULL;
    IF COL_LENGTH(N'dbo.user_sessions', N'current_company_id') IS NULL
        ALTER TABLE dbo.user_sessions ADD current_company_id INT NULL;

    EXEC sys.sp_executesql N'UPDATE dbo.product_types SET company_id = @companyId WHERE company_id IS NULL;',
        N'@companyId INT', @companyId = @QutenId;
    EXEC sys.sp_executesql N'UPDATE dbo.products SET company_id = @companyId WHERE company_id IS NULL;',
        N'@companyId INT', @companyId = @QutenId;

    DECLARE @UnassignedTypes INT, @UnassignedProducts INT;
    EXEC sys.sp_executesql N'SELECT @count = COUNT(*) FROM dbo.product_types WHERE company_id IS NULL;',
        N'@count INT OUTPUT', @count = @UnassignedTypes OUTPUT;
    EXEC sys.sp_executesql N'SELECT @count = COUNT(*) FROM dbo.products WHERE company_id IS NULL;',
        N'@count INT OUTPUT', @count = @UnassignedProducts OUTPUT;
    IF @UnassignedTypes > 0 OR @UnassignedProducts > 0
        THROW 50004, 'All existing products and product types must be assigned to Quten before continuing.', 1;

    EXEC sys.sp_executesql N'ALTER TABLE dbo.product_types ALTER COLUMN company_id INT NOT NULL;';
    EXEC sys.sp_executesql N'ALTER TABLE dbo.products ALTER COLUMN company_id INT NOT NULL;';

    IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_product_types_company')
        EXEC sys.sp_executesql N'ALTER TABLE dbo.product_types WITH CHECK ADD CONSTRAINT FK_product_types_company FOREIGN KEY (company_id) REFERENCES dbo.companies(id);';
    IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_products_company')
        EXEC sys.sp_executesql N'ALTER TABLE dbo.products WITH CHECK ADD CONSTRAINT FK_products_company FOREIGN KEY (company_id) REFERENCES dbo.companies(id);';
    IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_user_sessions_current_company')
        EXEC sys.sp_executesql N'ALTER TABLE dbo.user_sessions WITH CHECK ADD CONSTRAINT FK_user_sessions_current_company FOREIGN KEY (current_company_id) REFERENCES dbo.companies(id);';

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.product_types') AND name = N'UQ_product_types_company_name')
        EXEC sys.sp_executesql N'CREATE UNIQUE INDEX UQ_product_types_company_name ON dbo.product_types (company_id, name);';
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.product_types') AND name = N'UQ_product_types_id_company')
        EXEC sys.sp_executesql N'CREATE UNIQUE INDEX UQ_product_types_id_company ON dbo.product_types (id, company_id);';

    IF NOT EXISTS (
        SELECT 1 FROM sys.foreign_keys
        WHERE parent_object_id = OBJECT_ID(N'dbo.products') AND name = N'FK_products_type_company'
    )
        EXEC sys.sp_executesql N'ALTER TABLE dbo.products WITH CHECK ADD CONSTRAINT FK_products_type_company FOREIGN KEY (product_type_id, company_id) REFERENCES dbo.product_types(id, company_id);';

    DECLARE @TypeNameIndexes TABLE (index_id INT PRIMARY KEY, name SYSNAME, is_constraint BIT);
    INSERT INTO @TypeNameIndexes (index_id, name, is_constraint)
    SELECT i.index_id, i.name, i.is_unique_constraint
    FROM sys.indexes i
    WHERE i.object_id = OBJECT_ID(N'dbo.product_types') AND i.is_unique = 1
      AND (SELECT COUNT(*) FROM sys.index_columns ic WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.key_ordinal > 0) = 1
      AND EXISTS (
          SELECT 1 FROM sys.index_columns ic JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
          WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.key_ordinal > 0 AND c.name = N'name'
      );

    DECLARE @IndexId INT, @IndexName SYSNAME, @IsConstraint BIT, @Statement NVARCHAR(MAX);
    WHILE EXISTS (SELECT 1 FROM @TypeNameIndexes)
    BEGIN
        SELECT TOP (1) @IndexId = index_id, @IndexName = name, @IsConstraint = is_constraint
        FROM @TypeNameIndexes ORDER BY index_id;
        SET @Statement = CASE WHEN @IsConstraint = 1
            THEN N'ALTER TABLE dbo.product_types DROP CONSTRAINT ' + QUOTENAME(@IndexName) + N';'
            ELSE N'DROP INDEX ' + QUOTENAME(@IndexName) + N' ON dbo.product_types;' END;
        EXEC sys.sp_executesql @Statement;
        DELETE FROM @TypeNameIndexes WHERE index_id = @IndexId;
    END;

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
