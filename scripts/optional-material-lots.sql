-- Run manually as a database administrator in the existing inventory database with the app stopped.
-- Back up the database first. This supersedes usage-material-lot-required.sql.
-- For the current app, run mak-release-number.sql afterward. Already-renamed release columns are preserved.
-- On the first run, existing receiving references move from material_lot_number to mak_rn_number.
-- Existing usage material lots, transaction IDs, dates, and quantities are preserved.
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;
    IF COL_LENGTH(N'dbo.receiving_transactions', N'material_lot_number') IS NULL
       OR COL_LENGTH(N'dbo.usage_transactions', N'material_lot_number') IS NULL
        THROW 50001, 'The existing receiving and usage material_lot_number columns are required.', 1;

    DECLARE @Rows BIGINT;
    SELECT @Rows = COUNT_BIG(*) FROM dbo.receiving_transactions WITH (TABLOCKX, HOLDLOCK);
    SELECT @Rows = COUNT_BIG(*) FROM dbo.usage_transactions WITH (TABLOCKX, HOLDLOCK);

    IF EXISTS (SELECT 1 FROM dbo.receiving_transactions
               WHERE DATALENGTH(CONVERT(NVARCHAR(MAX), material_lot_number)) > 510)
       OR EXISTS (SELECT 1 FROM dbo.usage_transactions
                  WHERE DATALENGTH(CONVERT(NVARCHAR(MAX), material_lot_number)) > 510)
        THROW 50002, 'Existing material-lot/reference values exceed 255 characters. Resolve them before rerunning; nothing was changed.', 1;

    IF EXISTS (SELECT 1 FROM sys.check_constraints
               WHERE parent_object_id = OBJECT_ID(N'dbo.usage_transactions')
                 AND name = N'CK_usage_transactions_material_lot_number_required')
        ALTER TABLE dbo.usage_transactions
            DROP CONSTRAINT CK_usage_transactions_material_lot_number_required;

    IF EXISTS (SELECT 1 FROM sys.columns
               WHERE object_id = OBJECT_ID(N'dbo.usage_transactions') AND name = N'material_lot_number'
                 AND (is_nullable = 0 OR system_type_id <> TYPE_ID(N'nvarchar') OR max_length <> 510))
        ALTER TABLE dbo.usage_transactions ALTER COLUMN material_lot_number NVARCHAR(255) NULL;

    IF EXISTS (SELECT 1 FROM sys.columns
               WHERE object_id = OBJECT_ID(N'dbo.receiving_transactions') AND name = N'material_lot_number'
                 AND (is_nullable = 0 OR system_type_id <> TYPE_ID(N'nvarchar') OR max_length <> 510))
        ALTER TABLE dbo.receiving_transactions ALTER COLUMN material_lot_number NVARCHAR(255) NULL;

    IF COL_LENGTH(N'dbo.receiving_transactions', N'mak_rn_number') IS NULL
       AND COL_LENGTH(N'dbo.receiving_transactions', N'mak_release_number') IS NULL
    BEGIN
        ALTER TABLE dbo.receiving_transactions ADD mak_rn_number NVARCHAR(255) NULL;
        -- Compile after the new column exists; the column guard prevents moving new lots on reruns.
        EXEC sys.sp_executesql N'UPDATE dbo.receiving_transactions
            SET mak_rn_number = material_lot_number, material_lot_number = NULL;';
    END;

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
