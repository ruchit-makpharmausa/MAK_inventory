import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import express from 'express';
import { createServer as createHttpServer } from 'node:http';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer as createViteServer } from 'vite';
import { mountAuditLog, recordAudit } from '../server/audit.js';
import { expectedColumns } from '../server/database.js';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/passwords.js';

const migration = readFileSync(new URL('../scripts/audit-log.sql', import.meta.url), 'utf8');

test('audit migration stores company/user snapshots, endpoint, status and timestamp with company-time indexes', () => {
  assert.ok(expectedColumns.audit_logs.includes('occurred_at'));
  assert.ok(expectedColumns.audit_logs.includes('company_id'));
  assert.match(migration, /company_name NVARCHAR\(150\) NULL/);
  assert.match(migration, /actor_username NVARCHAR\(100\) NULL/);
  assert.match(migration, /actor_display_name NVARCHAR\(150\) NULL/);
  assert.match(migration, /action NVARCHAR\(100\) NOT NULL/);
  assert.match(migration, /endpoint NVARCHAR\(255\) NOT NULL/);
  assert.match(migration, /IX_audit_logs_company_occurred/);
  assert.match(migration, /BEGIN TRANSACTION/);
});

test('audit writer stores only event metadata and never request bodies', async () => {
  let call;
  await recordAudit({ async query(statement, parameters) { call = { statement, parameters }; } }, {
    user: { id: 5, username: 'user.one', displayName: 'User One' },
    company: { id: 7, name: 'Quten', code: 'TRV' },
    action: 'api_request', method: 'POST', endpoint: '/api/products', statusCode: 201,
  });
  assert.match(call.statement, /INSERT INTO dbo\.audit_logs/);
  assert.equal(call.parameters.companyId[1], 7);
  assert.equal(call.parameters.username[1], 'user.one');
  assert.equal(call.parameters.action[1], 'api_request');
  assert.equal(call.parameters.endpoint[1], '/api/products');
  assert.equal(call.parameters.statusCode[1], 201);
  assert.doesNotMatch(call.statement, /password|requestBody|body/i);
});

async function withAuditApi(db, run, { isAdmin = true } = {}) {
  const app = express();
  app.use('/api', (req, _res, next) => {
    req.user = { id: 5, username: 'user.one', displayName: 'User One', isAdmin };
    req.company = { id: 7, name: 'Quten', code: 'TRV' };
    next();
  });
  mountAuditLog(app, db);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const request = async (path) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`);
    return { status: response.status, body: await response.json() };
  };
  try { await run(request); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('audit listing is company-scoped, newest-page limited, and supports an older cursor', async () => {
  const calls = [];
  const db = { async query(statement, parameters) {
    calls.push({ statement, parameters });
    return { recordset: Array.from({ length: parameters.beforeId[1] == null ? 100 : 1 }, (_, index) => ({ id: 100 - index })) };
  } };
  await withAuditApi(db, async (request) => {
    const first = await request('/api/audit-logs?username=user.one&from=2026-11-01&to=2026-11-30');
    assert.equal(first.status, 200);
    assert.equal(first.body.events.length, 100);
    assert.equal(first.body.nextBeforeId, 1);
    const older = await request('/api/audit-logs?beforeId=1&username=user.one&from=2026-11-01&to=2026-11-30');
    assert.equal(older.status, 200);
    assert.equal(older.body.nextBeforeId, null);
    assert.equal((await request('/api/audit-logs?beforeId=0')).status, 400);
    assert.equal((await request('/api/audit-logs?from=2026-02-30')).status, 400);
    assert.equal((await request('/api/audit-logs?from=2026-12-01&to=2026-11-01')).status, 400);
  });
  assert.equal(calls[0].parameters.companyId[1], 7);
  assert.equal(calls[0].parameters.username[1], 'user.one');
  assert.equal(calls[0].parameters.fromDate[1].toISOString(), '2026-11-01T00:00:00.000Z');
  assert.equal(calls[0].parameters.toDate[1].toISOString(), '2026-11-30T00:00:00.000Z');
  assert.equal(calls[1].parameters.beforeId[1], 1);
  assert.match(calls[0].statement, /WHERE company_id = @companyId/);
  assert.match(calls[0].statement, /actor_username = @username/);
  assert.match(calls[0].statement, /occurred_at >= @fromDate/);
  assert.match(calls[0].statement, /DATEADD\(day, 1, @toDate\)/);
});

test('audit user filter options come only from the selected company', async () => {
  let call;
  const db = { async query(statement, parameters) {
    call = { statement, parameters };
    return { recordset: [{ username: 'user.one', displayName: 'User One' }] };
  } };
  await withAuditApi(db, async (request) => {
    const result = await request('/api/audit-logs/users');
    assert.deepEqual(result, { status: 200, body: [{ username: 'user.one', displayName: 'User One' }] });
  });
  assert.equal(call.parameters.companyId[1], 7);
  assert.match(call.statement, /WHERE company_id = @companyId/);
});

test('regular users are forbidden from listing audit events and filter users', async () => {
  let queries = 0;
  const db = { async query() { queries++; return { recordset: [] }; } };
  await withAuditApi(db, async (request) => {
    assert.equal((await request('/api/audit-logs')).status, 403);
    assert.equal((await request('/api/audit-logs/users')).status, 403);
  }, { isAdmin: false });
  assert.equal(queries, 0);
});

test('authenticated API activity records method, path, status and selected company without payloads', async () => {
  const auditEvents = [];
  const company = { id: 7, name: 'Quten', code: 'TRV' };
  const user = { id: 5, username: 'user.one', displayName: 'User One', isAdmin: false };
  const db = {
    async query(statement, parameters = {}) {
      if (statement.includes('FROM dbo.user_sessions s JOIN dbo.app_users u')) {
        return { recordset: [{ ...user, companyId: company.id, companyName: company.name, companyCode: company.code, loginAt: new Date('2026-11-17T12:00:00Z') }] };
      }
      if (statement.includes('FROM dbo.products p JOIN')) return { recordset: [] };
      if (statement.includes('FROM dbo.audit_logs')) return { recordset: [] };
      if (statement.includes('INSERT INTO dbo.audit_logs')) { auditEvents.push(parameters); return { recordset: [] }; }
      throw new Error(`Unexpected audit test query: ${statement}`);
    },
  };
  const app = createApp(db, { serveClient: false, auditEnabled: true });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/products?search=LOT-PRIVATE`, {
      headers: { Cookie: `mak_inventory_session=${'a'.repeat(64)}` },
    });
    assert.equal(response.status, 200);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(auditEvents.length, 1);
    assert.equal(auditEvents[0].companyId[1], 7);
    assert.equal(auditEvents[0].username[1], 'user.one');
    assert.equal(auditEvents[0].method[1], 'GET');
    assert.equal(auditEvents[0].endpoint[1], '/api/products');
    assert.equal(auditEvents[0].statusCode[1], 200);
    assert.doesNotMatch(JSON.stringify(auditEvents[0]), /LOT-PRIVATE/);
    const beforeCount = auditEvents.length;
    const auditPage = await fetch(`http://127.0.0.1:${server.address().port}/api/audit-logs`, {
      headers: { Cookie: `mak_inventory_session=${'a'.repeat(64)}` },
    });
    assert.equal(auditPage.status, 403);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(auditEvents.length, beforeCount);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('Audit Log page describes company activity and paginates older events', async () => {
  const vite = await createViteServer({ optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: { server: createHttpServer() }, watch: null }, appType: 'custom' });
  try {
    const { default: AuditLogPage } = await vite.ssrLoadModule('/src/pages/audit/AuditLogPage.jsx');
    const html = renderToStaticMarkup(createElement(AuditLogPage));
    assert.match(html, /Audit Log/);
    assert.match(html, /Passwords and request contents are never recorded/);
    assert.match(html, /From date/);
    assert.match(html, /To date/);
    assert.match(html, /All users/);
    assert.match(html, /Loading audit events/);
  } finally { await vite.close(); }
});

