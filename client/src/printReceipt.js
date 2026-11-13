// Print only the receipt, on a 3-inch roll with length measured from its content.
const PAPER_WIDTH_MM = 76.2;
const MARGIN_MM = 3;
const receiptCss = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: white; color: black; }
  body { width: 70.2mm; font: 11px/1.35 Arial, sans-serif; }
  .invoice-paper { width: 100%; overflow-wrap: anywhere; }
  .invoice-brand { text-align: center; border-bottom: 1px dashed black; padding-bottom: 6px; }
  .brand-mark { display: none; }
  h2 { font-size: 20px; margin: 0; letter-spacing: 1px; }
  .invoice-brand p { font-size: 10px; margin: 2px 0 0; }
  .gst-line { font-weight: 700; }
  .receipt-title { text-align: center; font-weight: 700; font-size: 13px; letter-spacing: 1px; margin: 6px 0; padding-bottom: 5px; border-bottom: 1px dashed black; }
  .invoice-meta { display: grid; gap: 2px; padding: 0 0 6px; }
  .invoice-meta > div { display: flex; gap: 4px; }
  .invoice-meta span { min-width: 15mm; }
  .invoice-meta b { font-weight: 400; }
  table { width: 100%; table-layout: fixed; border-collapse: collapse; font: inherit; }
  th, td { padding: 3px 1px; vertical-align: top; }
  th { font-size: 9px; text-align: left; border-top: 1px dashed black; border-bottom: 1px dashed black; }
  .invoice-items th:nth-child(1), .invoice-items td:nth-child(1) { width: 9%; }
  .invoice-items th:nth-child(2), .invoice-items td:nth-child(2) { width: 40%; text-align: left; }
  .invoice-items th:nth-child(3), .invoice-items td:nth-child(3) { width: 9%; text-align: right; }
  .invoice-items th:nth-child(4), .invoice-items td:nth-child(4) { width: 18%; text-align: right; }
  .invoice-items th:nth-child(5), .invoice-items td:nth-child(5) { width: 24%; text-align: right; }
  td small { display: block; font-size: 9px; margin-top: 1px; }
  thead { display: table-header-group; }
  tr, .invoice-brand, .invoice-meta, .invoice-totals, .thankyou, .tax-table { break-inside: avoid; }
  .receipt-total { display: flex; justify-content: space-between; font-weight: 700; border-top: 1px dashed black; border-bottom: 1px dashed black; margin-top: 4px; padding: 3px 1px; }
  .invoice-totals { display: grid; gap: 3px; margin-top: 6px; }
  .invoice-totals > div { display: flex; justify-content: space-between; gap: 6px; }
  .invoice-grand { border-top: 1px dashed black; border-bottom: 1px dashed black; padding: 4px 0; font-size: 14px; font-weight: 700; }
  .tax-table { margin-top: 8px; border-top: 1px dashed black; border-bottom: 1px dashed black; font-size: 9px; }
  .tax-table th { border: 0; border-bottom: 1px dashed black; }
  .tax-table th:not(:first-child), .tax-table td:not(:first-child) { text-align: right; }
  .thankyou { text-align: center; font-weight: 700; font-size: 10px; margin: 8px 0 0; }
  .incl-note { text-align: center; font-weight: 700; font-size: 10px; margin: 6px 0 0; }
`;

export async function prepareReceiptPrint(receipt) {
  if (!receipt) throw new Error('Open a saved bill before printing.');
  const frame = document.createElement('iframe');
  frame.title = '3-inch receipt print';
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:76.2mm;height:1px;border:0;';
  document.body.appendChild(frame);
  try {
    const doc = frame.contentDocument;
    doc.title = 'JMS Textiles Receipt';
    const style = doc.createElement('style');
    style.textContent = receiptCss;
    doc.head.appendChild(style);
    doc.body.appendChild(doc.importNode(receipt, true));
    await doc.fonts.ready;
    const heightPx = doc.body.getBoundingClientRect().height;
    // Add a small rounding allowance. Very long receipts paginate at 1 metre.
    const heightMm = Math.min(1000, Math.max(40, Math.ceil(heightPx * 25.4 / 96 + MARGIN_MM * 2 + 2)));
    style.textContent += `\n@page { size: ${PAPER_WIDTH_MM}mm ${heightMm}mm; margin: ${MARGIN_MM}mm; }`;
    return frame;
  } catch (error) {
    frame.remove();
    throw error;
  }
}

export async function printReceipt(receipt) {
  const frame = await prepareReceiptPrint(receipt);
  frame.contentWindow.addEventListener('afterprint', () => frame.remove(), { once: true });
  frame.contentWindow.focus();
  frame.contentWindow.print();
}
