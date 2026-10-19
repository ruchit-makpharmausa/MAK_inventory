import PageHeading from '../../components/PageHeading.jsx';
import InventoryTable from '../../components/InventoryTable.jsx';

export default function ProductsPage({ products, search, setSearch, types, onAddType, onEdit, onHistory, onExport }) {
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
