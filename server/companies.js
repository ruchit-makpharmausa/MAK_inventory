import sql from 'mssql';

export function mountCompanyAdministration(app, db) {
  const route = (handler) => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);
  const requireAdmin = (req, res) => {
    if (req.user?.isAdmin) return true;
    res.status(403).json({ error: 'Administrator access is required to manage companies.' });
    return false;
  };

  app.get('/api/companies', route(async (req, res) => {
    const result = await db.query(`
      SELECT id, name, code, is_active AS isActive
      FROM dbo.companies ${req.user?.isAdmin ? '' : 'WHERE is_active = 1'}
      ORDER BY name
    `);
    res.json(result.recordset);
  }));

  app.post('/api/companies', route(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const name = req.body?.name;
    const code = req.body?.code;
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 150) {
      return res.status(400).json({ error: 'Company name must contain between 1 and 150 characters.' });
    }
    if (typeof code !== 'string' || !/^[A-Za-z0-9-]{2,20}$/.test(code.trim())) {
      return res.status(400).json({ error: 'Company code must be 2–20 letters, numbers, or hyphens.' });
    }
    try {
      const result = await db.query(`
        INSERT INTO dbo.companies (name, code)
        OUTPUT INSERTED.id, INSERTED.name, INSERTED.code
        VALUES (@name, @code)
      `, { name: [sql.NVarChar(150), name.trim()], code: [sql.NVarChar(20), code.trim().toUpperCase()] });
      res.status(201).json(result.recordset[0]);
    } catch (error) {
      if ([2601, 2627].includes(error.number)) {
        return res.status(409).json({ error: 'That company code already exists.' });
      }
      throw error;
    }
  }));

  app.post('/api/companies/:id/restore', route(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const companyId = Number(req.params.id);
    if (!Number.isInteger(companyId) || companyId <= 0 || companyId > 2147483647) {
      return res.status(404).json({ error: 'Company not found.' });
    }
    const result = await db.query(`
      UPDATE dbo.companies SET is_active = 1
      WHERE id = @companyId AND is_active = 0;
      SELECT @@ROWCOUNT AS matched;
    `, { companyId: [sql.Int, companyId] });
    if (!result.recordset[0]?.matched) return res.status(404).json({ error: 'Company not found.' });
    res.json({ id: companyId, restored: true });
  }));

  app.post('/api/companies/:id/archive', route(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const companyId = Number(req.params.id);
    if (!Number.isInteger(companyId) || companyId <= 0 || companyId > 2147483647) {
      return res.status(404).json({ error: 'Company not found.' });
    }
    const result = await db.query(`
      UPDATE dbo.companies SET is_active = 0
      WHERE id = @companyId AND is_active = 1;
      SELECT @@ROWCOUNT AS matched;
    `, { companyId: [sql.Int, companyId] });
    if (!result.recordset[0]?.matched) return res.status(404).json({ error: 'Company not found.' });
    res.json({ id: companyId, archived: true });
  }));
}
