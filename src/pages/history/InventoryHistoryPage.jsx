import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageHeading from '../../components/PageHeading.jsx';
import HistoryTable from '../../components/HistoryTable.jsx';
import { quantity } from '../../lib/format.js';
import { productSortOptions, sortProducts } from '../../lib/product-sort.js';
import { exportProductHistoryWorkbook } from '../../lib/product-history-workbook.js';
import { exportProductHistoryPdf } from '../../lib/product-history-pdf.js';
import api from '../../lib/api.js';

export default function InventoryHistoryPage({ products, types = [] }) {
  const [params, setParams] = useSearchParams();
  const typeFilter = params.get('typeId') || '';
  const requestedProductId = params.get('productId') || '';
  const selectedProduct = products.find((product) => String(product.id) === requestedProductId);
  const selectedProductId = typeFilter && selectedProduct && String(selectedProduct.productTypeId) !== typeFilter
    ? '' : requestedProductId;
  const [sortOrder, setSortOrder] = useState('name-asc');
  const matchingProducts = sortProducts(products.filter((product) => !typeFilter || String(product.productTypeId) === typeFilter), sortOrder);
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(null);

  useEffect(() => {
    let active = true;
    setHistory(null);
    setError('');
    setLoading(Boolean(selectedProductId));
    if (selectedProductId) {
      api(`/api/products/${encodeURIComponent(selectedProductId)}/history`)
        .then((data) => { if (active) setHistory(data); })
        .catch((requestError) => { if (active) setError(requestError.message); })
        .finally(() => { if (active) setLoading(false); });
    }
    return () => { active = false; };
  }, [selectedProductId]);

  const onSelect = (id) => {
    const next = new URLSearchParams(params);
    if (id) next.set('productId', id);
    else next.delete('productId');
    setParams(next);
  };

  const onTypeSelect = (typeId) => {
    const next = new URLSearchParams(params);
    if (typeId) next.set('typeId', typeId);
    else next.delete('typeId');
    if (typeId && String(selectedProduct?.productTypeId) !== typeId) {
      next.delete('productId');
      setHistory(null);
      setError('');
      setLoading(false);
    }
    setParams(next);
  };

  const onExport = async (format) => {
    if (!history || exporting) return;
    setExporting(format);
    setError('');
    try {
      if (format === 'pdf') await exportProductHistoryPdf(history);
      else await exportProductHistoryWorkbook(history);
    } catch {
      setError('Unable to export this product’s history. Please try again.');
    } finally {
      setExporting(null);
    }
  };

  return <>
    <PageHeading eyebrow="AUDIT TRAIL" title="Inventory history"
      subtitle="Review all receiving and usage transactions for an individual product."
      action={history && <div className="heading-actions">
        <button className="button secondary" onClick={() => onExport('xlsx')} disabled={Boolean(exporting)}>
          ⇩ {exporting === 'xlsx' ? 'Exporting…' : 'Export Excel'}</button>
        <button className="button secondary" onClick={() => onExport('pdf')} disabled={Boolean(exporting)}>
          ⇩ {exporting === 'pdf' ? 'Exporting…' : 'Export PDF'}</button>
      </div>} />
    <section className="panel history-picker" style={{ display: 'grid', gap: 12 }}>
      <label>Product type
        <select value={typeFilter} onChange={(event) => onTypeSelect(event.target.value)}>
          <option value="">All product types</option>{types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
        </select>
      </label>
      <label>Sort products
        <select aria-label="Sort products" value={sortOrder} onChange={(event) => setSortOrder(event.target.value)}>
          {productSortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      <label>Select product
        <select value={selectedProductId} onChange={(event) => onSelect(event.target.value)}>
          <option value="">Choose a product</option>
          {matchingProducts.map((p) => <option key={p.id} value={p.id}>{p.makItemCode || '—'} · {p.itemCode} — {p.name} ({p.productType})</option>)}
        </select>
      </label>
    </section>
    {error && <div className="notice error" role="alert">{error}</div>}
    {loading ? <div className="panel empty-state" role="status">Loading inventory history…</div>
      : !history ? <div className="panel empty-state"><div className="empty-icon">◷</div>
      <strong>Select a product to view its history</strong><span>Receiving and usage records will appear here.</span></div>
      : <>
        <div className="balance-banner"><div><span>Current available balance</span><strong>
          {quantity(history.product.availableBalance)} <small>{history.product.unit}</small></strong></div>
          <span className="balance-product">{history.product.productType} · {history.product.itemCode} · {history.product.name}</span></div>
        <HistoryTable title="Receiving history" subtitle="Materials added to inventory"
          rows={history.receiving} receiving />
        <HistoryTable title="Usage history" subtitle="Materials used in production"
          rows={history.usage} />
      </>}
  </>;
}
