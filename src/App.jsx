import { useCallback, useEffect, useMemo, useState } from 'react';

const navItems = [
  ['dashboard', 'Dashboard', '◫'],
  ['products', 'Product Master', '▤'],
  ['receiving', 'Receiving', '↓'],
  ['usage', 'Usage', '↑'],
  ['history', 'Inventory History', '◷'],
];

const today = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
};
const quantity = (value) => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });
const dateLabel = (value) => value ? new Date(`${value}T00:00:00`).toLocaleDateString() : '—';
const productUnits = ['Pcs', 'kgs'];
const unitOption = (value) => {
  const unit = value?.trim().toLowerCase();
  if (unit === 'pcs') return 'Pcs';
  if (unit === 'kg' || unit === 'kgs') return 'kgs';
  return value || '';
};

async function api(url, options) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

function App() {
  const [page, setPage] = useState('dashboard');
  const [products, setProducts] = useState([]);
  const [allProducts, setAllProducts] = useState([]);
  const [types, setTypes] = useState([]);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [history, setHistory] = useState(null);
  const [editingProduct, setEditingProduct] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  const loadProducts = useCallback(async () => {
    const params = new URLSearchParams({ search, typeId: typeFilter });
    const [all, filtered] = await Promise.all([
      api('/api/products'),
      api(`/api/products?${params}`),
    ]);
    setAllProducts(all);
    setProducts(filtered);
  }, [search, typeFilter]);

  const loadBase = useCallback(async () => {
    const productTypes = await api('/api/product-types');
    setTypes(productTypes);
  }, []);

  useEffect(() => {
    loadProducts().catch((error) => setMessage({ kind: 'error', text: error.message }));
  }, [loadProducts]);

  useEffect(() => {
    loadBase().catch((error) => setMessage({ kind: 'error', text: error.message }));
  }, [loadBase]);

  const refresh = useCallback(async () => {
    await Promise.all([loadProducts(), loadBase()]);
  }, [loadBase, loadProducts]);

  const openHistory = (id) => {
    if (!id) {
      setSelectedProductId('');
      setHistory(null);
      setPage('history');
      return;
    }
    setSelectedProductId(String(id));
    setPage('history');
  };

  useEffect(() => {
    if (page !== 'history' || !selectedProductId) return;
    api(`/api/products/${selectedProductId}/history`)
      .then(setHistory)
      .catch((error) => setMessage({ kind: 'error', text: error.message }));
  }, [page, selectedProductId]);

  const onTransactionSaved = async (kind) => {
    setMessage({ kind: 'success', text: `${kind === 'receiving' ? 'Receiving' : 'Usage'} transaction saved.` });
    await refresh();
  };

  const exportCsv = (filename, headers, rows) => {
    const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const csv = [headers, ...rows].map((row) => row.map(escape).join(',')).join('\r\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    link.download = filename;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 0);
  };

  const exportSummary = () => exportCsv(
    'mak-inventory-summary.csv',
    ['Product Type', 'Item Code', 'MAK Item Code', 'Product Name', 'Total Received', 'Total Used', 'Available Balance', 'Unit', 'Comment'],
    allProducts.map((p) => [p.productType, p.itemCode, p.makItemCode, p.name, p.totalReceived, p.totalUsed, p.availableBalance, p.unit, p.comment]),
  );

  const exportHistory = () => {
    if (!history) return;
    exportCsv(
      `inventory-history-${history.product.itemCode}.csv`,
      ['Transaction Type', 'Date', 'Material Lot Number', 'MAK Lot Number', 'Quantity', 'Remarks'],
      [
        ...history.receiving.map((row) => ['Receiving', row.date, row.materialLotNumber, '', row.quantity, row.remarks]),
        ...history.usage.map((row) => ['Usage', row.date, row.materialLotNumber, row.makLotNumber, row.quantity, row.remarks]),
      ],
    );
  };

  const addProductType = async () => {
    const name = window.prompt('Enter the new product type');
    if (!name?.trim()) return;
    try {
      const type = await api('/api/product-types', { method: 'POST', body: JSON.stringify({ name }) });
      setTypes((current) => [...current, type].sort((a, b) => a.name.localeCompare(b.name)));
      setMessage({ kind: 'success', text: `Product type "${type.name}" added.` });
    } catch (error) {
      setMessage({ kind: 'error', text: error.message });
    }
  };

  const saveProduct = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(form.entries());
    body.productTypeId = Number(body.productTypeId);
    const productId = editingProduct?.id;
    setBusy(true);
    try {
      await api(productId ? `/api/products/${productId}` : '/api/products', {
        method: productId ? 'PUT' : 'POST',
        body: JSON.stringify(body),
      });
      setEditingProduct(null);
      setMessage({ kind: 'success', text: 'Product saved.' });
      await refresh();
    } catch (error) {
      setMessage({ kind: 'error', text: error.message });
    } finally {
      setBusy(false);
    }
  };

  const activeProducts = allProducts.length;
  const totals = useMemo(() => allProducts.reduce((sum, product) => ({
    received: sum.received + Number(product.totalReceived),
    used: sum.used + Number(product.totalUsed),
    balance: sum.balance + Number(product.availableBalance),
  }), { received: 0, used: 0, balance: 0 }), [allProducts]);

  const pageTitle = navItems.find(([key]) => key === page)?.[1] || 'Dashboard';
  const editingUnit = unitOption(editingProduct?.unit);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">M</div>
          <div><strong>MAK Pharma</strong><span>Inventory Management</span></div>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {navItems.map(([key, label, icon]) => (
            <button className={`nav-item ${page === key ? 'active' : ''}`} key={key}
              onClick={() => { setPage(key); setMessage(null); }}>
              <span className="nav-icon">{icon}</span>{label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer"><span className="status-dot" /> Inventory system online</div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="mobile-brand">MAK <span>Inventory</span></div>
          <div className="breadcrumb">Workspace <span>/</span> <strong>{pageTitle}</strong></div>
          <div className="company-chip">MAK Pharma USA LLC</div>
        </header>
        <div className="content">
          {message && <div className={`notice ${message.kind}`} role="status">
            <span>{message.text}</span><button aria-label="Dismiss message" onClick={() => setMessage(null)}>×</button>
          </div>}

          {page === 'dashboard' && <Dashboard
            products={products} totals={totals} activeProducts={activeProducts}
            search={search} setSearch={setSearch} typeFilter={typeFilter} setTypeFilter={setTypeFilter}
            types={types} onHistory={openHistory} onExport={exportSummary}
          />}
          {page === 'products' && <ProductMaster products={allProducts} search={search} setSearch={setSearch} types={types}
            onAddType={addProductType} onEdit={(product) => setEditingProduct(product)}
            onHistory={openHistory} onExport={exportSummary} />}
          {page === 'receiving' && <TransactionPage kind="receiving" products={allProducts}
            onSaved={onTransactionSaved} />}
          {page === 'usage' && <TransactionPage kind="usage" products={allProducts}
            onSaved={onTransactionSaved} />}
          {page === 'history' && <HistoryPage history={history} products={allProducts}
            selectedProductId={selectedProductId} onSelect={openHistory} onExport={exportHistory} />}
        </div>
      </main>

      {editingProduct && <div className="modal-backdrop" onMouseDown={(event) => {
        if (event.target === event.currentTarget) setEditingProduct(null);
      }}>
        <section className="modal" aria-labelledby="product-modal-title">
          <div className="modal-heading"><div><div className="eyebrow">PRODUCT MASTER</div>
            <h2 id="product-modal-title">{editingProduct.id ? 'Edit product' : 'Add product'}</h2></div>
            <button className="icon-button" onClick={() => setEditingProduct(null)} aria-label="Close">×</button></div>
          <form onSubmit={saveProduct}>
            <label>Product Type <span className="required">*</span>
              <div className="inline-select"><select required name="productTypeId" defaultValue={editingProduct.productTypeId || ''}>
                <option value="" disabled>Select type</option>
                {types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
              </select><button type="button" className="text-button" onClick={addProductType}>+ Add type</button></div>
            </label>
            <label>Product Name <span className="required">*</span>
              <input name="name" required defaultValue={editingProduct.name || ''} placeholder="e.g. Bottle Label" />
            </label>
            <div className="form-grid">
              <label>Item Code <span className="required">*</span>
                <input name="itemCode" required defaultValue={editingProduct.itemCode || ''} placeholder="e.g. LB-001" />
              </label>
              <label>MAK Item Code
                <input name="makItemCode" defaultValue={editingProduct.makItemCode || ''} placeholder="e.g. MAK-LB-001" />
              </label>
            </div>
            <label>Unit of Measure <span className="required">*</span>
              <select name="unit" required defaultValue={editingUnit}>
                <option value="" disabled>Select unit</option>
                {editingUnit && !productUnits.includes(editingUnit) && <option value={editingUnit}>{editingUnit}</option>}
                {productUnits.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
              </select>
            </label>
            <label>Comment
              <textarea name="comment" rows={3} defaultValue={editingProduct.comment || ''} placeholder="Add a comment about this product" />
            </label>
            <div className="modal-actions"><button type="button" className="button secondary"
              onClick={() => setEditingProduct(null)}>Cancel</button>
              <button className="button primary" disabled={busy}>{busy ? 'Saving…' : 'Save product'}</button></div>
          </form>
        </section>
      </div>}
    </div>
  );
}

function PageHeading({ eyebrow, title, subtitle, action }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div>
    <h1>{title}</h1><p>{subtitle}</p></div>{action}</div>;
}

function Dashboard({ products, totals, activeProducts, search, setSearch, typeFilter, setTypeFilter,
  types, onHistory, onExport }) {
  return <>
    <PageHeading eyebrow="OVERVIEW" title="Inventory dashboard"
      subtitle="A clear view of your product stock and recent inventory position."
      action={<button className="button secondary export-button" onClick={onExport}>⇩ <span>Export CSV</span></button>} />
    <div className="stat-grid">
      <StatCard label="Active products" value={quantity(activeProducts)} icon="▤" tone="blue" />
      <StatCard label="Total received" value={quantity(totals.received)} icon="↓" tone="green" />
      <StatCard label="Total used" value={quantity(totals.used)} icon="↑" tone="amber" />
      <StatCard label="Current balance" value={quantity(totals.balance)} icon="◉" tone="navy" />
    </div>
    <section className="panel">
      <div className="panel-heading"><div><h2>Inventory summary</h2>
        <p>Current stock calculated from all receiving and usage transactions.</p></div>
        <span className="count-pill">{products.length} products</span></div>
      <div className="table-toolbar">
        <div className="search-box"><span>⌕</span><input aria-label="Search inventory" placeholder="Search name, item code or MAK item code"
          value={search} onChange={(event) => setSearch(event.target.value)} /></div>
        <select className="filter-select" aria-label="Filter by product type" value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value)}>
          <option value="">All product types</option>{types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
        </select>
      </div>
      <InventoryTable products={products} onHistory={onHistory} />
    </section>
  </>;
}

function StatCard({ label, value, icon, tone }) {
  return <div className="stat-card"><div className={`stat-icon ${tone}`}>{icon}</div>
    <div className="stat-label">{label}</div><div className="stat-value">{value}</div></div>;
}

function InventoryTable({ products, onHistory, onEdit, showComments = false }) {
  if (!products.length) return <div className="empty-state"><div className="empty-icon">▤</div>
    <strong>No products found</strong><span>Add a product or adjust your search filters.</span></div>;
  return <div className="table-scroll"><table><thead><tr>
    <th>Product type</th><th>Item code</th><th>MAK item code</th><th>Product name</th><th className="numeric">Total received</th>
    <th className="numeric">Total used</th><th className="numeric">Available balance</th><th>Unit</th>
    {showComments && <th>Comment</th>}<th />
  </tr></thead><tbody>{products.map((p) => <tr key={p.id}>
    <td><span className="type-badge">{p.productType}</span></td><td className="code-cell">{p.itemCode}</td>
    <td className="code-cell">{p.makItemCode || '—'}</td>
    <td className="product-cell">{p.name}</td><td className="numeric">{quantity(p.totalReceived)}</td>
    <td className="numeric">{quantity(p.totalUsed)}</td>
    <td className={`numeric balance-cell ${p.availableBalance <= 0 ? 'zero' : ''}`}>{quantity(p.availableBalance)}</td>
    <td className="unit-cell">{p.unit}</td>
    {showComments && <td className="comment-cell">{p.comment || '—'}</td>}
    <td className="row-action">
      {onEdit && <button className="link-button" onClick={() => onEdit(p)}>Edit</button>}
      {onHistory && <button className="link-button" onClick={() => onHistory(p.id)}>History</button>}
    </td>
  </tr>)}</tbody></table></div>;
}

function ProductMaster({ products, search, setSearch, types, onAddType, onEdit, onHistory, onExport }) {
  const matchingProducts = products.filter((product) => {
    const query = search.trim().toLocaleLowerCase();
    return !query || product.name.toLocaleLowerCase().includes(query)
      || product.itemCode.toLocaleLowerCase().includes(query)
      || (product.makItemCode || '').toLocaleLowerCase().includes(query);
  });
  return <>
    <PageHeading eyebrow="CATALOG" title="Product Master" subtitle="Manage the materials and packaging products you track."
      action={<div className="heading-actions"><button className="button secondary" onClick={onExport}>⇩ Export CSV</button>
        <button className="button primary" onClick={() => onEdit({})}>＋ Add product</button></div>} />
    <section className="panel">
      <div className="panel-heading"><div><h2>Products</h2>
        <p>{types.length} product types available for your catalog.</p></div>
        <button className="text-button" onClick={onAddType}>＋ Add product type</button></div>
      <div className="table-toolbar">
        <div className="search-box"><span>⌕</span><input aria-label="Search products"
          placeholder="Search name, item code or MAK item code" value={search}
          onChange={(event) => setSearch(event.target.value)} /></div>
      </div>
      <InventoryTable products={matchingProducts} onHistory={onHistory} onEdit={onEdit} showComments />
    </section>
  </>;
}

function TransactionPage({ kind, products, onSaved }) {
  const receiving = kind === 'receiving';
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
          <label>Product <span className="required">*</span>
            <select name="productId" required defaultValue="">
              <option value="" disabled>Select product by name or item code</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.itemCode} — {p.name} ({quantity(p.availableBalance)} {p.unit} available)</option>)}
            </select>
          </label>
          <label>{receiving ? 'Receiving' : 'Usage'} date <span className="required">*</span>
            <input name={receiving ? 'receivingDate' : 'usageDate'} type="date" required defaultValue={today()} />
          </label>
          <label>{receiving ? 'Received quantity' : 'Quantity used'} <span className="required">*</span>
            <input name="quantity" type="number" min="0" step="any" required placeholder="Enter quantity" />
          </label>
          <label>Material lot number
            <span className="muted-label">{receiving ? ' (optional)' : ' (required when product inventory is lot-tracked)'}</span>
            <input name="materialLotNumber" placeholder="Enter material lot number" />
          </label>
          {!receiving && <label>MAK lot number <span className="required">*</span>
            <input name="makLotNumber" required placeholder="e.g. M260001" />
          </label>}
          <label>Remarks <span className="muted-label">(optional)</span>
            <textarea name="remarks" rows="3" placeholder="Add a note if needed" />
          </label>
          <button className="button primary submit-button" disabled={saving || !products.length}>
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
            <div className="recent-info"><strong>{row.productName}</strong><span>{row.itemCode} · {dateLabel(row.date)}</span></div>
            <div className="recent-quantity">{receiving ? '+' : '−'}{quantity(row.quantity)}<small>{row.unit}</small></div>
          </div>)}</div>}
      </section>
    </div>
  </>;
}

