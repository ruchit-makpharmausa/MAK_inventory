import { today } from '../lib/format.js';
import UsageMaterialLotSelect from './UsageMaterialLotSelect.jsx';

export default function TransactionFields({ kind, productId = '', unit = '', values = {} }) {
  const receiving = kind === 'receiving';
  return <>
    <label>{receiving ? 'Receiving' : 'Usage'} date <span className="required">*</span>
      <input name={receiving ? 'receivingDate' : 'usageDate'} type="date" required defaultValue={values.date || today()} />
    </label>
    <label>{receiving ? 'Received quantity' : 'Quantity used'} <span className="required">*</span>
      <input name="quantity" type="number" min="0" step="any" required placeholder="Enter quantity" defaultValue={values.quantity ?? ''} />
    </label>
    {receiving && <label>MAK Release Number <span className="muted-label">(optional)</span>
      <input name="makReleaseNumber" maxLength={255} placeholder="Enter MAK Release Number" defaultValue={values.makReleaseNumber || ''} />
    </label>}
    {receiving ? <label>Material lot number <span className="muted-label">(optional)</span>
      <input name="materialLotNumber" maxLength={255} placeholder="Enter material lot number" defaultValue={values.materialLotNumber || ''} />
    </label> : <UsageMaterialLotSelect key={productId} productId={productId} unit={unit} selectedValue={values.materialLotNumber || ''} />}
    {!receiving && <label>MAK lot number <span className="required">*</span>
      <input name="makLotNumber" required placeholder="e.g. M260001" defaultValue={values.makLotNumber || ''} />
    </label>}
    <label>Remarks <span className="muted-label">(optional)</span>
      <textarea name="remarks" rows="3" placeholder="Add a note if needed" defaultValue={values.remarks || ''} />
    </label>
  </>;
}
