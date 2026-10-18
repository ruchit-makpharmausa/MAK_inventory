-- Run manually as a database administrator in the existing inventory database.
-- Replace the username below to grant an existing active account administrator access.
-- No accounts are promoted automatically. This script is safe to rerun.
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;
    IF OBJECT_ID(N'dbo.app_users', N'U') IS NULL
        THROW 50001, 'Run scripts/login-tables.sql first.', 1;

    IF COL_LENGTH(N'dbo.app_users', N'is_admin') IS NULL
        ALTER TABLE dbo.app_users ADD is_admin BIT NOT NULL
            CONSTRAINT DF_app_users_is_admin DEFAULT (0) WITH VALUES;

    DECLARE @AdminUsername NVARCHAR(100) = N'REPLACE_WITH_EXISTING_USERNAME';
    IF NOT EXISTS (SELECT 1 FROM dbo.app_users WHERE username = @AdminUsername AND is_active = 1)
        THROW 50002, 'Set @AdminUsername to an existing active username before running this script.', 1;

    -- Dynamic SQL compiles after the new column exists in this batch.
    EXEC sys.sp_executesql N'UPDATE dbo.app_users SET is_admin = 1 WHERE username = @username AND is_active = 1;',
        N'@username NVARCHAR(100)', @username = @AdminUsername;
    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
