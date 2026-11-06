// Print only the receipt, on a 3-inch roll with length measured from its content.
const PAPER_WIDTH_MM = 76.2;
const MARGIN_MM = 3;
const receiptCss = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: white; color: black; }
  body { width: 70.2mm; font: 11px/1.35 Arial, sans-serif; }
  .invoice-paper { width: 100%; overflow-wrap: anywhere; }
  .invoice-brand { text-align: center; border-bottom: 1px dashed black; padding-bottom: 8px; }
  .brand-mark { display: none; }
  h2 { font-size: 18px; margin: 0; }
  .invoice-brand p { font-size: 10px; margin: 3px 0 0; }
  .invoice-meta { display: grid; gap: 5px; padding: 8px 0; }
  .invoice-meta > div { display: grid; gap: 1px; }
  .invoice-meta small { font-size: 9px; }
  table { width: 100%; table-layout: fixed; border-collapse: collapse; font: inherit; }
  th, td { padding: 5px 2px; vertical-align: top; border-bottom: 1px dashed #777; }
  th { font-size: 9px; }
  th:first-child, td:first-child { width: 40%; text-align: left; }
  th:nth-child(2), td:nth-child(2) { width: 10%; text-align: right; }
  th:nth-child(3), td:nth-child(3) { width: 23%; text-align: right; }
  th:nth-child(4), td:nth-child(4) { width: 27%; text-align: right; }
  td small { display: block; font-size: 9px; margin-top: 2px; }
  thead { display: table-header-group; }
  tr, .invoice-brand, .invoice-meta, .invoice-totals, .thankyou { break-inside: avoid; }
  .invoice-totals { display: grid; gap: 5px; margin-top: 8px; }
  .invoice-totals > div { display: flex; justify-content: space-between; gap: 6px; }
  .invoice-grand { border-top: 1px dashed black; padding-top: 6px; font-size: 13px; }
  .thankyou { text-align: center; font-size: 10px; margin: 10px 0 0; }
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
