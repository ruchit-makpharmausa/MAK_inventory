import { useEffect, useRef, useState } from 'react';
import { today, quantity } from '../lib/format.js';
import api from '../lib/api.js';

export default function TransferDialog({ sourceProduct, products, onClose, onSaved }) {
  const dialogRef = useRef(null);
  const submitting = useRef(false);
  const [lots, setLots] = useState([]);
  const [lotsLoading, setLotsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    dialog.showModal();
    api(`/api/products/${encodeURIComponent(sourceProduct.id)}/transfer-lots`)
      .then(setLots)
      .catch((requestError) => setError(requestError.message))
      .finally(() => setLotsLoading(false));
    return () => {
      dialog.close();
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [sourceProduct.id]);

  const close = () => { if (!submitting.current) onClose(); };
  const submit = async (event) => {
    event.preventDefault();
    if (submitting.current) return;
    const form = new FormData(event.currentTarget);
    const body = {
      sourceProductId: Number(sourceProduct.id),
      destinationProductId: Number(form.get('destinationProductId')),
      sourceMaterialLotNumber: form.get('sourceMaterialLotNumber') === '__UNASSIGNED__' ? null : form.get('sourceMaterialLotNumber'),
      destinationMakLotNumber: form.get('destinationMakLotNumber'),
      transferDate: form.get('transferDate'),
      quantity: Number(form.get('quantity')),
    };
    submitting.current = true;
    setSaving(true);
    setError('');
    try {
      await api('/api/transfers', { method: 'POST', body: JSON.stringify(body) });
    } catch (requestError) {
      setError(requestError.message);
      submitting.current = false;
      setSaving(false);
      return;
    }
    onSaved();
  };


  return <dialog ref={dialogRef} className="modal transaction-dialog" aria-labelledby="transfer-dialog-title"
    aria-describedby="transfer-dialog-source" aria-busy={saving} onCancel={(event) => { event.preventDefault(); close(); }}>
    <div className="modal-heading"><div><div className="eyebrow">INVENTORY TRANSFER</div>
      <h2 id="transfer-dialog-title">Transfer between products</h2></div>
      <button type="button" className="icon-button" onClick={close} disabled={saving} aria-label="Close dialog">×</button></div>
    <div id="transfer-dialog-source" className="transaction-dialog-product">
      <strong>Source: {sourceProduct.name}</strong>
      <p>{sourceProduct.makItemCode || '—'} · {sourceProduct.itemCode} · {sourceProduct.productType}</p>
      <p>Available: {quantity(sourceProduct.availableBalance)} {sourceProduct.unit}</p>
    </div>
    {error && <div className="form-error" role="alert">{error}</div>}
    {!lotsLoading && !lots.length && <button type="button" className="text-button" onClick={() => api(`/api/products/${encodeURIComponent(sourceProduct.id)}/transfer-lots`)
      .then(setLots).catch((requestError) => setError(requestError.message))}>Retry source lot list</button>}
    <form onSubmit={submit}>
      <fieldset disabled={saving || lotsLoading}>
        <label>Source material lot <span className="required">*</span>
          <select name="sourceMaterialLotNumber" required defaultValue="" aria-describedby="transfer-source-lot-help">
            <option value="" disabled>Select source lot</option>
            {lots.map((lot) => <option key={lot.materialLotNumber ?? 'unassigned'} value={lot.materialLotNumber ?? '__UNASSIGNED__'}>
              {lot.materialLotNumber ?? 'Unassigned (N/A)'} ({quantity(lot.availableQuantity)} {sourceProduct.unit} available)
            </option>)}
          </select>
        </label>
        <span id="transfer-source-lot-help" className="field-help">
          {lotsLoading ? 'Loading available source lots…' : lots.length ? 'Only lots with remaining stock are listed.' : 'No source lots have available stock.'}
        </span>
        <label>Destination product <span className="required">*</span>
          <select name="destinationProductId" required defaultValue="">
            <option value="" disabled>Select destination product</option>
            {products.filter((product) => String(product.id) !== String(sourceProduct.id)
              && String(product.productTypeId) === String(sourceProduct.productTypeId)
              && String(product.unit).trim().toLowerCase().replace(/s$/, '') === String(sourceProduct.unit).trim().toLowerCase().replace(/s$/, ''))
              .map((product) => <option key={product.id} value={product.id}>
                {product.makItemCode || '—'} · {product.itemCode} — {product.name} ({product.productType})
              </option>)}
          </select>
        </label>
        <label>Destination MAK lot number <span className="required">*</span>
          <input name="destinationMakLotNumber" required maxLength={255} placeholder="e.g. TRV260001" />
        </label>
        <label>Transfer date <span className="required">*</span>
          <input name="transferDate" type="date" required defaultValue={today()} />
        </label>
        <label>Quantity <span className="required">*</span>
          <input name="quantity" type="number" min="0" step="any" required placeholder="Enter quantity" />
        </label>
      </fieldset>
      <div className="modal-actions">
        <button type="button" className="button secondary" onClick={close} disabled={saving}>Cancel</button>
        <button className="button primary" disabled={saving || lotsLoading || !lots.length}>
          {saving ? 'Transferring…' : 'Transfer inventory'}
        </button>
      </div>
    </form>
  </dialog>;
}