test('successful login is attributed to the selected company time and logout is recorded', async () => {
  const password = 'audit-test-password';
  const user = { id: 5, username: 'user.one', displayName: 'User One', isAdmin: false,
    isActive: true, passwordHash: await hashPassword(password) };
  const company = { companyId: 7, companyName: 'Quten', companyCode: 'TRV' };
  const loginAt = new Date('2026-11-17T12:00:00.000Z');
  const sessions = new Map();
  const auditEvents = [];
  const db = {
    async query(statement, parameters = {}) {
      if (statement.includes('FROM dbo.app_users WHERE username = @username')) return { recordset: [user] };
      if (statement.includes('INSERT INTO dbo.user_sessions')) {
        sessions.set(parameters.tokenHash[1], { companyId: null });
        return { recordset: [] };
      }
      if (statement.includes('DELETE FROM dbo.user_sessions WHERE expires_at')) return { recordset: [] };
      if (statement.includes('FROM dbo.user_sessions s JOIN dbo.app_users u')) {
        const session = sessions.get(parameters.tokenHash[1]);
        return { recordset: session ? [{ ...user, loginAt, ...(session.companyId ? company : {}) }] : [] };
      }
      if (statement.includes('FROM dbo.companies WHERE id = @companyId AND is_active = 1')) return { recordset: [company] };
      if (statement.includes('UPDATE dbo.user_sessions SET current_company_id = @companyId')) {
        sessions.get(parameters.tokenHash[1]).companyId = company.companyId;
        return { recordset: [] };
      }
      if (statement.includes('INSERT INTO dbo.audit_logs')) { auditEvents.push(parameters); return { recordset: [] }; }
      if (statement.includes('DELETE FROM dbo.user_sessions WHERE token_hash')) {
        sessions.delete(parameters.tokenHash[1]);
        return { recordset: [] };
      }
      throw new Error(`Unexpected audit authentication query: ${statement}`);
    },
  };
  const app = createApp(db, { serveClient: false, auditEnabled: true });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, body, cookie) => fetch(`${base}${path}`, { method: 'POST', headers: {
    'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}),
  }, body: JSON.stringify(body) });
  try {
    const login = await post('/api/auth/login', { username: user.username, password });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const selectCompany = await post('/api/auth/company', { companyId: 7 }, cookie);
    assert.equal(selectCompany.status, 200, await selectCompany.clone().text());
    await new Promise((resolve) => setImmediate(resolve));
    const loginEvent = auditEvents.find((event) => event.action[1] === 'login');
    assert.ok(loginEvent);
    assert.equal(loginEvent.occurredAt[1].toISOString(), loginAt.toISOString());
    assert.equal(loginEvent.companyId[1], 7);

    const logout = await post('/api/auth/logout', {}, cookie);
    assert.equal(logout.status, 200);
    const logoutEvent = auditEvents.find((event) => event.action[1] === 'logout');
    assert.ok(logoutEvent);
    assert.equal(logoutEvent.companyId[1], 7);
    assert.equal(logoutEvent.username[1], user.username);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
