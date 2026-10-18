import assert from 'node:assert/strict';
import test from 'node:test';
import { connectionConfig, connectionFailure, expectedColumns, verifyExistingSchema } from '../server/database.js';

const environment = {
  SQLSERVER_HOST: '192.168.1.114', SQLSERVER_PORT: '1433', SQLSERVER_DATABASE: 'mak_inventory',
  SQLSERVER_USER: 'mak_inventory_app', SQLSERVER_PASSWORD: 'test-password',
};

test('SQL Server authentication requires a password and encrypted, verified TLS by default', () => {
  const config = connectionConfig(environment);
  assert.equal(config.server, environment.SQLSERVER_HOST);
  assert.equal(config.port, 1433);
  assert.equal(config.database, 'mak_inventory');
  assert.equal(config.options.encrypt, true);
  assert.equal(config.options.trustServerCertificate, false);
  assert.throws(() => connectionConfig({ ...environment, SQLSERVER_PASSWORD: '' }), (error) => error.status === 503 && /SQLSERVER_PASSWORD/.test(error.message));
  assert.throws(() => connectionConfig({ ...environment, SQLSERVER_PORT: '-1' }), /valid TCP port/);
});

test('an explicit certificate setting never turns encryption off', () => {
  const config = connectionConfig({ ...environment, SQLSERVER_TRUST_SERVER_CERTIFICATE: 'true', SQLSERVER_TLS_SERVER_NAME: 'sql.example.test' });
  assert.equal(config.options.encrypt, true);
  assert.equal(config.options.trustServerCertificate, true);
  assert.equal(config.options.serverName, 'sql.example.test');
});

test('existing schema is checked using only a read; missing columns stop connection', async () => {
  const statements = [];
  const rows = Object.entries(expectedColumns).flatMap(([tableName, columns]) => columns.map((columnName) => ({ tableName, columnName })));
  const pool = { request: () => ({ async query(statement) { statements.push(statement); return { recordset: rows }; } }) };
  await verifyExistingSchema(pool);
  assert.equal(statements.length, 1);
  assert.match(statements[0], /SELECT/);
  assert.doesNotMatch(statements[0], /\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE)\b/i);
  rows.splice(rows.findIndex((row) => row.columnName === 'mak_item_code'), 1);
  await assert.rejects(verifyExistingSchema(pool), (error) => error.status === 503 && /mak_item_code/.test(error.message));
});

test('query timeouts are distinguished from connection timeouts without exposing SQL details', () => {
  const queryError = Object.assign(new Error('private-query-and-credentials'), { name: 'RequestError', code: 'ETIMEOUT' });
  const queryFailure = connectionFailure(queryError);
  assert.equal(queryFailure.status, 503);
  assert.equal(queryFailure.code, 'ETIMEOUT');
  assert.match(queryFailure.message, /accepted the connection.*query timed out/);
  assert.match(queryFailure.message, /blocked queries, uncommitted SQL transactions/);
  assert.doesNotMatch(queryFailure.message, /private-query|credentials|Cannot connect/);
  const connectionError = Object.assign(new Error('private-connection-details'), { name: 'ConnectionError', code: 'ETIMEOUT' });
  const connectionTimeout = connectionFailure(connectionError);
  assert.equal(connectionTimeout.status, 503);
  assert.match(connectionTimeout.message, /connection timed out/);
  assert.doesNotMatch(connectionTimeout.message, /private-connection|accepted the connection/);
  assert.equal(connectionFailure(queryFailure), queryFailure);
});

test('connection errors give useful messages without echoing credentials', () => {
  const error = connectionFailure(Object.assign(new Error('private-credential'), { code: 'ELOGIN' }));
  assert.equal(error.status, 503);
  assert.match(error.message, /rejected the login/);
  assert.doesNotMatch(error.message, /private-credential/);
  assert.match(connectionFailure(new Error('self-signed certificate')).message, /certificate verification failed/);
});
