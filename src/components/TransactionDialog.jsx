import { useEffect, useRef, useState } from 'react';
import TransactionFields from './TransactionFields.jsx';
import api from '../lib/api.js';
import { quantity } from '../lib/format.js';

export default function TransactionDialog({ kind, product, onClose, onSaved }) {
  const receiving = kind === 'receiving';
  const dialogRef = useRef(null);
  const submitting = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  const close = () => { if (!submitting.current) onClose(); };
  const submit = async (event) => {
    event.preventDefault();
    if (submitting.current) return;
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    body.productId = Number(product.id);
    body.quantity = Number(body.quantity);
    submitting.current = true;
    setSaving(true);
    setError('');
    try {
      await api(`/api/transactions/${kind}`, { method: 'POST', body: JSON.stringify(body) });
    } catch (requestError) {
      setError(requestError.message);
      submitting.current = false;
      setSaving(false);
      return;
    }
    // The parent closes the saved form before refreshing so refresh errors cannot cause duplicate entries.
    onSaved(kind);
  };

  return <dialog ref={dialogRef} className="modal transaction-dialog" aria-labelledby="transaction-dialog-title"
    aria-describedby="transaction-dialog-product" aria-busy={saving} onCancel={(event) => { event.preventDefault(); close(); }}
    onClick={(event) => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
    }}>
    <div className="modal-heading"><div><div className="eyebrow">{receiving ? 'INVENTORY IN' : 'INVENTORY OUT'}</div>
      <h2 id="transaction-dialog-title">{receiving ? 'Receive inventory' : 'Record usage'}</h2></div>
      <button type="button" className="icon-button" onClick={close} disabled={saving} aria-label="Close dialog">×</button></div>
    <div id="transaction-dialog-product" className="transaction-dialog-product">
      <strong>{product.name}</strong>
      <p>{product.makItemCode || '—'} · {product.itemCode} · {product.productType}</p>
      <p>Available: {quantity(product.availableBalance)} {product.unit}</p>
      <p>Fields marked <span className="required">*</span> are required.</p>
    </div>
    {error && <div className="form-error" role="alert">{error}</div>}
    <form onSubmit={submit}>
      <fieldset disabled={saving}>
        <TransactionFields kind={kind} />
      </fieldset>
      <div className="modal-actions">
        <button type="button" className="button secondary" onClick={close} disabled={saving}>Cancel</button>
        <button className="button primary" disabled={saving}>{saving ? 'Saving…' : receiving ? 'Save receiving' : 'Save usage'}</button>
      </div>
    </form>
  </dialog>;
}
