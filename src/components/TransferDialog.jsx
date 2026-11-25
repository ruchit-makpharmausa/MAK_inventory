import { useEffect, useRef, useState } from 'react';
import { quantity } from '../lib/format.js';
import api from '../lib/api.js';

export default function TransferDialog({ sourceProduct, products, onClose, onSaved }) {
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
    const form = new FormData(event.currentTarget);
    submitting.current = true;
    setSaving(true);
    setError('');
    try {
      await api('/api/transfers', { method: 'POST', body: JSON.stringify({
        sourceProductId: Number(sourceProduct.id), destinationProductId: Number(form.get('destinationProductId')),
      }) });
    } catch (requestError) {
      setError(requestError.message);
      submitting.current = false;
      setSaving(false);
      return;
    }
    onSaved();
  };

  const destinations = products.filter((product) => String(product.id) !== String(sourceProduct.id)
    && Boolean(product.makItemCode?.trim())
    && String(product.productTypeId) === String(sourceProduct.productTypeId)
    && String(product.unit).trim().toLowerCase().replace(/s$/, '') === String(sourceProduct.unit).trim().toLowerCase().replace(/s$/, ''));

  return <dialog ref={dialogRef} className="modal transaction-dialog" aria-labelledby="transfer-dialog-title"
    aria-describedby="transfer-dialog-source" aria-busy={saving} onCancel={(event) => { event.preventDefault(); close(); }}>
    <div className="modal-heading"><div><div className="eyebrow">INVENTORY TRANSFER</div>
      <h2 id="transfer-dialog-title">Transfer MAK Item Code</h2></div>
      <button type="button" className="icon-button" onClick={close} disabled={saving} aria-label="Close dialog">×</button></div>
    <div id="transfer-dialog-source" className="transaction-dialog-product">
      <strong>From: {sourceProduct.makItemCode || '—'}</strong>
      <p>{sourceProduct.name} · {sourceProduct.itemCode}</p>
      <p>Full available balance: {quantity(sourceProduct.availableBalance)} {sourceProduct.unit}</p>
      <p>All available material lots and quantities will be retained at the destination.</p>
    </div>
    {error && <div className="form-error" role="alert">{error}</div>}
    <form onSubmit={submit}>
      <fieldset disabled={saving}>
        <label>Destination MAK Item Code <span className="required">*</span>
          <select name="destinationProductId" required defaultValue="">
            <option value="" disabled>Select destination MAK Item Code</option>
            {destinations.map((product) => <option key={product.id} value={product.id}>
              {product.makItemCode || '—'} · {product.name} ({product.itemCode})
            </option>)}
          </select>
        </label>
      </fieldset>
      <div className="modal-actions">
        <button type="button" className="button secondary" onClick={close} disabled={saving}>Cancel</button>
        <button className="button primary" disabled={saving || !destinations.length || Number(sourceProduct.availableBalance) <= 0}>
          {saving ? 'Transferring…' : 'Transfer full balance'}
        </button>
      </div>
    </form>
  </dialog>;
}
