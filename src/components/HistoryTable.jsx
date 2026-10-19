import { dateLabel, quantity } from '../lib/format.js';

export default function HistoryTable({ title, subtitle, rows, receiving = false }) {
  return <section className="panel history-panel">
    <div className="panel-heading"><div><h2>{title}</h2><p>{subtitle}</p></div>
      <span className="count-pill">{rows.length} entries</span></div>
    {!rows.length ? <div className="empty-state compact"><span>No {receiving ? 'receiving' : 'usage'} records for this product.</span></div>
      : <div className="table-scroll"><table className="history-table" aria-label={title}>
        <colgroup>
          <col className="history-date-column" />
          <col className="history-reference-column" />
          <col className="history-quantity-column" />
          <col className="history-remarks-column" />
        </colgroup>
        <thead><tr>
          <th scope="col">Date</th>
          <th scope="col">{receiving ? 'MAK RN Number' : 'MAK lot number'}</th>
          <th scope="col" className="numeric">{receiving ? 'Received quantity' : 'Used quantity'}</th>
          <th scope="col">Remarks</th>
        </tr></thead>
        <tbody>{rows.map((row) => <tr key={row.id}>
          <td>{dateLabel(row.date)}</td>
          <td className={`history-reference${receiving ? '' : ' code-cell'}`}>
            {(receiving ? row.materialLotNumber : row.makLotNumber) || '—'}
          </td>
          <td className="numeric">{quantity(row.quantity)}</td>
          <td className="history-remarks">{row.remarks || '—'}</td>
        </tr>)}</tbody>
      </table></div>}
  </section>;
}
