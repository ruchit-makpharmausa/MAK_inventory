import PageHeading from '../../components/PageHeading.jsx';
import InventoryTable from '../../components/InventoryTable.jsx';
import { quantity } from '../../lib/format.js';

export default function DashboardPage({ products, totals, activeProducts, search, setSearch, typeFilter, setTypeFilter,
  types, onHistory, onExport, exporting = false }) {
  return <>
    <PageHeading eyebrow="OVERVIEW" title="Inventory dashboard"
      subtitle="A clear view of your product stock and recent inventory position."
      action={<button className="button secondary export-button" onClick={onExport} disabled={exporting}>
        ⇩ <span>{exporting ? 'Exporting…' : 'Export Excel'}</span></button>} />
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
