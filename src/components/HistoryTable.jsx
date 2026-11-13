import { dateLabel, quantity } from '../lib/format.js';

export default function HistoryTable({ title, subtitle, rows, receiving = false, isAdmin = false, onEdit, emptyMessage }) {
  return <section className="panel history-panel">
    <div className="panel-heading"><div><h2>{title}</h2><p>{subtitle}</p></div>
      <span className="count-pill">{rows.length} entries</span></div>
    {!rows.length ? <div className="empty-state compact"><span>{emptyMessage || `No ${receiving ? 'receiving' : 'usage'} records for this product.`}</span></div>
      : <div className="table-scroll"><table className={`history-table${receiving ? ' receiving-history-table' : ''}`} aria-label={title}>
        <colgroup>
          <col className="history-date-column" />
          {receiving && <col className="history-location-column" />}
          <col className="history-reference-column" />
          <col className="history-quantity-column" />
          <col className="history-remarks-column" />
          {isAdmin && <col className="history-actions-column" />}
        </colgroup>
        <thead><tr>
          <th scope="col">Date</th>
          {receiving && <th scope="col">Location</th>}
          <th scope="col">{receiving ? 'MAK Release Number' : 'MAK lot number'}</th>
          <th scope="col" className="numeric">{receiving ? 'Received quantity' : 'Used quantity'}</th>
          <th scope="col">Remarks</th>
          {isAdmin && <th scope="col">Actions</th>}
        </tr></thead>
        <tbody>{rows.map((row) => <tr key={row.id}>
          <td>{dateLabel(row.date)}</td>
          {receiving && <td>{row.location || '—'}</td>}
          <td className={`history-reference${receiving ? '' : ' code-cell'}`}>
            {(receiving ? row.makReleaseNumber : row.makLotNumber) || '—'}
            {row.materialLotNumber && <div className="muted-label">Material lot number: {row.materialLotNumber}</div>}
          </td>
          <td className="numeric">{quantity(row.quantity)}</td>
          <td className="history-remarks">{row.remarks || '—'}</td>
          {isAdmin && <td><button type="button" className="button secondary" onClick={() => onEdit(row)}>Edit</button></td>}
        </tr>)}</tbody>
      </table></div>}
  </section>;
}
