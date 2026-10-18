import dotenv from 'dotenv';
import sql from 'mssql';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });

export const expectedColumns = {
  product_types: ['id', 'name', 'created_at'],
  products: ['id', 'product_type_id', 'name', 'item_code', 'mak_item_code', 'unit', 'comment', 'created_at', 'updated_at'],
  receiving_transactions: ['id', 'product_id', 'receiving_date', 'quantity', 'material_lot_number', 'remarks', 'created_at'],
  usage_transactions: ['id', 'product_id', 'usage_date', 'quantity', 'material_lot_number', 'mak_lot_number', 'remarks', 'created_at'],
};

export function unavailable(message) {
  return Object.assign(new Error(message), { status: 503 });
}

export function connectionConfig(environment = process.env) {
  const required = ['SQLSERVER_HOST', 'SQLSERVER_DATABASE', 'SQLSERVER_USER', 'SQLSERVER_PASSWORD'];
  const missing = required.filter((key) => !environment[key]);
  if (missing.length) throw unavailable(`Enter ${missing.join(', ')} in the server's .env file and restart the app.`);
  const port = Number(environment.SQLSERVER_PORT || 1433);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw unavailable('SQLSERVER_PORT must be a valid TCP port.');
  const caFile = environment.SQLSERVER_CA_FILE;
  return {
    server: environment.SQLSERVER_HOST,
    port,
    database: environment.SQLSERVER_DATABASE,
    user: environment.SQLSERVER_USER,
    password: environment.SQLSERVER_PASSWORD,
    connectionTimeout: 10000,
    requestTimeout: 15000,
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
    options: {
      encrypt: true,
      trustServerCertificate: environment.SQLSERVER_TRUST_SERVER_CERTIFICATE === 'true',
      useUTC: true,
      abortTransactionOnError: true,
      appName: 'MAK Inventory',
      ...(caFile ? { cryptoCredentialsDetails: { ca: readFileSync(caFile) } } : {}),
      ...(environment.SQLSERVER_TLS_SERVER_NAME ? { serverName: environment.SQLSERVER_TLS_SERVER_NAME } : {}),
    },
  };
}

export async function verifyExistingSchema(pool) {
  const { recordset } = await pool.request().query(`
    SELECT t.name AS tableName, c.name AS columnName
    FROM sys.tables t
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    JOIN sys.columns c ON c.object_id = t.object_id
    WHERE s.name = N'dbo'
      AND t.name IN (N'product_types', N'products', N'receiving_transactions', N'usage_transactions')
  `);
  const present = new Set(recordset.map((row) => `${row.tableName}.${row.columnName}`.toLowerCase()));
  const missing = Object.entries(expectedColumns).flatMap(([table, columns]) => columns
    .filter((column) => !present.has(`${table}.${column}`)).map((column) => `dbo.${table}.${column}`));
  if (missing.length) throw unavailable(`Required columns are missing or not accessible to this login: ${missing.join(', ')}. No database objects were changed.`);
}

export function connectionFailure(error) {
  if (error.status) return error;
  if (error.code === 'ETIMEOUT') {
    const message = error.name === 'RequestError'
      ? 'SQL Server accepted the connection, but a database query timed out. Check for blocked queries, uncommitted SQL transactions, or an overloaded database.'
      : 'The SQL Server connection timed out. Check the server address, port, and network connection.';
    return Object.assign(unavailable(message), { code: error.code });
  }
  if (error.code === 'ELOGIN') return unavailable('SQL Server rejected the login. Check the configured password and access to mak_inventory.');
  if (/certificate|self.signed|altname|hostname/i.test(error.message || '')) {
    return unavailable('SQL Server certificate verification failed. Configure a trusted certificate or the agreed server-certificate setting in .env.');
  }
  return unavailable('Cannot connect to the configured SQL Server. Check the server address, port, and network connection.');
}

let poolPromise;
export async function getPool() {
  if (!poolPromise) {
    const pool = new sql.ConnectionPool(connectionConfig());
    pool.on('error', (error) => console.error('SQL Server pool error:', error.code || 'CONNECTION_ERROR'));
    poolPromise = (async () => {
      try {
        await pool.connect();
        await verifyExistingSchema(pool);
        return pool;
      } catch (error) {
        await pool.close().catch(() => {});
        poolPromise = undefined;
        throw connectionFailure(error);
      }
    })();
  }
  return poolPromise;
}

export async function query(statement, parameters = {}, executor) {
  const request = new sql.Request(executor || await getPool());
  for (const [name, [type, value]] of Object.entries(parameters)) request.input(name, type, value);
  return request.query(statement);
}

export async function transaction(work) {
  const transaction = new sql.Transaction(await getPool());
  let rolledBack = false;
  transaction.on('rollback', () => { rolledBack = true; });
  await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);
  try {
    const result = await work(transaction);
    await transaction.commit();
    return result;
  } catch (error) {
    if (!rolledBack) await transaction.rollback().catch(() => {});
    throw error;
  }
}

export async function closePool() {
  const pending = poolPromise;
  poolPromise = undefined;
  if (pending) await pending.then((pool) => pool.close()).catch(() => {});
}

export default { query, transaction, getPool };
