import { useEffect, useRef, useState } from 'react';

export default function DashboardExportMenu({ types, onExport, exporting }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const toggleRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    rootRef.current.querySelector('.dashboard-export-options button')?.focus();
    const outside = (event) => {
      if (!rootRef.current.contains(event.target)) setOpen(false);
    };
    const escape = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        toggleRef.current.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const choose = (typeId) => {
    setOpen(false);
    toggleRef.current?.focus();
    onExport(typeId);
  };

  return <div className="dashboard-export-menu" ref={rootRef}>
    <button ref={toggleRef} className="button secondary export-button" type="button" disabled={exporting}
      aria-expanded={open && !exporting} aria-controls="dashboard-export-options" onClick={() => setOpen((value) => !value)}>
      ⇩ <span>{exporting ? 'Exporting…' : 'Export Excel'}</span><span aria-hidden="true">▾</span>
    </button>
    {open && !exporting && <div id="dashboard-export-options" className="dashboard-export-options" role="group" aria-label="Excel export options">
      <button type="button" onClick={() => choose('')}>All product types <small>Lot-wise received, used &amp; balance</small></button>
      <p>Product-wise history by type</p>
      {types.map((type) => <button type="button" key={type.id} onClick={() => choose(String(type.id))}>{type.name}</button>)}
      {!types.length && <p>No product types available.</p>}
    </div>}
  </div>;
}
