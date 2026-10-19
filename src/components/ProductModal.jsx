import { productUnits, unitOption } from '../lib/format.js';

export default function ProductModal({ editingProduct, types, onAddType, onSubmit, onClose, busy }) {
  const editingUnit = unitOption(editingProduct.unit);
  return <div className="modal-backdrop" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <section className="modal" aria-labelledby="product-modal-title">
      <div className="modal-heading"><div><div className="eyebrow">PRODUCT MASTER</div>
        <h2 id="product-modal-title">{editingProduct.id ? 'Edit product' : 'Add product'}</h2></div>
        <button className="icon-button" onClick={onClose} aria-label="Close">×</button></div>
      <form onSubmit={onSubmit}>
        <label>Product Type <span className="required">*</span>
          <div className="inline-select"><select required name="productTypeId" defaultValue={editingProduct.productTypeId || ''}>
            <option value="" disabled>Select type</option>
            {types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
          </select><button type="button" className="text-button" onClick={onAddType}>+ Add type</button></div>
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
        <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button>
          <button className="button primary" disabled={busy}>{busy ? 'Saving…' : 'Save product'}</button></div>
      </form>
    </section>
  </div>;
}
