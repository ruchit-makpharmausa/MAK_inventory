import { useEffect, useRef, useState } from 'react';

export default function ExportDateRangeDialog({ typeName, exporting, onClose, onExport }) {
  const dialogRef = useRef(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  const submit = (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const fromDate = String(form.get('fromDate') || '');
    const toDate = String(form.get('toDate') || '');
    if (fromDate && toDate && fromDate > toDate) {
      setError('The start date must be on or before the end date.');
      return;
    }
    setError('');
    onExport({ fromDate, toDate });
  };

  return <dialog ref={dialogRef} className="modal transaction-dialog" aria-labelledby="export-range-title"
    aria-busy={exporting} onCancel={(event) => { event.preventDefault(); if (!exporting) onClose(); }}>
    <div className="modal-heading"><div><div className="eyebrow">EXCEL EXPORT</div>
      <h2 id="export-range-title">Choose report date range</h2></div>
      <button type="button" className="icon-button" onClick={onClose} disabled={exporting} aria-label="Close dialog">×</button></div>
    <p className="field-help">{typeName}. Dates include the full day. Leave both blank to export all dates.</p>
    {error && <div className="form-error" role="alert">{error}</div>}
    <form onSubmit={submit}>
      <fieldset disabled={exporting}>
        <label>From date
          <input name="fromDate" type="date" />
        </label>
        <label>To date
          <input name="toDate" type="date" />
        </label>
      </fieldset>
      <div className="modal-actions">
        <button type="button" className="button secondary" onClick={onClose} disabled={exporting}>Cancel</button>
        <button className="button primary" disabled={exporting}>
          {exporting ? 'Exporting…' : 'Export Excel'}
        </button>
      </div>
    </form>
  </dialog>;
}
