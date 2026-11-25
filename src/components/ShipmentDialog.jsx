import { useEffect, useRef, useState } from 'react';
import { today, quantity } from '../lib/format.js';
import api from '../lib/api.js';

export default function ShipmentDialog({ product, onClose, onSaved }) {
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
    api(`/api/products/${encodeURIComponent(product.id)}/transfer-lots`)
      .then((rows) => { if (active) setLots(rows); })
      .catch((requestError) => { if (active) setLotError(requestError.message); })
      .finally(() => { if (active) setLotsLoading(false); });
    return () => { active = false; };
  }, [product.id, lotAttempt]);

  const selectedMaterialLotNumber = selectedLotValue === '__UNASSIGNED__' ? null : selectedLotValue;
  const selectedLot = lots.find((lot) => lot.materialLotNumber === selectedMaterialLotNumber);

  const close = () => { if (!submitting.current) onClose(); };
  const submit = async (event) => {
    event.preventDefault();
    if (submitting.current) return;
    const form = new FormData(event.currentTarget);
    submitting.current = true;
    setSaving(true);
    setError('');
    try {
      const result = await api('/api/transactions/shipping', { method: 'POST', body: JSON.stringify({
        productId: Number(product.id),
        sourceMaterialLotNumber: selectedMaterialLotNumber,
        shipmentDate: form.get('shipmentDate'), quantity: Number(form.get('quantity')),
      }) });
      onSaved(result);
    } catch (requestError) {
      setError(requestError.message);
      submitting.current = false;
      setSaving(false);
      return;
    }
  };

  return <dialog ref={dialogRef} className="modal transaction-dialog" aria-labelledby="shipment-dialog-title"
    aria-describedby="shipment-dialog-product" aria-busy={saving}
    onCancel={(event) => { event.preventDefault(); close(); }}>
    <div className="modal-heading"><div><div className="eyebrow">FINISHED GOODS OUT</div>
      <h2 id="shipment-dialog-title">Ship finished goods</h2></div>
      <button type="button" className="icon-button" onClick={close} disabled={saving} aria-label="Close dialog">×</button></div>
    <div id="shipment-dialog-product" className="transaction-dialog-product">
      <strong>{product.makItemCode || '—'} · {product.name}</strong>
      <p>Available: {quantity(product.availableBalance)} {product.unit}</p>
      <p>Select one lot for this SKU. Shipment stock is deducted from that lot; a matching zero-stock item is automatically created or reused in Shipped Products and added to the log.</p>
    </div>
    {error && <div className="form-error" role="alert">{error}</div>}
    <form onSubmit={submit}>
      <fieldset disabled={saving || lotsLoading}>
        <label>Material lot <span className="required">*</span>
          <select name="sourceMaterialLotNumber" required value={selectedLotValue}
            onChange={(event) => setSelectedLotValue(event.target.value)} aria-describedby="shipment-lot-help">
            <option value="" disabled>Select a lot for this SKU</option>
            {lots.map((lot) => <option key={lot.materialLotNumber ?? '__UNASSIGNED__'} value={lot.materialLotNumber ?? '__UNASSIGNED__'}>
              {lot.materialLotNumber ?? 'Unassigned (N/A)'} ({quantity(lot.availableQuantity)} {product.unit} available)
            </option>)}
          </select>
        </label>
        <span id="shipment-lot-help" className="field-help">
          {lotsLoading ? 'Loading available lots for this SKU…' : lotError ? 'Could not load available lots.'
            : lots.length ? 'Only lots with available stock are listed.' : 'No lots have available stock for this SKU.'}
        </span>
        {lotError && <div role="alert" className="field-help">{lotError} <button type="button" className="text-button"
          onClick={() => setLotAttempt((attempt) => attempt + 1)}>Retry lot list</button></div>}
        <label>Shipment date <span className="required">*</span>
          <input name="shipmentDate" type="date" required defaultValue={today()} />
        </label>
        <label>Quantity shipped <span className="required">*</span>
          <input name="quantity" type="number" min="0" max={selectedLot?.availableQuantity} step="any" required placeholder="Enter quantity"
            aria-describedby="shipment-quantity-help" />
        </label>
        <span id="shipment-quantity-help" className="field-help">
          {selectedLot ? `Maximum for this lot: ${quantity(selectedLot.availableQuantity)} ${product.unit}.` : 'Select a lot to see its available quantity.'}
        </span>
      </fieldset>
      <div className="modal-actions">
        <button type="button" className="button secondary" onClick={close} disabled={saving}>Cancel</button>
        <button className="button primary" disabled={saving || lotsLoading || !selectedLot}>
          {saving ? 'Saving shipment…' : 'Save shipment'}
        </button>
      </div>
    </form>
  </dialog>;
}
