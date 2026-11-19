import { useCallback, useEffect, useState } from 'react';
import PageHeading from '../../components/PageHeading.jsx';
import api from '../../lib/api.js';

const timestamp = (value) => value ? new Date(value).toLocaleString() : '—';

export default function AuditLogPage() {
  const [events, setEvents] = useState([]);
  const [users, setUsers] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [draftFilters, setDraftFilters] = useState({ username: '', from: '', to: '' });
  const [filters, setFilters] = useState({ username: '', from: '', to: '' });
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (beforeId, append, activeFilters) => {
    if (append) setLoadingOlder(true);
    else setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (beforeId) params.set('beforeId', beforeId);
      if (activeFilters.username) params.set('username', activeFilters.username);
      if (activeFilters.from) params.set('from', activeFilters.from);
      if (activeFilters.to) params.set('to', activeFilters.to);
      const serialized = params.toString();
      const query = serialized ? `?${serialized}` : '';
      const result = await api(`/api/audit-logs${query}`);
      setEvents((current) => append ? [...current, ...result.events] : result.events);
      setCursor(result.nextBeforeId);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
      setLoadingOlder(false);
    }
  }, []);

  useEffect(() => { load(null, false, filters); }, [load, filters]);
  useEffect(() => {
    api('/api/audit-logs/users').then(setUsers).catch((requestError) => setError(requestError.message));
  }, []);

  const updateDraft = (key, value) => setDraftFilters((current) => ({ ...current, [key]: value }));
  const applyFilters = (event) => {
    event.preventDefault();
    setFilters({ ...draftFilters });
  };
  const clearFilters = () => {
    const empty = { username: '', from: '', to: '' };
    setDraftFilters(empty);
    setFilters(empty);
  };

  return <>
    <PageHeading eyebrow="ACCOUNTABILITY" title="Audit Log"
      subtitle="Review sign-ins, sign-outs, and API activity for the selected company." />
    {error && <div className="notice error" role="alert">{error}</div>}
    <section className="panel">
      <div className="panel-heading"><div><h2>Activity</h2>
        <p>Passwords and request contents are never recorded.</p></div>
        {!loading && <span className="count-pill">{events.length} events loaded</span>}
      </div>
      <form className="audit-filters" onSubmit={applyFilters}>
        <label>User
          <select value={draftFilters.username} onChange={(event) => updateDraft('username', event.target.value)}>
            <option value="">All users</option>
            {users.map((user) => <option key={user.username} value={user.username}>
              {user.displayName ? `${user.displayName} (${user.username})` : user.username}
            </option>)}
          </select>
        </label>
        <label>From date<input type="date" value={draftFilters.from} onChange={(event) => updateDraft('from', event.target.value)} /></label>
        <label>To date<input type="date" value={draftFilters.to} onChange={(event) => updateDraft('to', event.target.value)} /></label>
        <div className="audit-filter-actions">
          <button className="button primary">Apply filters</button>
          <button type="button" className="button secondary" onClick={clearFilters}>Clear</button>
        </div>
      </form>
      {loading ? <div className="empty-state" role="status">Loading audit events…</div>
        : !events.length ? <div className="empty-state">No audit events recorded for this company yet.</div>
          : <div className="table-scroll"><table className="audit-table" aria-label="Audit activity">
            <thead><tr><th scope="col">Time</th><th scope="col">User</th><th scope="col">Action</th>
              <th scope="col">Method</th><th scope="col">Endpoint</th><th scope="col">Status</th></tr></thead>
            <tbody>{events.map((event) => <tr key={event.id}>
              <td>{timestamp(event.occurredAt)}</td>
              <td>{event.displayName || event.username || 'Unknown user'}{event.username && <small className="audit-username">{event.username}</small>}</td>
              <td>{event.action.replaceAll('_', ' ')}</td>
              <td>{event.method}</td><td className="audit-endpoint">{event.endpoint}</td>
              <td>{event.statusCode}</td>
            </tr>)}</tbody>
          </table></div>}
      {cursor && <div className="audit-load-more">
        <button className="button secondary" disabled={loadingOlder} onClick={() => load(cursor, true, filters)}>
          {loadingOlder ? 'Loading…' : 'Load older events'}
        </button>
      </div>}
    </section>
  </>;
}
