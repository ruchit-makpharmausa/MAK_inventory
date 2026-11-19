-- Run manually as a database administrator in the existing inventory database.
-- Back up the database first. Audit events are retained indefinitely; this script does not seed data.
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;

    IF OBJECT_ID(N'dbo.companies', N'U') IS NULL OR OBJECT_ID(N'dbo.app_users', N'U') IS NULL
        THROW 50001, 'Run the company workspace and login schema migrations first.', 1;

    IF OBJECT_ID(N'dbo.audit_logs', N'U') IS NULL
    BEGIN
        CREATE TABLE dbo.audit_logs (
            id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_audit_logs PRIMARY KEY,
            occurred_at DATETIME2(3) NOT NULL CONSTRAINT DF_audit_logs_occurred_at DEFAULT (SYSUTCDATETIME()),
            company_id INT NULL,
            company_name NVARCHAR(150) NULL,
            company_code NVARCHAR(20) NULL,
            user_id INT NULL,
            actor_username NVARCHAR(100) NULL,
            actor_display_name NVARCHAR(150) NULL,
            action NVARCHAR(100) NOT NULL,
            method VARCHAR(10) NOT NULL,
            endpoint NVARCHAR(255) NOT NULL,
            status_code INT NOT NULL
        );
        CREATE INDEX IX_audit_logs_company_occurred ON dbo.audit_logs(company_id, occurred_at DESC, id DESC);
        CREATE INDEX IX_audit_logs_user_occurred ON dbo.audit_logs(user_id, occurred_at DESC, id DESC);
    END;

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
