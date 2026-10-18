import { createHash, randomBytes } from 'node:crypto';
import sql from 'mssql';
import { validUsername, verifyPassword } from './passwords.js';

const cookieName = 'mak_inventory_session';
const sessionSeconds = 8 * 60 * 60;
const dummyHash = `scrypt$${'0'.repeat(32)}$${'0'.repeat(128)}`;
const tokenHash = (token) => createHash('sha256').update(token).digest('hex');
const publicUser = (user) => ({ id: user.id, username: user.username, displayName: user.displayName });

export function sessionToken(req) {
  const value = (req.headers.cookie || '').split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  return /^[a-f0-9]{64}$/.test(value || '') ? value : null;
}

export function mountAuthentication(app, db) {
  const attempts = new Map();
  const forwardError = (error, next) => {
    if ([207, 208].includes(error.number)) {
      error = Object.assign(new Error('Login tables are missing or incomplete. Run scripts/login-tables.sql in your inventory database.'), { status: 503 });
    }
    next(error);
  };
  const route = (handler) => (req, res, next) => Promise.resolve(handler(req, res)).catch((error) => forwardError(error, next));
  const setCookie = (req, res, token, maxAge) => res.cookie(cookieName, token, {
    httpOnly: true, sameSite: 'strict', secure: req.secure || process.env.COOKIE_SECURE === 'true',
    path: '/', maxAge,
  });
  const clearCookie = (req, res) => setCookie(req, res, '', 0);
  const findUser = async (req) => {
    const token = sessionToken(req);
    if (!token) return null;
    const result = await db.query(`
      SELECT u.id, u.username, u.display_name AS displayName
      FROM dbo.user_sessions s JOIN dbo.app_users u ON u.id = s.user_id
      WHERE s.token_hash = @tokenHash AND s.expires_at > SYSUTCDATETIME() AND u.is_active = 1
    `, { tokenHash: [sql.Char(64), tokenHash(token)] });
    return result.recordset[0] || null;
  };

  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin) {
      try {
        const origin = new URL(req.headers.origin);
        if (!['http:', 'https:'].includes(origin.protocol) || origin.host !== req.headers.host) {
          return res.status(403).json({ error: 'Cross-site requests are not allowed.' });
        }
      } catch {
        return res.status(403).json({ error: 'Cross-site requests are not allowed.' });
      }
    }
    next();
  });

  app.get('/api/auth/session', route(async (req, res) => {
    const user = await findUser(req);
    if (!user) clearCookie(req, res);
    res.json({ user: user ? publicUser(user) : null });
  }));

  app.post('/api/auth/login', route(async (req, res) => {
    const now = Date.now();
    for (const [key, attempt] of attempts) if (attempt.until <= now) attempts.delete(key);
    const key = req.ip;
    const attempt = attempts.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
    if (attempt.count >= 10 || (!attempts.has(key) && attempts.size >= 10000)) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((attempt.until - now) / 1000))));
      return res.status(429).json({ error: 'Too many login attempts. Try again later.' });
    }
    attempt.count += 1;
    attempts.set(key, attempt);
    const { username, password } = req.body || {};
    if (!validUsername(username) || typeof password !== 'string' || !password || password.length > 256) {
      return res.status(400).json({ error: 'Enter a valid username and password.' });
    }
    const result = await db.query(`
      SELECT id, username, display_name AS displayName, password_hash AS passwordHash, is_active AS isActive
      FROM dbo.app_users WHERE username = @username
    `, { username: [sql.NVarChar(100), username.trim().toLowerCase()] });
    const user = result.recordset[0];
    const passwordMatches = await verifyPassword(password, user?.passwordHash || dummyHash);
    if (!user || !user.isActive || !passwordMatches) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }
    const token = randomBytes(32).toString('hex');
    const previousToken = sessionToken(req);
    await db.query(`
      DELETE FROM dbo.user_sessions WHERE expires_at <= SYSUTCDATETIME() OR token_hash = @previousTokenHash;
      INSERT INTO dbo.user_sessions (token_hash, user_id, expires_at)
      VALUES (@tokenHash, @userId, DATEADD(second, @sessionSeconds, SYSUTCDATETIME()));
    `, {
      tokenHash: [sql.Char(64), tokenHash(token)], userId: [sql.Int, user.id],
      sessionSeconds: [sql.Int, sessionSeconds],
      previousTokenHash: [sql.Char(64), previousToken ? tokenHash(previousToken) : null],
    });
    attempts.delete(key);
    setCookie(req, res, token, sessionSeconds * 1000);
    res.json({ user: publicUser(user) });
  }));

  app.post('/api/auth/logout', route(async (req, res) => {
    const token = sessionToken(req);
    if (token) await db.query('DELETE FROM dbo.user_sessions WHERE token_hash = @tokenHash', {
      tokenHash: [sql.Char(64), tokenHash(token)],
    });
    clearCookie(req, res);
    res.json({ message: 'Signed out.' });
  }));

  app.use('/api', (req, res, next) => {
    if (req.path === '/health') return next();
    findUser(req).then((user) => {
      if (!user) {
        clearCookie(req, res);
        return res.status(401).json({ error: 'Please sign in to continue.' });
      }
      req.user = publicUser(user);
      next();
    }).catch((error) => forwardError(error, next));
  });
}
