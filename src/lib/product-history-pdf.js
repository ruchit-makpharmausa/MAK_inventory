import { downloadBlob } from './download.js';
import { productHistoryEntries, productHistoryFilename, productHistoryHeaders } from './product-history-report.js';

const dateLabel = (date) => `${date.getUTCMonth() + 1}/${date.getUTCDate()}/${String(date.getUTCFullYear()).slice(-2)}`;
const numberLabel = (value) => value == null ? '' : value.toLocaleString('en-US', { maximumFractionDigits: 3 });

export async function createProductHistoryPdf(history) {
  const entries = productHistoryEntries(history);
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: false });
  doc.setProperties({ title: `Inventory History - ${history.product.name || 'Product'}`, creator: 'MAK Inventory' });
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const margin = 12;
  const availableWidth = width - margin * 2;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  const productLines = doc.splitTextToSize(String(history.product.name || 'Selected product'), availableWidth);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const metadata = [
    history.product.itemCode ? `Item Code: ${history.product.itemCode}` : '',
    history.product.makItemCode ? `MAK Item Code: ${history.product.makItemCode}` : '',
    history.product.unit ? `Unit: ${history.product.unit}` : '',
  ].filter(Boolean).join('  |  ');
  const metadataLines = metadata ? doc.splitTextToSize(metadata, availableWidth) : [];
  const metadataY = 24 + productLines.length * 4.5;
  const tableTop = metadataY + metadataLines.length * 4 + 4;
  const headerPages = new Set();
  const drawHeader = () => {
    const page = doc.internal.getCurrentPageInfo().pageNumber;
    if (headerPages.has(page)) return;
    headerPages.add(page);
    doc.setTextColor(16, 43, 78);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text('Inventory History', margin, 15);
    doc.setFontSize(11);
    doc.text(productLines, margin, 23, { lineHeightFactor: 1.15 });
    doc.setTextColor(80, 96, 112);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    if (metadataLines.length) doc.text(metadataLines, margin, metadataY, { lineHeightFactor: 1.2 });
  };
  const tableOptions = {
    theme: 'grid',
    margin: { top: tableTop, left: margin, right: margin, bottom: 14 },
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 2, overflow: 'linebreak', valign: 'middle', lineColor: [220, 227, 234], lineWidth: 0.1 },
    headStyles: { fillColor: [16, 43, 78], textColor: 255, fontStyle: 'bold', halign: 'center' },
    showHead: 'everyPage', rowPageBreak: 'avoid', willDrawPage: drawHeader,
  };
  const keys = ['date', 'description', 'receivedQuantity', 'usedQuantity', 'usedAgainst'];
  autoTable(doc, {
    ...tableOptions, startY: tableTop,
    columns: productHistoryHeaders.map((header, index) => ({ header, dataKey: keys[index] })),
    body: entries.map((entry) => ({
      date: dateLabel(entry.date), description: entry.description,
      receivedQuantity: numberLabel(entry.receivedQuantity), usedQuantity: numberLabel(entry.usedQuantity),
      usedAgainst: entry.usedAgainst, receiving: entry.receiving,
    })),
    columnStyles: {
      date: { cellWidth: 25 }, description: { cellWidth: availableWidth - 135 },
      receivedQuantity: { cellWidth: 30, halign: 'right' }, usedQuantity: { cellWidth: 30, halign: 'right' },
      usedAgainst: { cellWidth: 50 },
    },
    didParseCell: (data) => {
      if (data.section !== 'body') return;
      if (data.row.raw.receiving) data.cell.styles.fontStyle = 'bold';
      else if (['usedQuantity', 'usedAgainst'].includes(data.column.dataKey)) data.cell.styles.textColor = [220, 0, 0];
    },
  });
  if (!entries.length) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(80, 96, 112);
    doc.text('No transactions recorded for this product.', margin, doc.lastAutoTable.finalY + 8);
  }
  const notes = entries.filter((entry) => entry.notes);
  if (notes.length) {
    let notesY = doc.lastAutoTable.finalY + 9;
    if (notesY + 16 > height - 14) { doc.addPage(); drawHeader(); notesY = tableTop + 4; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(16, 43, 78);
    doc.text('Transaction Notes', margin, notesY);
    autoTable(doc, {
      ...tableOptions, startY: notesY + 3,
      head: [['Date', 'Type', 'Notes']],
      body: notes.map((entry) => [dateLabel(entry.date), entry.receiving ? 'Receiving' : 'Usage', entry.notes]),
      columnStyles: { 0: { cellWidth: 25 }, 1: { cellWidth: 25 }, 2: { cellWidth: availableWidth - 50 } },
    });
  }
  const pages = doc.internal.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(110, 125, 140);
    doc.text(`Page ${page} of ${pages}`, width - margin, height - 6, { align: 'right' });
  }
  return doc;
}

export async function exportProductHistoryPdf(history) {
  const doc = await createProductHistoryPdf(history);
  downloadBlob(doc.output('blob'), productHistoryFilename(history.product, 'pdf'));
}
