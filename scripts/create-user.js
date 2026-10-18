import sql from 'mssql';
import database, { closePool } from '../server/database.js';
import { hashPassword, validPassword, validUsername } from '../server/passwords.js';

const username = process.env.APP_USER_NAME?.trim().toLowerCase();
const password = process.env.APP_USER_PASSWORD;
const displayName = process.env.APP_USER_DISPLAY_NAME?.trim() || username;
delete process.env.APP_USER_PASSWORD;

try {
  if (!validUsername(username)) throw new Error('APP_USER_NAME must be 3–100 characters: letters, numbers, dot, underscore, @ or hyphen.');
  if (!validPassword(password)) throw new Error('APP_USER_PASSWORD must contain between 12 and 256 characters.');
  if (displayName.length > 150) throw new Error('APP_USER_DISPLAY_NAME must contain at most 150 characters.');
  const passwordHash = await hashPassword(password);
  await database.query(`
    INSERT INTO dbo.app_users (username, display_name, password_hash)
    VALUES (@username, @displayName, @passwordHash);
  `, { username: [sql.NVarChar(100), username], displayName: [sql.NVarChar(150), displayName], passwordHash: [sql.VarChar(200), passwordHash] });
  console.log(`Login account created: ${username}`);
} catch (error) {
  console.error([2601, 2627].includes(error.number) ? 'That username already exists.' : error.status === 503 || !error.code && !error.number ? error.message : 'Account creation failed. Check the login tables and database permissions.');
  process.exitCode = 1;
} finally {
  await closePool();
}
