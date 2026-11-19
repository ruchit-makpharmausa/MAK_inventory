import sql from 'mssql';

export async function recordAudit(db, event) {
  await db.query(`
    INSERT INTO dbo.audit_logs
      (occurred_at, company_id, company_name, company_code, user_id, actor_username,
       actor_display_name, action, method, endpoint, status_code)
    VALUES
      (COALESCE(@occurredAt, SYSUTCDATETIME()), @companyId, @companyName, @companyCode,
       @userId, @username, @displayName, @action, @method, @endpoint, @statusCode)
  `, {
    occurredAt: [sql.DateTime2(3), event.occurredAt || null],
    companyId: [sql.Int, event.company?.id || null],
    companyName: [sql.NVarChar(150), event.company?.name || null],
    companyCode: [sql.NVarChar(20), event.company?.code || null],
    userId: [sql.Int, event.user?.id || null],
    username: [sql.NVarChar(100), event.user?.username || null],
    displayName: [sql.NVarChar(150), event.user?.displayName || null],
    action: [sql.NVarChar(100), event.action],
    method: [sql.VarChar(10), event.method],
    endpoint: [sql.NVarChar(255), String(event.endpoint).slice(0, 255)],
    statusCode: [sql.Int, event.statusCode],
  });
}

export function mountAuditLog(app, db) {
  const route = (handler) => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);
  app.use('/api/audit-logs', (req, res, next) => {
    if (!req.user?.isAdmin) return res.status(403).json({ error: 'Administrator access is required to view audit logs.' });
    next();
  });

  app.get('/api/audit-logs/users', route(async (req, res) => {
    const result = await db.query(`
      SELECT actor_username AS username, MAX(actor_display_name) AS displayName
      FROM dbo.audit_logs
      WHERE company_id = @companyId AND actor_username IS NOT NULL
      GROUP BY actor_username
      ORDER BY actor_username
    `, { companyId: [sql.Int, req.company.id] });
    res.json(result.recordset);
  }));

  app.get('/api/audit-logs', route(async (req, res) => {
    const beforeId = req.query.beforeId == null ? null : Number(req.query.beforeId);
    if (beforeId !== null && (!Number.isSafeInteger(beforeId) || beforeId <= 0)) {
      return res.status(400).json({ error: 'Audit cursor is invalid.' });
    }
    const username = req.query.username == null || req.query.username === '' ? null : req.query.username;
    const fromDate = req.query.from == null || req.query.from === '' ? null : req.query.from;
    const toDate = req.query.to == null || req.query.to === '' ? null : req.query.to;
    const validDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
      && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
      && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
    if (username !== null && (typeof username !== 'string' || username.length > 100)) {
      return res.status(400).json({ error: 'User filter is invalid.' });
    }
    if (fromDate !== null && !validDate(fromDate) || toDate !== null && !validDate(toDate)) {
      return res.status(400).json({ error: 'Enter valid audit dates.' });
    }
    if (fromDate && toDate && fromDate > toDate) return res.status(400).json({ error: 'Start date must not be after end date.' });
    const result = await db.query(`
      SELECT TOP (@limit) id, occurred_at AS occurredAt, company_name AS companyName,
             company_code AS companyCode, user_id AS userId, actor_username AS username,
             actor_display_name AS displayName, action, method, endpoint, status_code AS statusCode
      FROM dbo.audit_logs
      WHERE company_id = @companyId AND (@beforeId IS NULL OR id < @beforeId)
        AND (@username IS NULL OR actor_username = @username)
        AND (@fromDate IS NULL OR occurred_at >= @fromDate)
        AND (@toDate IS NULL OR occurred_at < DATEADD(day, 1, @toDate))
      ORDER BY occurred_at DESC, id DESC
    `, {
      limit: [sql.Int, 100], beforeId: [sql.BigInt, beforeId], companyId: [sql.Int, req.company.id],
      username: [sql.NVarChar(100), username],
      fromDate: [sql.Date, fromDate ? new Date(`${fromDate}T00:00:00Z`) : null],
      toDate: [sql.Date, toDate ? new Date(`${toDate}T00:00:00Z`) : null],
    });
    const events = result.recordset;
    res.json({ events, nextBeforeId: events.length === 100 ? events[events.length - 1].id : null });
  }));
}