function HistoryPage({ history, products, selectedProductId, onSelect, onExport }) {
  return <>
    <PageHeading eyebrow="AUDIT TRAIL" title="Inventory history"
      subtitle="Review all receiving and usage transactions for an individual product."
      action={history && <button className="button secondary" onClick={onExport}>⇩ Export CSV</button>} />
    <section className="panel history-picker">
      <label>Select product
        <select value={selectedProductId} onChange={(event) => onSelect(event.target.value)}>
          <option value="">Choose a product</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.itemCode} — {p.name}</option>)}
        </select>
      </label>
    </section>
    {!history ? <div className="panel empty-state"><div className="empty-icon">◷</div>
      <strong>Select a product to view its history</strong><span>Receiving and usage records will appear here.</span></div>
      : <>
        <div className="balance-banner"><div><span>Current available balance</span><strong>
          {quantity(history.product.availableBalance)} <small>{history.product.unit}</small></strong></div>
          <span className="balance-product">{history.product.itemCode} · {history.product.name}</span></div>
        <HistoryTable title="Receiving history" subtitle="Materials added to inventory"
          headers={['Date', 'Material lot number', 'Received quantity', 'Remarks']}
          rows={history.receiving} receiving />
        <HistoryTable title="Usage history" subtitle="Materials used in production"
          headers={['Date', 'Material lot number', 'MAK lot number', 'Used quantity', 'Remarks']}
          rows={history.usage} />
      </>}
  </>;
}

function HistoryTable({ title, subtitle, headers, rows, receiving }) {
  return <section className="panel history-panel">
    <div className="panel-heading"><div><h2>{title}</h2><p>{subtitle}</p></div>
      <span className="count-pill">{rows.length} entries</span></div>
    {!rows.length ? <div className="empty-state compact"><span>No {receiving ? 'receiving' : 'usage'} records for this product.</span></div>
      : <div className="table-scroll"><table><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
        <tbody>{rows.map((row) => <tr key={row.id}><td>{dateLabel(row.date)}</td>
          <td>{row.materialLotNumber || '—'}</td>
          {!receiving && <td className="code-cell">{row.makLotNumber}</td>}
          <td className="numeric">{quantity(row.quantity)}</td><td>{row.remarks || '—'}</td>
        </tr>)}</tbody></table></div>}
  </section>;
}

export default App;
