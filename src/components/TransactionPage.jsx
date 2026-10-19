import { useEffect, useState } from 'react';
import PageHeading from './PageHeading.jsx';
import api from '../lib/api.js';
import { dateLabel, quantity, today } from '../lib/format.js';

export default function TransactionPage({ kind, products, onSaved }) {
  const receiving = kind === 'receiving';
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [formKey, setFormKey] = useState(0);
  useEffect(() => {
    api(`/api/transactions/${kind}`).then(setRows).catch((requestError) => setError(requestError.message));
  }, [kind]);

  const submit = async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const body = Object.fromEntries(form.entries());
    body.productId = Number(body.productId);
    body.quantity = Number(body.quantity);
    setSaving(true);
    setError('');
    try {
      await api(`/api/transactions/${kind}`, { method: 'POST', body: JSON.stringify(body) });
      formElement.reset();
      setFormKey((key) => key + 1);
      await onSaved(kind);
      setRows(await api(`/api/transactions/${kind}`));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  };

  return <>
    <PageHeading eyebrow={receiving ? 'INVENTORY IN' : 'INVENTORY OUT'} title={receiving ? 'Receive inventory' : 'Record usage'}
      subtitle={receiving ? 'Add received materials to available product inventory.' : 'Record materials consumed by packaging or manufacturing.'} />
    <div className="transaction-layout">
      <section className="panel transaction-form-panel">
        <div className="panel-heading"><div><h2>{receiving ? 'Receiving details' : 'Usage details'}</h2>
          <p>Fields marked <span className="required">*</span> are required.</p></div></div>
        {error && <div className="form-error" role="alert">{error}</div>}
        {!products.length && <div className="form-error" role="alert">Add a product in Product Master before recording transactions.</div>}
        <form key={formKey} onSubmit={submit}>
          <label>Product <span className="required">*</span>
            <select name="productId" required defaultValue="">
              <option value="" disabled>Select product by name or item code</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.itemCode} — {p.name} ({quantity(p.availableBalance)} {p.unit} available)</option>)}
            </select>
          </label>
          <label>{receiving ? 'Receiving' : 'Usage'} date <span className="required">*</span>
            <input name={receiving ? 'receivingDate' : 'usageDate'} type="date" required defaultValue={today()} />
          </label>
          <label>{receiving ? 'Received quantity' : 'Quantity used'} <span className="required">*</span>
            <input name="quantity" type="number" min="0" step="any" required placeholder="Enter quantity" />
          </label>
          <label>{receiving ? 'MAK RN Number' : 'Material lot number'}
            <span className="muted-label">{receiving ? ' (optional)' : ' (required when product inventory is lot-tracked)'}</span>
            <input name="materialLotNumber" placeholder={receiving ? 'Enter MAK RN Number' : 'Enter material lot number'} />
          </label>
          {!receiving && <label>MAK lot number <span className="required">*</span>
            <input name="makLotNumber" required placeholder="e.g. M260001" />
          </label>}
          <label>Remarks <span className="muted-label">(optional)</span>
            <textarea name="remarks" rows="3" placeholder="Add a note if needed" />
          </label>
          <button className="button primary submit-button" disabled={saving || !products.length}>
            {saving ? 'Saving…' : receiving ? 'Save receiving' : 'Save usage'}
          </button>
        </form>
      </section>
      <section className="panel recent-panel">
        <div className="panel-heading"><div><h2>Recent {receiving ? 'receiving' : 'usage'}</h2>
          <p>Latest inventory transactions.</p></div><span className="count-pill">{rows.length}</span></div>
        {!rows.length ? <div className="empty-state compact"><span>No transactions recorded yet.</span></div>
          : <div className="recent-list">{rows.slice(0, 8).map((row) => <div className="recent-row" key={row.id}>
            <div className={`recent-icon ${receiving ? 'green' : 'amber'}`}>{receiving ? '↓' : '↑'}</div>
            <div className="recent-info"><strong>{row.productName}</strong><span>{row.itemCode} · {dateLabel(row.date)}</span></div>
            <div className="recent-quantity">{receiving ? '+' : '−'}{quantity(row.quantity)}<small>{row.unit}</small></div>
          </div>)}</div>}
      </section>
    </div>
  </>;
}
