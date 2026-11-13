-- Run manually as a database administrator in the existing inventory database.
-- Back up the database first and stop the app before running this migration.
-- Existing receipts remain unchanged; historical locations stay NULL until backfilled.
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;

    IF OBJECT_ID(N'dbo.receiving_transactions', N'U') IS NULL
        THROW 50001, 'The existing dbo.receiving_transactions table is required.', 1;

    IF COL_LENGTH(N'dbo.receiving_transactions', N'location') IS NULL
        ALTER TABLE dbo.receiving_transactions ADD location NVARCHAR(50) NULL;

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
