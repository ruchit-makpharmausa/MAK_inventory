import { useEffect, useState } from 'react';
import PageHeading from '../../components/PageHeading.jsx';
import { dateLabel, quantity } from '../../lib/format.js';
import api from '../../lib/api.js';

export default function ShippedProductsPage() {
  const [shipments, setShipments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api('/api/shipments')
      .then((rows) => { if (active) setShipments(rows); })
      .catch((requestError) => { if (active) setError(requestError.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  return <>
    <PageHeading eyebrow="SHIPMENT LOG" title="Shipped Products"
      subtitle="Shipment records linked to automatically created zero-stock items. No inventory is added here." />
    {error && <div className="notice error" role="alert">{error}</div>}
    {loading ? <div className="panel empty-state" role="status">Loading shipment records…</div>
      : <section className="panel history-panel">
        <div className="panel-heading"><div><h2>Shipment history</h2><p>Finished-goods stock removed and shipped product selected for the record.</p></div>
          <span className="count-pill">{shipments.length} shipments</span></div>
        {!shipments.length ? <div className="empty-state compact">No shipments recorded.</div>
          : <div className="table-scroll"><table aria-label="Shipped products">
            <thead><tr><th scope="col">Date</th><th scope="col">Finished Product / SKU</th><th scope="col">Material lot</th><th scope="col">Shipped Products item</th>
              <th scope="col" className="numeric">Quantity</th><th scope="col">Shipped by</th></tr></thead>
            <tbody>{shipments.map((row) => <tr key={row.id}>
              <td>{dateLabel(row.date)}</td>
              <td>{row.finishedMakItemCode || '—'} · {row.finishedProductName} ({row.finishedItemCode})</td>
              <td>{row.sourceMaterialLotNumber || 'Unassigned (N/A)'}</td>
              <td>{row.shippedMakItemCode || '—'} · {row.shippedProductName} ({row.shippedItemCode})</td>
              <td className="numeric">{quantity(row.quantity)}</td><td>{row.addedBy || '—'}</td>
            </tr>)}</tbody>
          </table></div>}
      </section>}
  </>;
}
