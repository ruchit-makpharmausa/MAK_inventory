import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageHeading from '../../components/PageHeading.jsx';
import HistoryTable from '../../components/HistoryTable.jsx';
import { quantity } from '../../lib/format.js';
import { exportProductHistoryWorkbook } from '../../lib/product-history-workbook.js';
import { exportProductHistoryPdf } from '../../lib/product-history-pdf.js';
import api from '../../lib/api.js';

export default function InventoryHistoryPage({ products }) {
  const [params, setParams] = useSearchParams();
  const selectedProductId = params.get('productId') || '';
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
    <section className="panel history-picker">
      <label>Select product
        <select value={selectedProductId} onChange={(event) => onSelect(event.target.value)}>
          <option value="">Choose a product</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.itemCode} — {p.name}</option>)}
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
          <span className="balance-product">{history.product.itemCode} · {history.product.name}</span></div>
        <HistoryTable title="Receiving history" subtitle="Materials added to inventory"
          rows={history.receiving} receiving />
        <HistoryTable title="Usage history" subtitle="Materials used in production"
          rows={history.usage} />
      </>}
  </>;
}
