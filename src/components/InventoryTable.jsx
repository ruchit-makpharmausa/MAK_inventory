import { quantity } from '../lib/format.js';

export default function InventoryTable({ products, onHistory, onEdit, showComments = false }) {
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
