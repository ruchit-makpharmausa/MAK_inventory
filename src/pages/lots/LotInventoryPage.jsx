import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import PageHeading from '../../components/PageHeading.jsx';
import HistoryTable from '../../components/HistoryTable.jsx';
import api from '../../lib/api.js';
import { quantity } from '../../lib/format.js';
import { filterLotInventory, lotIdentity } from '../../lib/lot-inventory.js';
import { sortProducts } from '../../lib/product-sort.js';

export default function LotInventoryPage({ products, types }) {
  const [params, setParams] = useSearchParams();
  const typeId = params.get('typeId') || '';
  const productId = params.get('productId') || '';
  const search = params.get('search') || '';
  const status = params.get('status') || '';
  const detailProductId = params.get('detailProductId') || '';
  const detailLot = params.has('lot') ? params.get('lot') : null;
  const hasDetail = Boolean(detailProductId && (params.has('lot') || params.get('unassigned') === '1'));
  const [inventory, setInventory] = useState({ rows: [], loading: true, error: '' });
  const [refreshKey, setRefreshKey] = useState(0);
  const [detail, setDetail] = useState({ key: '', data: null, loading: false, error: '' });
  const filtered = filterLotInventory(inventory.rows, { typeId, productId, search, status });
  const productOptions = sortProducts(products.filter((product) => !typeId || String(product.productTypeId) === typeId));
  const detailKey = hasDetail ? lotIdentity(detailProductId, detailLot) : '';
  const selectedRow = inventory.rows.find((row) => lotIdentity(row.productId, row.materialLotNumber) === detailKey);
  const currentDetail = detail.key === detailKey ? detail : { data: null, loading: hasDetail, error: '' };

  useEffect(() => {
    let active = true;
    setInventory((current) => ({ ...current, loading: true, error: '' }));
    api('/api/lot-inventory')
      .then((rows) => { if (active) setInventory({ rows, loading: false, error: '' }); })
      .catch((error) => { if (active) setInventory({ rows: [], loading: false, error: error.message }); });
    return () => { active = false; };
  }, [refreshKey]);

  useEffect(() => {
    let active = true;
    setDetail({ key: detailKey, data: null, loading: hasDetail, error: '' });
    if (hasDetail) {
      const selector = detailLot === null ? 'unassigned=1' : `lot=${encodeURIComponent(detailLot)}`;
      api(`/api/lot-inventory/${encodeURIComponent(detailProductId)}/history?${selector}`)
        .then((data) => { if (active) setDetail({ key: detailKey, data, loading: false, error: '' }); })
        .catch((error) => { if (active) setDetail({ key: detailKey, data: null, loading: false, error: error.message }); });
    }
    return () => { active = false; };
  }, [detailKey, refreshKey]);

  const clearDetail = (next) => {
    next.delete('detailProductId');
    next.delete('lot');
    next.delete('unassigned');
  };
  const filter = (name, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    if (name === 'typeId' && value && !products.some((product) => String(product.id) === productId && String(product.productTypeId) === value)) next.delete('productId');
    clearDetail(next);
    setParams(next, { replace: name === 'search' });
  };
  const selectLot = (row) => {
    const next = new URLSearchParams(params);
    clearDetail(next);
    next.set('detailProductId', String(row.productId));
    if (row.materialLotNumber == null) next.set('unassigned', '1');
    else next.set('lot', row.materialLotNumber);
    setParams(next);
  };

  return <>
    <PageHeading eyebrow="LOT TRACEABILITY" title="Lot Inventory"
      subtitle="Track receiving, usage and remaining quantities for every product and material lot."
      action={<button className="button secondary" onClick={() => setRefreshKey((key) => key + 1)} disabled={inventory.loading}>Refresh</button>} />
    <div className="notice lot-inventory-explanation">
      <span>All lots are shown, including exhausted lots. Unassigned (N/A) transactions are tracked separately and are not allocated to a named lot.
        A named lot balance may exceed total product stock after N/A usage; both lot and product limits still apply when saving usage.</span>
    </div>
    <section className="panel">
      <div className="panel-heading"><div><h2>Inventory by material lot</h2>
        <p>Each product and exact lot number has its own received, used and current balance.</p></div>
        <span className="count-pill">{filtered.length} lot entries</span></div>
      <div className="table-toolbar lot-inventory-filters">
        <div className="search-box"><span>⌕</span><input aria-label="Search lot inventory" placeholder="Search lot, product name or item codes"
          value={search} onChange={(event) => filter('search', event.target.value)} /></div>
        <select className="filter-select" aria-label="Lot product type" value={typeId} onChange={(event) => filter('typeId', event.target.value)}>
          <option value="">All product types</option>{types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
        </select>
        <select className="filter-select lot-product-filter" aria-label="Lot product" value={productId} onChange={(event) => filter('productId', event.target.value)}>
          <option value="">All products</option>{productOptions.map((product) => <option key={product.id} value={product.id}>
            {product.makItemCode || '—'} · {product.itemCode} — {product.name} ({product.productType})
          </option>)}
        </select>
        <select className="filter-select" aria-label="Lot status" value={status} onChange={(event) => filter('status', event.target.value)}>
          <option value="">All lots</option><option value="available">Available</option><option value="exhausted">Exhausted</option>
          <option value="negative">Negative balance</option><option value="unassigned">Unassigned (N/A)</option>
        </select>
      </div>
      {inventory.loading ? <div className="empty-state compact" role="status">Loading lot inventory…</div>
        : inventory.error ? <div className="notice error" role="alert">{inventory.error} Use Refresh to retry.</div>
          : !filtered.length ? <div className="empty-state compact">No lot inventory found. Record receiving or adjust the filters.</div>
            : <div className="table-scroll"><table aria-label="Lot inventory">
              <thead><tr><th>Product type</th><th>MAK Item Code</th><th>Item Code</th><th>Product name</th><th>Material Lot Number</th>
                <th className="numeric">Total received</th><th className="numeric">Total used</th><th className="numeric">Current balance</th><th>Unit</th><th>Actions</th></tr></thead>
              <tbody>{filtered.map((row) => <tr key={lotIdentity(row.productId, row.materialLotNumber)}>
                <td><span className="type-badge">{row.productType}</span></td><td className="code-cell">{row.makItemCode || '—'}</td><td>{row.itemCode}</td>
                <td className="product-cell">{row.productName}</td><td className="code-cell">{row.materialLotNumber ?? 'Unassigned (N/A)'}</td>
                <td className="numeric">{quantity(row.totalReceived)}</td><td className="numeric">{quantity(row.totalUsed)}</td>
                <td className={`numeric balance-cell${Number(row.availableBalance) < 0 ? ' negative' : ''}`}>{quantity(row.availableBalance)}</td><td>{row.unit}</td>
                <td><button type="button" className="text-button" onClick={() => selectLot(row)}
                  aria-label={`View history for ${row.productName}, ${row.productType}, ${row.materialLotNumber ?? 'Unassigned (N/A)'}`}>Lot history</button></td>
              </tr>)}</tbody>
            </table></div>}
    </section>
    {hasDetail && <section className="lot-history-details" aria-label="Selected lot history">
      <div className="panel"><div className="panel-heading"><div>
        <h2>Material lot: {detailLot ?? 'Unassigned (N/A)'}</h2>
        <p>{currentDetail.data ? `${currentDetail.data.product.makItemCode || '—'} · ${currentDetail.data.product.itemCode} — ${currentDetail.data.product.name} (${currentDetail.data.product.productType})` : 'Selected product lot history'}</p>
        {selectedRow && <p>Received: {quantity(selectedRow.totalReceived)} · Used: {quantity(selectedRow.totalUsed)} · Lot balance: {quantity(selectedRow.availableBalance)} {selectedRow.unit}
          {' · '}Total product balance: {quantity(selectedRow.productBalance)} {selectedRow.unit}</p>}
      </div><Link className="button secondary" to={`/inv_history?productId=${encodeURIComponent(detailProductId)}`}>Full product history</Link></div></div>
      {currentDetail.loading ? <div className="panel empty-state compact" role="status">Loading lot history…</div>
        : currentDetail.error ? <div className="notice error" role="alert">{currentDetail.error} Use Refresh to retry.</div>
          : currentDetail.data && <>
            <HistoryTable title="Lot receiving history" subtitle="Receiving records assigned to this material lot only" rows={currentDetail.data.receiving} receiving />
            <HistoryTable title="Lot usage history" subtitle="Usage records assigned to this material lot only" rows={currentDetail.data.usage} />
          </>}
    </section>}
  </>;
}
