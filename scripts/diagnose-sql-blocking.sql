-- Run in SQL Server Management Studio using an authorized DBA connection.
-- Read-only: no passwords, SQL text, account changes, or session termination.
-- Viewing other sessions requires VIEW SERVER STATE (SQL Server 2019 and earlier)
-- or VIEW SERVER PERFORMANCE STATE (SQL Server 2022 and later).
USE master;
SET NOCOUNT ON;
DECLARE @DatabaseId INT = DB_ID(N'mak_inventory');
IF @DatabaseId IS NULL
    THROW 50003, 'The inventory database is not visible to this login. Check the database name.', 1;

SELECT r.session_id AS sessionId, r.blocking_session_id AS blockingSessionId,
       r.wait_type AS waitType, r.wait_time AS waitMilliseconds,
       r.status, r.command
FROM sys.dm_exec_requests r
WHERE r.database_id = @DatabaseId
ORDER BY r.wait_time DESC;

SELECT DISTINCT s.session_id AS sessionId, s.status, s.program_name AS programName,
       s.open_transaction_count AS openTransactionCount,
       dt.database_transaction_begin_time AS transactionBeganAt
FROM sys.dm_tran_session_transactions st
JOIN sys.dm_tran_database_transactions dt ON dt.transaction_id = st.transaction_id
JOIN sys.dm_exec_sessions s ON s.session_id = st.session_id
WHERE dt.database_id = @DatabaseId AND s.is_user_process = 1
ORDER BY transactionBeganAt;
