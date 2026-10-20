import PageHeading from '../../components/PageHeading.jsx';
import InventoryTable from '../../components/InventoryTable.jsx';
import DashboardExportMenu from '../../components/DashboardExportMenu.jsx';
import { quantity } from '../../lib/format.js';
import { inventoryTypeTotals } from '../../lib/inventory-type-totals.js';

export default function DashboardPage({ products, allProducts = products, search, setSearch, typeFilter, setTypeFilter,
  types, onHistory, onExport, exporting = false }) {
  const typeTotals = inventoryTypeTotals(allProducts, types);
  return <>
    <PageHeading eyebrow="OVERVIEW" title="Inventory dashboard"
      subtitle="A clear view of your product stock and recent inventory position."
      action={<DashboardExportMenu types={types} onExport={onExport} exporting={exporting} />} />
    <div className="stat-grid" aria-label="Inventory totals by product type">
      {typeTotals.map((type) => <section className="stat-card" key={type.id} aria-label={`${type.name} inventory totals`}>
        <h2>{type.name}</h2>
        <dl>
          <TypeMetric label="Total received" field="received" units={type.units} />
          <TypeMetric label="Total used" field="used" units={type.units} />
          <TypeMetric label="Current balance" field="balance" units={type.units} />
        </dl>
      </section>)}
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

function TypeMetric({ label, field, units }) {
  return <div className={`type-metric ${field}`}>
    <dt>{label}</dt>
    <dd>{units.length ? units.map((totals) => <span key={totals.unit}>
      {quantity(totals[field])}{totals.unit && <> <small>{totals.unit}</small></>}
    </span>) : <span>0</span>}</dd>
  </div>;
}
