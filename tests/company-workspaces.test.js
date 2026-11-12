import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import express from 'express';
import { mountCompanyAdministration } from '../server/companies.js';

const migration = readFileSync(new URL('../scripts/company-workspaces.sql', import.meta.url), 'utf8');

test('company migration creates Quten/TRV and assigns existing product data and sessions safely', () => {
  assert.match(migration, /INSERT INTO dbo\.companies \(name, code\) VALUES \(N'Quten', N'TRV'\)/);
  assert.match(migration, /UPDATE dbo\.product_types SET company_id = @companyId WHERE company_id IS NULL/);
  assert.match(migration, /UPDATE dbo\.products SET company_id = @companyId WHERE company_id IS NULL/);
  assert.match(migration, /ALTER TABLE dbo\.user_sessions ADD current_company_id INT NULL/);
  assert.match(migration, /FK_products_type_company/);
  assert.match(migration, /UQ_product_types_company_name/);
  assert.match(migration, /BEGIN TRANSACTION/);
  assert.match(migration, /BEGIN CATCH\s+IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;/);
  assert.doesNotMatch(migration, /\b(?:DELETE FROM|TRUNCATE TABLE)\s+(?:dbo\.)?(?:products|product_types|receiving_transactions|usage_transactions)\b/i);
});

async function withApi(db, user, run) {
  const app = express();
  app.use(express.json());
  app.use('/api', (req, _res, next) => { req.user = user; next(); });
  mountCompanyAdministration(app, db);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const request = async (path, body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  };
  try { await run(request); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('administrators can add, archive, and restore companies without deleting their inventory', async () => {
  const statements = [];
  const db = { async query(statement, parameters) {
    statements.push({ statement, parameters });
    if (statement.includes('INSERT INTO dbo.companies')) return { recordset: [{ id: 8, name: 'Acme', code: 'ACM' }] };
    return { recordset: [{ matched: 1 }] };
  } };
  await withApi(db, { id: 1, isAdmin: true }, async (request) => {
    assert.deepEqual(await request('/api/companies', { name: 'Acme', code: 'acm' }), {
      status: 201, body: { id: 8, name: 'Acme', code: 'ACM' },
    });
    assert.deepEqual(await request('/api/companies/8/archive', {}), { status: 200, body: { id: 8, archived: true } });
    assert.deepEqual(await request('/api/companies/8/restore', {}), { status: 200, body: { id: 8, restored: true } });
  });
  assert.equal(statements[0].parameters.code[1], 'ACM');
  assert.match(statements[1].statement, /UPDATE dbo\.companies SET is_active = 0/);
  assert.match(statements[2].statement, /UPDATE dbo\.companies SET is_active = 1/);
  assert.doesNotMatch(statements.map((entry) => entry.statement).join('\n'), /DELETE FROM|TRUNCATE TABLE/);
});

test('non-admin users can list active companies but cannot create or archive them', async () => {
  const calls = [];
  const db = { async query(statement) {
    calls.push(statement);
    return { recordset: [{ id: 7, name: 'Quten', code: 'TRV', isActive: true }] };
  } };
  await withApi(db, { id: 2, isAdmin: false }, async (request) => {
    assert.deepEqual(await request('/api/companies'), {
      status: 200, body: [{ id: 7, name: 'Quten', code: 'TRV', isActive: true }],
    });
    assert.equal((await request('/api/companies', { name: 'Acme', code: 'ACM' })).status, 403);
    assert.equal((await request('/api/companies/7/archive', {})).status, 403);
  });
  assert.equal(calls.length, 1);
});
