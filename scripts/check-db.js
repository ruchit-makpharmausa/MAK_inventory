import { getPool, closePool } from '../server/database.js';

try {
  const pool = await getPool();
  const { recordset } = await pool.request().query(`
    SELECT DB_NAME() AS databaseName,
      (SELECT COUNT_BIG(*) FROM dbo.product_types) AS productTypes,
      (SELECT COUNT_BIG(*) FROM dbo.products) AS products,
      (SELECT COUNT_BIG(*) FROM dbo.receiving_transactions) AS receivingTransactions,
      (SELECT COUNT_BIG(*) FROM dbo.usage_transactions) AS usageTransactions
  `);
  console.log('Connected to the existing SQL Server database with encryption required.');
  console.log(JSON.stringify(recordset[0], null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await closePool();
}
