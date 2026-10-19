import { downloadBlob } from './download.js';
import { productHistoryEntries, productHistoryFilename, productHistoryHeaders } from './product-history-report.js';

const companyDetails = {
  name: 'MAK Pharma USA',
  address: '8 Middlebury Blvd, Randolph, NJ - 07869',
  website: 'makpharmausa.com',
};
const dateLabel = (date) => `${date.getUTCMonth() + 1}/${date.getUTCDate()}/${String(date.getUTCFullYear()).slice(-2)}`;
const numberLabel = (value) => value == null ? '' : value.toLocaleString('en-US', { maximumFractionDigits: 3 });

export async function createProductHistoryPdf(history) {
  const entries = productHistoryEntries(history);
  const closingBalance = entries.reduce((balance, entry) => balance + (entry.receivedQuantity ?? 0) - (entry.usedQuantity ?? 0), 0);
  if (!Number.isFinite(closingBalance)) throw new Error('Closing balance must be a finite number.');
  const closingBalanceLabel = [numberLabel(Number(closingBalance.toFixed(3)) || 0), history.product.unit].filter(Boolean).join(' ');
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: false });
  doc.setProperties({ title: `Inventory History - ${history.product.name || 'Product'}`, author: companyDetails.name, creator: 'MAK Inventory' });
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
    history.product.productType ? `Product Type: ${history.product.productType}` : '',
    history.product.unit ? `Unit: ${history.product.unit}` : '',
  ].filter(Boolean).join('  |  ');
  const metadataLines = metadata ? doc.splitTextToSize(metadata, availableWidth) : [];
  const metadataY = 41 + productLines.length * 4.5;
  const tableTop = metadataY + metadataLines.length * 4 + 4;
  const headerPages = new Set();
  const drawHeader = () => {
    const page = doc.internal.getCurrentPageInfo().pageNumber;
    if (headerPages.has(page)) return;
    headerPages.add(page);
    doc.setTextColor(16, 43, 78);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(17);
    doc.text(companyDetails.name, margin, 16);
    doc.setFontSize(15);
    doc.text('Inventory History', width - margin, 16, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(80, 96, 112);
    doc.text(companyDetails.address, margin, 22);
    doc.text(companyDetails.website, margin, 27);
    doc.setDrawColor(220, 227, 234);
    doc.line(margin, 32, width - margin, 32);
    doc.setTextColor(16, 43, 78);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(productLines, margin, 40, { lineHeightFactor: 1.15 });
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
    footStyles: { fillColor: [235, 247, 239], textColor: [22, 122, 74], fontStyle: 'bold', halign: 'right' },
    showHead: 'everyPage', showFoot: 'lastPage', rowPageBreak: 'avoid', willDrawPage: drawHeader,
  };
  const keys = ['date', 'releaseNumber', 'description', 'receivedQuantity', 'usedQuantity', 'usedAgainst'];
  const headers = ['Date', 'MAK Release Number', ...productHistoryHeaders.slice(1)];
  autoTable(doc, {
    ...tableOptions, startY: tableTop,
    columns: headers.map((header, index) => ({ header, dataKey: keys[index] })),
    body: entries.map((entry) => ({
      date: dateLabel(entry.date), releaseNumber: entry.releaseNumber, description: entry.description,
      receivedQuantity: numberLabel(entry.receivedQuantity), usedQuantity: numberLabel(entry.usedQuantity),
      usedAgainst: entry.usedAgainst, receiving: entry.receiving,
    })),
    foot: [[
      { content: 'Closing balance', colSpan: 4 },
      { content: closingBalanceLabel, colSpan: 2 },
    ]],
    columnStyles: {
      date: { cellWidth: 22 }, releaseNumber: { cellWidth: 40 }, description: { cellWidth: availableWidth - 162 },
      receivedQuantity: { cellWidth: 27, halign: 'right' }, usedQuantity: { cellWidth: 27, halign: 'right' },
      usedAgainst: { cellWidth: 46 },
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
