-- Run in the existing inventory database with the app stopped and a verified current backup available.
-- Existing values (including RN-prefixed references), NULLs, IDs, quantities, and constraints are preserved.
-- For installations without a separate receiving reference column, run optional-material-lots.sql first.
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;
    DECLARE @ReceivingId INT = OBJECT_ID(N'dbo.receiving_transactions', N'U');
    IF @ReceivingId IS NULL
        THROW 50001, 'The existing receiving_transactions table is required.', 1;

    DECLARE @OldColumnId INT = COLUMNPROPERTY(@ReceivingId, N'mak_rn_number', N'ColumnId');
    DECLARE @NewColumnId INT = COLUMNPROPERTY(@ReceivingId, N'mak_release_number', N'ColumnId');
    IF @OldColumnId IS NOT NULL AND @NewColumnId IS NOT NULL
        THROW 50002, 'Both reference columns exist. Ask a database administrator to review them; nothing was changed.', 1;
    IF @OldColumnId IS NULL AND @NewColumnId IS NULL
        THROW 50003, 'Run optional-material-lots.sql before this rename. No receiving reference column was found.', 1;

    DECLARE @Rows BIGINT;
    SELECT @Rows = COUNT_BIG(*) FROM dbo.receiving_transactions WITH (TABLOCKX, HOLDLOCK);
    IF @OldColumnId IS NOT NULL
    BEGIN
        IF EXISTS (
            SELECT 1 FROM sys.sql_expression_dependencies
            WHERE referenced_id = @ReceivingId AND referenced_minor_id IN (0, @OldColumnId)
        )
            THROW 50004, 'SQL objects depend on the old receiving reference column. Review those dependencies before renaming; nothing was changed.', 1;

        EXEC sys.sp_rename N'dbo.receiving_transactions.mak_rn_number', N'mak_release_number', N'COLUMN';
    END;
    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
