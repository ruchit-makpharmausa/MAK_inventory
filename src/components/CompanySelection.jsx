import { useEffect, useState } from 'react';
import api from '../lib/api.js';

export default function CompanySelection({ user, onSelected }) {
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadCompanies = () => {
    setLoading(true);
    setError('');
    api('/api/companies')
      .then(setCompanies)
      .catch((requestError) => setError(requestError.message))
      .finally(() => setLoading(false));
  };

  useEffect(loadCompanies, []);

  const selectCompany = async (companyId) => {
    setBusy(true);
    setError('');
    try {
      const result = await api('/api/auth/company', { method: 'POST', body: JSON.stringify({ companyId }) });
      onSelected(result.user);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const addCompany = async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    setError('');
    try {
      const company = await api('/api/companies', {
        method: 'POST', body: JSON.stringify({ name: form.get('name'), code: form.get('code') }),
      });
      setCompanies((current) => [...current, company].sort((a, b) => a.name.localeCompare(b.name)));
      formElement.reset();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const archiveCompany = async (company) => {
    if (!window.confirm(`Archive ${company.name}? Its inventory will be kept but unavailable for selection.`)) return;
    setBusy(true);
    setError('');
    try {
      await api(`/api/companies/${company.id}/archive`, { method: 'POST' });
      setCompanies((current) => current.map((item) => item.id === company.id ? { ...item, isActive: false } : item));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const restoreCompany = async (company) => {
    setBusy(true);
    setError('');
    try {
      await api(`/api/companies/${company.id}/restore`, { method: 'POST' });
      setCompanies((current) => current.map((item) => item.id === company.id ? { ...item, isActive: true } : item));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const activeCompanies = companies.filter((company) => company.isActive !== false);
  const archivedCompanies = companies.filter((company) => company.isActive === false);

  return <main className="login-page">
    <div className="login-card company-picker-card">
      <div className="brand-mark">M</div>
      <div className="eyebrow">COMPANY WORKSPACE</div>
      <h1>Choose a company</h1>
      <p>Signed in as {user.displayName || user.username}. Select the company whose inventory you want to access.</p>
      {error && <div className="form-error" role="alert">{error}</div>}
      {loading ? <div className="empty-state" role="status">Loading companies…</div>
        : activeCompanies.length ? <div className="company-options">
          {activeCompanies.map((company) => <div className="company-option" key={company.id}>
            <button type="button" className="button secondary" disabled={busy} onClick={() => selectCompany(company.id)}>
              <strong>{company.name}</strong><span>{company.code}</span>
            </button>
            {user.isAdmin && <button type="button" className="text-button" disabled={busy}
              onClick={() => archiveCompany(company)}>Archive</button>}
          </div>)}
        </div> : <div className="empty-state">No active companies are available.</div>}
      {user.isAdmin && archivedCompanies.length > 0 && <section className="archived-companies">
        <h2>Archived companies</h2>
        {archivedCompanies.map((company) => <div className="company-option" key={company.id}>
          <span>{company.name} · {company.code}</span>
          <button type="button" className="text-button" disabled={busy} onClick={() => restoreCompany(company)}>Restore</button>
        </div>)}
      </section>}
      {user.isAdmin && <form className="company-create-form" onSubmit={addCompany}>
        <h2>Add company</h2>
        <label>Company name<input name="name" required maxLength={150} placeholder="Company name" disabled={busy} /></label>
        <label>Company code<input name="code" required minLength={2} maxLength={20} pattern="[A-Za-z0-9-]{2,20}"
          placeholder="e.g. ABC" disabled={busy} /></label>
        <button className="button primary" disabled={busy}>{busy ? 'Saving…' : 'Add company'}</button>
      </form>}
      <button type="button" className="text-button company-signout" onClick={async () => {
        try { await api('/api/auth/logout', { method: 'POST' }); window.location.assign('/login'); }
        catch (requestError) { setError(requestError.message); }
      }}>Sign out</button>
    </div>
  </main>;
}
