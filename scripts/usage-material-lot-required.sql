-- HISTORICAL migration: superseded by optional-material-lots.sql. Do not run for the current app.
-- Previously run manually as a database administrator in the existing inventory database with the app stopped.
-- Correct any reported historical records using their actual material lots, then rerun.
-- This script never invents lot numbers or changes transaction data.
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;
    IF COL_LENGTH(N'dbo.usage_transactions', N'material_lot_number') IS NULL
        THROW 50001, 'The existing usage_transactions.material_lot_number column is required.', 1;

    SELECT id, product_id, usage_date, material_lot_number
    FROM dbo.usage_transactions WITH (TABLOCKX, HOLDLOCK)
    WHERE material_lot_number IS NULL
       OR LEN(REPLACE(REPLACE(REPLACE(material_lot_number,
            NCHAR(9), N''), NCHAR(10), N''), NCHAR(13), N'')) = 0;
    IF @@ROWCOUNT > 0
        THROW 50002, 'Correct the reported usage records with actual material lot numbers before rerunning. No schema changes were applied.', 1;

    IF EXISTS (
        SELECT 1 FROM dbo.usage_transactions
        WHERE DATALENGTH(CONVERT(NVARCHAR(MAX), material_lot_number)) > 510
    )
        THROW 50003, 'Existing material lot numbers exceed 255 characters. Resolve them before rerunning. No schema changes were applied.', 1;

    IF EXISTS (
        SELECT 1 FROM sys.columns
        WHERE object_id = OBJECT_ID(N'dbo.usage_transactions') AND name = N'material_lot_number'
          AND (is_nullable = 1 OR system_type_id <> TYPE_ID(N'nvarchar') OR max_length <> 510)
    )
        ALTER TABLE dbo.usage_transactions
            ALTER COLUMN material_lot_number NVARCHAR(255) NOT NULL;

    IF NOT EXISTS (
        SELECT 1 FROM sys.check_constraints
        WHERE parent_object_id = OBJECT_ID(N'dbo.usage_transactions')
          AND name = N'CK_usage_transactions_material_lot_number_required'
    )
        ALTER TABLE dbo.usage_transactions WITH CHECK
            ADD CONSTRAINT CK_usage_transactions_material_lot_number_required
            CHECK (LEN(REPLACE(REPLACE(REPLACE(material_lot_number,
                NCHAR(9), N''), NCHAR(10), N''), NCHAR(13), N'')) > 0);

    ALTER TABLE dbo.usage_transactions WITH CHECK
        CHECK CONSTRAINT CK_usage_transactions_material_lot_number_required;
    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
