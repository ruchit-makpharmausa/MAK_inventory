import { hashPassword } from '../server/passwords.js';

export async function usersDatabase() {
  const passwordHash = await hashPassword('fixture-password-123');
  const users = [
    { id: 1, username: 'admin.test', displayName: 'Test Admin', passwordHash, isActive: true, isAdmin: true },
    { id: 2, username: 'regular.test', displayName: 'Test User', passwordHash, isActive: true, isAdmin: false },
  ];
  const sessions = new Map();
  const calls = [];
  const company = { id: 17, name: 'Quten', code: 'TRV' };
  const publicAccount = ({ passwordHash: _passwordHash, ...user }) => ({ ...user });
  return {
    users, calls,
    async getPool() { return {}; },
    async query(statement, parameters = {}) {
      calls.push({ statement, parameters });
      if (statement.includes('FROM dbo.user_sessions s JOIN dbo.app_users u')) {
        const session = sessions.get(parameters.tokenHash[1]);
        const user = users.find((entry) => entry.id === session?.userId && entry.isActive);
        return { recordset: user ? [{ ...publicAccount(user), ...(session.companyId ? {
          companyId: company.id, companyName: company.name, companyCode: company.code,
        } : {}) }] : [] };
      }
      if (statement.includes('FROM dbo.companies WHERE is_active = 1')) {
        return { recordset: [{ ...company }] };
      }
      if (statement.includes('FROM dbo.companies WHERE id = @companyId AND is_active = 1')) {
        return { recordset: [{ companyId: company.id, companyName: company.name, companyCode: company.code }] };
      }
      if (statement.includes('UPDATE dbo.user_sessions SET current_company_id = @companyId')) {
        const session = sessions.get(parameters.tokenHash[1]);
        if (session) session.companyId = company.id;
        return { recordset: [] };
      }
      if (statement.includes('FROM dbo.app_users WHERE username = @username')) {
        return { recordset: users.filter((entry) => entry.username === parameters.username[1]) };
      }
      if (statement.includes('INSERT INTO dbo.user_sessions')) {
        sessions.delete(parameters.previousTokenHash[1]);
        sessions.set(parameters.tokenHash[1], { userId: parameters.userId[1], companyId: null });
        return { recordset: [] };
      }
      if (statement.includes('DELETE FROM dbo.user_sessions WHERE token_hash')) {
        sessions.delete(parameters.tokenHash[1]);
        return { recordset: [] };
      }
      if (statement.includes('INSERT INTO dbo.app_users')) {
        const username = parameters.username[1];
        if (users.some((entry) => entry.username === username)) throw Object.assign(new Error('Duplicate'), { number: 2627 });
        const user = {
          id: users.length + 1, username, displayName: parameters.displayName[1],
          passwordHash: parameters.passwordHash[1], isAdmin: parameters.isAdmin[1], isActive: true,
        };
        users.push(user);
        return { recordset: [publicAccount(user)] };
      }
      if (statement.includes('FROM dbo.app_users ORDER BY username')) {
        return { recordset: users.map(publicAccount).sort((a, b) => a.username.localeCompare(b.username)) };
      }
      if (statement.includes('FROM dbo.products p') || statement.includes('FROM dbo.product_types ORDER BY name')) {
        return { recordset: [] };
      }
      throw new Error(`Unexpected fixture query: ${statement}`);
    },
  };
}
