import { dateLabel, quantity } from '../lib/format.js';

export default function TransferHistoryTable({ rows = [], emptyMessage }) {
  return <section className="panel history-panel">
    <div className="panel-heading"><div><h2>Transfer history</h2><p>Audited transfers into and out of this product.</p></div>
      <span className="count-pill">{rows.length} entries</span></div>
    {!rows.length ? <div className="empty-state compact"><span>{emptyMessage || 'No transfers recorded for this product.'}</span></div>
      : <div className="table-scroll"><table className="history-table transfer-history-table" aria-label="Transfer history">
        <thead><tr><th scope="col">Date</th><th scope="col">Direction</th><th scope="col">Other product</th>
          <th scope="col">Source material lot</th><th scope="col">Destination material lot</th>
          <th scope="col">Destination MAK Item Code</th>
          <th scope="col" className="numeric">Quantity</th><th scope="col">Added by</th></tr></thead>
        <tbody>{rows.map((row) => {
          const outgoing = row.direction === 'out';
          const otherName = outgoing ? row.destinationProductName : row.sourceProductName;
          const otherMakItemCode = outgoing ? row.destinationMakItemCode : row.sourceMakItemCode;
          const otherItemCode = outgoing ? row.destinationItemCode : row.sourceItemCode;
          return <tr key={row.id}>
            <td>{dateLabel(row.date)}</td><td>{outgoing ? 'Out' : 'In'}</td>
            <td>{otherName} · {otherMakItemCode || '—'} ({otherItemCode})</td>
            <td>{row.sourceMaterialLotNumber || 'Unassigned (N/A)'}</td>
            <td>{row.destinationMaterialLotNumber || 'Unassigned (N/A)'}</td>
            <td>{row.destinationMakItemCode || '—'}</td>
            <td className="numeric">{quantity(row.quantity)}</td><td>{row.addedBy || '—'}</td>
          </tr>;
        })}</tbody>
      </table></div>}
  </section>;
}
