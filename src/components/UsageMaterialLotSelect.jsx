import { useEffect, useState } from 'react';
import api from '../lib/api.js';
import { quantity } from '../lib/format.js';

export default function UsageMaterialLotSelect({ productId, unit }) {
  const [lots, setLots] = useState([]);
  const [loading, setLoading] = useState(Boolean(productId));
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setLots([]);
    setError('');
    setLoading(Boolean(productId));
    if (productId) {
      api(`/api/products/${encodeURIComponent(productId)}/material-lots`)
        .then((rows) => { if (active) setLots(rows); })
        .catch((requestError) => { if (active) setError(requestError.message); })
        .finally(() => { if (active) setLoading(false); });
    }
    return () => { active = false; };
  }, [productId, attempt]);

  return <div>
    <label>Material lot number <span className="muted-label">(optional)</span>
      <select name="materialLotNumber" defaultValue="" disabled={!productId} aria-describedby="material-lot-help">
        <option value="">N/A</option>
        {lots.map((lot) => <option key={lot.materialLotNumber} value={lot.materialLotNumber}>
          {lot.materialLotNumber} ({quantity(lot.availableQuantity)}{unit ? ` ${unit}` : ''} available)
        </option>)}
      </select>
    </label>
    <span className="field-help" id="material-lot-help">
      {!productId ? 'Select a product to see its available lots.' : loading ? 'Loading available material lots…'
        : error ? 'Lot availability could not be loaded. Retry or choose N/A if the lot is unknown.'
          : lots.length ? 'Select a received lot with remaining stock, or N/A if unknown.'
            : 'No received material lots with remaining stock. Choose N/A if the lot is unknown.'}
    </span>
    {error && <div role="alert" className="field-help">{error} <button type="button" className="text-button"
      onClick={() => setAttempt((value) => value + 1)}>Retry lot list</button></div>}
  </div>;
}
