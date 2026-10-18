import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sql from 'mssql';
import database, { closePool, connectionFailure } from '../server/database.js';
import { hashPassword, validPassword, validPasswordHash, validUsername, verifyPassword } from '../server/passwords.js';

function normalizeUsername(username) {
  if (!validUsername(username)) throw new Error('APP_USER_NAME must be 3–100 characters: letters, numbers, dot, underscore, @ or hyphen.');
  return username.trim().toLowerCase();
}

export async function checkAccount(db, username, password) {
  if (password !== undefined && (typeof password !== 'string' || !password || password.length > 256)) {
    throw new Error('APP_USER_PASSWORD must contain between 1 and 256 characters when checking a password.');
  }
  const result = await db.query(`
    SELECT DB_NAME() AS databaseName, username, is_active AS isActive, password_hash AS passwordHash
    FROM dbo.app_users WHERE username = @username
  `, { username: [sql.NVarChar(100), normalizeUsername(username)] });
  const user = result.recordset[0];
  if (!user) return { status: 'missing', message: 'Account not found in the configured database. Check the username and SQLSERVER_DATABASE; use create:user only if a new account is intended.' };
  if (!user.isActive) return { status: 'inactive', databaseName: user.databaseName, message: 'This account is inactive. A database administrator must review its activation before it can sign in.' };
  if (!validPasswordHash(user.passwordHash)) return { status: 'invalid-hash', databaseName: user.databaseName, message: 'The stored password is not a supported salted hash. Use reset:password; do not enter plaintext passwords into password_hash.' };
  if (password !== undefined) {
    const matches = await verifyPassword(password, user.passwordHash);
    return {
      status: matches ? 'ready' : 'password-mismatch', databaseName: user.databaseName,
      message: matches
        ? 'Password matches this active account. If website login still fails, verify the running app uses this same SQL Server/database and allow any login-attempt throttle to expire.'
        : 'The supplied password does not match this account. Use reset:password to choose a new password.',
    };
  }
  return { status: 'ready', databaseName: user.databaseName, message: 'Account is active and its password hash has the supported format. This does not verify the entered password. Use reset:password if the password is no longer known.' };
}

export async function resetAccountPassword(db, username, password) {
  const normalized = normalizeUsername(username);
  if (!validPassword(password)) throw new Error('APP_USER_PASSWORD must contain between 6 and 256 characters.');
  const passwordHash = await hashPassword(password);
  return db.transaction(async (executor) => {
    const result = await db.query(`
      UPDATE dbo.app_users SET password_hash = @passwordHash
      OUTPUT INSERTED.id, INSERTED.username
      WHERE username = @username AND is_active = 1
    `, { username: [sql.NVarChar(100), normalized], passwordHash: [sql.VarChar(200), passwordHash] }, executor);
    const user = result.recordset[0];
    if (!user) throw new Error('No active account matches APP_USER_NAME. Run check:user first. No account was created or activated.');
    await db.query('DELETE FROM dbo.user_sessions WHERE user_id = @userId', { userId: [sql.Int, user.id] }, executor);
    return { username: user.username };
  });
}

export async function runUserPassword({ db = database, args = process.argv.slice(2), environment = process.env, log = console.log } = {}) {
  const password = environment.APP_USER_PASSWORD;
  delete environment.APP_USER_PASSWORD;
  const username = normalizeUsername(environment.APP_USER_NAME);
  if (args.length !== 1 || !['check', 'reset'].includes(args[0])) throw new Error('Use npm run check:user or npm run reset:password.');
  if (args[0] === 'check') {
    const result = await checkAccount(db, username, password);
    log(`Configured SQL Server: ${environment.SQLSERVER_HOST || '(not configured)'}; database: ${environment.SQLSERVER_DATABASE || '(not configured)'}`);
    if (result.databaseName) log(`Connected database: ${result.databaseName}`);
    log(result.message);
    return result.status === 'ready' ? 0 : 1;
  }
  const user = await resetAccountPassword(db, username, password);
  log(`Password reset for ${user.username}. Existing sessions were revoked. Sign in with the new password. Roles and account activation were not changed.`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await runUserPassword();
  } catch (error) {
    if (error.number === 229) console.error('Account checks require SELECT on dbo.app_users. Password reset also requires UPDATE on its password_hash column and DELETE on dbo.user_sessions. Ask a database administrator to run recovery with an authorized database login.');
    else if ([207, 208].includes(error.number)) console.error('Login tables are missing or incomplete in the configured database. Check the database name and scripts/login-tables.sql.');
    else if (error.code === 'ETIMEOUT') console.error(connectionFailure(error).message);
    else console.error(error.status === 503 || !error.code && !error.number ? error.message : 'Account recovery failed. Check the database connection and permissions.');
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}
