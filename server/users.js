import sql from 'mssql';
import { hashPassword, validPassword, validUsername } from './passwords.js';

export function mountUserAdministration(app, db) {
  const route = (handler) => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);
  app.use('/api/users', (req, res, next) => {
    if (!req.user?.isAdmin) return res.status(403).json({ error: 'Administrator access is required.' });
    next();
  });

  app.get('/api/users', route(async (_req, res) => {
    const result = await db.query(`
      SELECT id, username, display_name AS displayName, is_admin AS isAdmin, is_active AS isActive
      FROM dbo.app_users ORDER BY username
    `);
    res.json(result.recordset);
  }));

  app.post('/api/users', route(async (req, res) => {
    const { username, displayName, password, isAdmin = false } = req.body || {};
    if (!validUsername(username)) {
      return res.status(400).json({ error: 'Username must be 3–100 characters: letters, numbers, dot, underscore, @ or hyphen.' });
    }
    if (typeof displayName !== 'string' || !displayName.trim() || displayName.trim().length > 150) {
      return res.status(400).json({ error: 'Display name must contain between 1 and 150 characters.' });
    }
    if (!validPassword(password)) {
      return res.status(400).json({ error: 'Password must contain between 12 and 256 characters.' });
    }
    if (typeof isAdmin !== 'boolean') {
      return res.status(400).json({ error: 'Choose a valid user role.' });
    }
    const passwordHash = await hashPassword(password);
    try {
      const result = await db.query(`
        INSERT INTO dbo.app_users (username, display_name, password_hash, is_admin)
        OUTPUT INSERTED.id, INSERTED.username, INSERTED.display_name AS displayName,
               INSERTED.is_admin AS isAdmin, INSERTED.is_active AS isActive
        VALUES (@username, @displayName, @passwordHash, @isAdmin)
      `, {
        username: [sql.NVarChar(100), username.trim().toLowerCase()],
        displayName: [sql.NVarChar(150), displayName.trim()],
        passwordHash: [sql.VarChar(200), passwordHash],
        isAdmin: [sql.Bit, isAdmin],
      });
      res.status(201).json(result.recordset[0]);
    } catch (error) {
      if ([2601, 2627].includes(error.number)) {
        return res.status(409).json({ error: 'That username already exists.' });
      }
      throw error;
    }
  }));
}
