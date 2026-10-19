import { useEffect, useState } from 'react';

export default function AdminPage({ api }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError('');
    api('/api/users')
      .then((data) => { if (active) setUsers(data); })
      .catch((error) => { if (active) setLoadError(error.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, reload]);

  const addUser = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setMessage(null);
    if (data.get('password') !== data.get('confirmPassword')) {
      setMessage({ kind: 'error', text: 'Passwords do not match.' });
      return;
    }
    setBusy(true);
    try {
      const user = await api('/api/users', {
        method: 'POST',
        body: JSON.stringify({
          username: data.get('username'), displayName: data.get('displayName'),
          password: data.get('password'), isAdmin: data.get('role') === 'admin',
        }),
      });
      setUsers((current) => [...current, user].sort((a, b) => a.username.localeCompare(b.username)));
      form.reset();
      setMessage({ kind: 'success', text: `User "${user.username}" added. They can now sign in.` });
    } catch (error) {
      setMessage({ kind: 'error', text: error.message });
    } finally {
      setBusy(false);
    }
  };

  return <>
    <div className="page-heading">
      <div><div className="eyebrow">ADMINISTRATION</div><h1>Admin Panel</h1>
        <p>Add sign-in accounts and view workspace users.</p></div>
    </div>
    {message && <div className={`notice ${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>
      <span>{message.text}</span><button aria-label="Dismiss user message" onClick={() => setMessage(null)}>×</button>
    </div>}
    <div className="transaction-layout">
      <section className="panel transaction-form-panel" aria-labelledby="add-user-title">
        <div className="panel-heading"><div><h2 id="add-user-title">Add user</h2>
          <p>New accounts are active immediately.</p></div></div>
        <form onSubmit={addUser}>
          <fieldset className="admin-fields" disabled={busy || loading || Boolean(loadError)}>
            <label>Display name
              <input name="displayName" required maxLength={150} autoComplete="off" placeholder="Full name" />
            </label>
            <label>Username
              <input name="username" required minLength={3} maxLength={100} pattern="[a-zA-Z0-9._@\-]{3,100}"
                autoComplete="off" autoCapitalize="none" spellCheck={false} aria-describedby="username-help" />
              <span className="field-help" id="username-help">3–100 characters: letters, numbers, dot, underscore, @ or hyphen.</span>
            </label>
            <label>Role
              <select name="role" defaultValue="user" aria-describedby="role-help">
                <option value="user">User</option><option value="admin">Administrator</option>
              </select>
              <span className="field-help" id="role-help">Administrators can view and add users. Both roles can use inventory.</span>
            </label>
            <label>Password
              <input name="password" type="password" required minLength={6} maxLength={256}
                autoComplete="new-password" aria-describedby="password-help" />
              <span className="field-help" id="password-help">Use 6–256 characters. Share it securely with the account owner.</span>
            </label>
            <label>Confirm password
              <input name="confirmPassword" type="password" required minLength={6} maxLength={256} autoComplete="new-password" />
            </label>
            <button className="button primary submit-button" disabled={busy}>{busy ? 'Adding user…' : 'Add user'}</button>
          </fieldset>
        </form>
      </section>
      <section className="panel" aria-labelledby="users-title">
        <div className="panel-heading"><h2 id="users-title">Users</h2>
          {!loading && !loadError && <span className="count-pill">{users.length} accounts</span>}
        </div>
        {loading ? <div className="empty-state" role="status">Loading users…</div>
          : loadError ? <div className="empty-state"><p role="alert">{loadError}</p>
            <button className="button secondary" onClick={() => setReload((value) => value + 1)}>Retry</button></div>
            : users.length === 0 ? <div className="empty-state">No users found.</div>
              : <div className="table-scroll"><table className="users-table">
                <thead><tr><th scope="col">Name</th><th scope="col">Username</th><th scope="col">Role</th><th scope="col">Status</th></tr></thead>
                <tbody>{users.map((user) => <tr key={user.id}>
                  <td className="product-cell">{user.displayName}</td><td>{user.username}</td>
                  <td><span className="type-badge">{user.isAdmin ? 'Administrator' : 'User'}</span></td>
                  <td>{user.isActive ? 'Active' : 'Inactive'}</td>
                </tr>)}</tbody>
              </table></div>}
      </section>
    </div>
  </>;
}
