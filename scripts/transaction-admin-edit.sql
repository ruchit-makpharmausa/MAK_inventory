-- Run manually in the existing inventory database as a database administrator.
-- Back up the database first. This adds attribution columns and does not expose them through the API.
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;

    IF OBJECT_ID(N'dbo.app_users', N'U') IS NULL
        THROW 50001, 'Run scripts/login-tables.sql before this migration.', 1;

    IF COL_LENGTH(N'dbo.receiving_transactions', N'added_by_user_id') IS NULL
        ALTER TABLE dbo.receiving_transactions ADD added_by_user_id INT NULL;
    IF COL_LENGTH(N'dbo.usage_transactions', N'added_by_user_id') IS NULL
        ALTER TABLE dbo.usage_transactions ADD added_by_user_id INT NULL;

    IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_receiving_transactions_added_by')
        ALTER TABLE dbo.receiving_transactions WITH CHECK
            ADD CONSTRAINT FK_receiving_transactions_added_by
            FOREIGN KEY (added_by_user_id) REFERENCES dbo.app_users(id);
    IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_usage_transactions_added_by')
        ALTER TABLE dbo.usage_transactions WITH CHECK
            ADD CONSTRAINT FK_usage_transactions_added_by
            FOREIGN KEY (added_by_user_id) REFERENCES dbo.app_users(id);

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
