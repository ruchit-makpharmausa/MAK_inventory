import { useEffect, useRef, useState } from 'react';
import { today, quantity } from '../lib/format.js';
import api from '../lib/api.js';

export default function TransferDialog({ sourceProduct, products, onClose, onSaved }) {
  const dialogRef = useRef(null);
  const submitting = useRef(false);
  const [lots, setLots] = useState([]);
  const [lotsLoading, setLotsLoading] = useState(true);
  const [lotError, setLotError] = useState('');
  const [lotAttempt, setLotAttempt] = useState(0);
  const [selectedLotValue, setSelectedLotValue] = useState('');
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

  useEffect(() => {
    let active = true;
    setLots([]);
    setSelectedLotValue('');
    setLotError('');
    setLotsLoading(true);
    api(`/api/products/${encodeURIComponent(sourceProduct.id)}/transfer-lots`)
      .then((rows) => { if (active) setLots(rows); })
      .catch((requestError) => { if (active) setLotError(requestError.message); })
      .finally(() => { if (active) setLotsLoading(false); });
    return () => { active = false; };
  }, [sourceProduct.id, lotAttempt]);

  const sourceLot = selectedLotValue === '__UNASSIGNED__' ? null : selectedLotValue;
  const selectedLot = selectedLotValue ? lots.find((lot) => lot.materialLotNumber === sourceLot) : undefined;

  const close = () => { if (!submitting.current) onClose(); };
  const submit = async (event) => {
    event.preventDefault();
    if (submitting.current) return;
    const form = new FormData(event.currentTarget);
    const body = {
      sourceProductId: Number(sourceProduct.id), destinationProductId: Number(form.get('destinationProductId')),
      sourceMaterialLotNumber: sourceLot, transferDate: form.get('transferDate'), quantity: Number(form.get('quantity')),
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

  const destinations = products.filter((product) => String(product.id) !== String(sourceProduct.id)
    && Boolean(product.makItemCode?.trim())
    && String(product.productTypeId) === String(sourceProduct.productTypeId)
    && String(product.unit).trim().toLowerCase().replace(/s$/, '') === String(sourceProduct.unit).trim().toLowerCase().replace(/s$/, ''));

  return <dialog ref={dialogRef} className="modal transaction-dialog" aria-labelledby="transfer-dialog-title"
    aria-describedby="transfer-dialog-source" aria-busy={saving} onCancel={(event) => { event.preventDefault(); close(); }}>
    <div className="modal-heading"><div><div className="eyebrow">INVENTORY TRANSFER</div>
      <h2 id="transfer-dialog-title">Transfer a lot</h2></div>
      <button type="button" className="icon-button" onClick={close} disabled={saving} aria-label="Close dialog">×</button></div>
    <div id="transfer-dialog-source" className="transaction-dialog-product">
      <strong>From: {sourceProduct.makItemCode || '—'}</strong>
      <p>{sourceProduct.name} · {sourceProduct.itemCode}</p>
      <p>Available in this product: {quantity(sourceProduct.availableBalance)} {sourceProduct.unit}</p>
      <p>Select one source lot and transfer part or all of its available quantity to the destination product. The material lot number is preserved.</p>
    </div>
    {error && <div className="form-error" role="alert">{error}</div>}
    <form onSubmit={submit}>
      <fieldset disabled={saving || lotsLoading}>
        <label>Source material lot <span className="required">*</span>
          <select name="sourceMaterialLotNumber" required value={selectedLotValue}
            onChange={(event) => setSelectedLotValue(event.target.value)} aria-describedby="transfer-lot-help">
            <option value="" disabled>Select source lot</option>
            {lots.map((lot) => <option key={lot.materialLotNumber ?? '__UNASSIGNED__'} value={lot.materialLotNumber ?? '__UNASSIGNED__'}>
              {lot.materialLotNumber ?? 'Unassigned (N/A)'} ({quantity(lot.availableQuantity)} {sourceProduct.unit} available)
            </option>)}
          </select>
        </label>
        <span id="transfer-lot-help" className="field-help">
          {lotsLoading ? 'Loading available lots for this product…' : lotError ? 'Could not load available lots.'
            : lots.length ? 'Only lots with available stock are listed.' : 'No lots have available stock for this product.'}
        </span>
        {lotError && <div role="alert" className="field-help">{lotError} <button type="button" className="text-button"
          onClick={() => setLotAttempt((attempt) => attempt + 1)}>Retry lot list</button></div>}
        <label>Destination MAK Item Code <span className="required">*</span>
          <select name="destinationProductId" required defaultValue="">
            <option value="" disabled>Select destination MAK Item Code</option>
            {destinations.map((product) => <option key={product.id} value={product.id}>
              {product.makItemCode || '—'} · {product.name} ({product.itemCode})
            </option>)}
          </select>
        </label>
        <label>Transfer date <span className="required">*</span>
          <input name="transferDate" type="date" required defaultValue={today()} />
        </label>
        <label>Quantity to transfer <span className="required">*</span>
          <input name="quantity" type="number" min="0" max={selectedLot?.availableQuantity} step="any" required placeholder="Enter quantity" />
        </label>
        <span className="field-help">
          {selectedLot ? `Maximum from this lot: ${quantity(selectedLot.availableQuantity)} ${sourceProduct.unit}.` : 'Select a lot to see its available quantity.'}
        </span>
      </fieldset>
      <div className="modal-actions">
        <button type="button" className="button secondary" onClick={close} disabled={saving}>Cancel</button>
        <button className="button primary" disabled={saving || lotsLoading || !selectedLot || !destinations.length}>
          {saving ? 'Transferring…' : 'Transfer quantity'}
        </button>
      </div>
    </form>
  </dialog>;
}
