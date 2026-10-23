import { useEffect, useState } from 'react';
import PageHeading from './PageHeading.jsx';
import TransactionFields from './TransactionFields.jsx';
import api from '../lib/api.js';
import { dateLabel, quantity } from '../lib/format.js';
import { sortProducts } from '../lib/product-sort.js';

export default function TransactionPage({ kind, products, types = [], onSaved, initialProductId = '' }) {
  const receiving = kind === 'receiving';
  const initialProduct = products.find((product) => String(product.id) === initialProductId);
  const [productTypeId, setProductTypeId] = useState(() => initialProduct ? String(initialProduct.productTypeId) : '');
  const [productId, setProductId] = useState(() => initialProduct ? String(initialProduct.id) : '');
  const matchingProducts = sortProducts(products.filter((product) => String(product.productTypeId) === productTypeId));
  useEffect(() => {
    setProductTypeId(initialProduct ? String(initialProduct.productTypeId) : '');
    setProductId(initialProduct ? String(initialProduct.id) : '');
  }, [initialProductId, initialProduct?.id, initialProduct?.productTypeId]);
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [formKey, setFormKey] = useState(0);
  useEffect(() => {
    api(`/api/transactions/${kind}`).then(setRows).catch((requestError) => setError(requestError.message));
  }, [kind]);

  const submit = async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const body = Object.fromEntries(form.entries());
    body.productId = Number(body.productId);
    body.quantity = Number(body.quantity);
    setSaving(true);
    setError('');
    try {
      await api(`/api/transactions/${kind}`, { method: 'POST', body: JSON.stringify(body) });
      formElement.reset();
      if (!initialProductId) {
        setProductTypeId('');
        setProductId('');
      }
      setFormKey((key) => key + 1);
      await onSaved(kind);
      setRows(await api(`/api/transactions/${kind}`));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  };

  return <>
    <PageHeading eyebrow={receiving ? 'INVENTORY IN' : 'INVENTORY OUT'} title={receiving ? 'Receive inventory' : 'Record usage'}
      subtitle={receiving ? 'Add received materials to available product inventory.' : 'Record materials consumed by packaging or manufacturing.'} />
    <div className="transaction-layout">
      <section className="panel transaction-form-panel">
        <div className="panel-heading"><div><h2>{receiving ? 'Receiving details' : 'Usage details'}</h2>
          <p>Fields marked <span className="required">*</span> are required.</p></div></div>
        {error && <div className="form-error" role="alert">{error}</div>}
        {!products.length && <div className="form-error" role="alert">Add a product in Product Master before recording transactions.</div>}
        <form key={formKey} onSubmit={submit}>
          <label>Product type <span className="required">*</span>
            <select required value={productTypeId} onChange={(event) => {
              setProductTypeId(event.target.value);
              setProductId('');
            }}>
              <option value="" disabled>Select product type</option>
              {types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
            </select>
          </label>
          <label>Product <span className="required">*</span>
            <select name="productId" required value={productId} onChange={(event) => setProductId(event.target.value)}
              disabled={!productTypeId || !matchingProducts.length}>
              <option value="" disabled>{!productTypeId ? 'Select product type first'
                : !matchingProducts.length ? 'No products in this type' : 'Select product by name or item code'}</option>
              {matchingProducts.map((p) => <option key={p.id} value={p.id}>{p.makItemCode || '—'} · {p.itemCode} — {p.name} ({p.productType}) ({quantity(p.availableBalance)} {p.unit} available)</option>)}
            </select>
          </label>
          <TransactionFields kind={kind} productId={productId} unit={products.find((product) => String(product.id) === productId)?.unit} />
          <button className="button primary submit-button" disabled={saving || !productId}>
            {saving ? 'Saving…' : receiving ? 'Save receiving' : 'Save usage'}
          </button>
        </form>
      </section>
      <section className="panel recent-panel">
        <div className="panel-heading"><div><h2>Recent {receiving ? 'receiving' : 'usage'}</h2>
          <p>Latest inventory transactions.</p></div><span className="count-pill">{rows.length}</span></div>
        {!rows.length ? <div className="empty-state compact"><span>No transactions recorded yet.</span></div>
          : <div className="recent-list">{rows.slice(0, 8).map((row) => <div className="recent-row" key={row.id}>
            <div className={`recent-icon ${receiving ? 'green' : 'amber'}`}>{receiving ? '↓' : '↑'}</div>
            <div className="recent-info"><strong>{row.productName}</strong><span>{row.productType} · {row.itemCode} · {dateLabel(row.date)}</span></div>
            <div className="recent-quantity">{receiving ? '+' : '−'}{quantity(row.quantity)}<small>{row.unit}</small></div>
          </div>)}</div>}
      </section>
    </div>
  </>;
}
