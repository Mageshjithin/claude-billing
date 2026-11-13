import ExcelJS from 'exceljs';
import { istDate } from './salesReport.js';

const METHODS = ['Cash', 'UPI', 'Card', 'Bank transfer'];
const cents = (v) => Math.round((Number(v) || 0) * 100);
const rupees = (c) => c / 100;
const methodOf = (b) => (METHODS.includes(b.paymentMethod) ? b.paymentMethod : 'Not recorded');
const PAY_COLS = [...METHODS, 'Not recorded'];

function emptyRow() {
  return { bills: 0, items: 0, taxable: 0, discount: 0, gst: 0, sales: 0, pay: Object.fromEntries(PAY_COLS.map((m) => [m, 0])) };
}

function add(row, bill) {
  row.bills += 1;
  row.items += (bill.items || []).reduce((n, item) => n + (Number(item.quantity) || 0), 0);
  row.taxable += bill.taxableValue != null ? cents(bill.taxableValue) : cents(bill.subtotal) - cents(bill.discount);
  row.discount += cents(bill.discount);
  row.gst += cents(bill.tax);
  row.sales += cents(bill.total);
  row.pay[methodOf(bill)] += cents(bill.total);
}

export function daysInMonth(month) {
  const [y, m] = month.split('-').map(Number);
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

// Per-day and per-month totals from non-cancelled bills, in IST.
export function aggregate(bills) {
  const days = new Map();
  const months = new Map();
  for (const bill of bills) {
    if (bill.status === 'Cancelled') continue;
    const date = istDate(bill.createdAt);
    if (!date) continue;
    add(days.get(date) || days.set(date, emptyRow()).get(date), bill);
    const month = date.slice(0, 7);
    add(months.get(month) || months.set(month, emptyRow()).get(month), bill);
  }
  return { days, months };
}

export function monthToDate(bills, month, upToDate) {
  const row = emptyRow();
  for (const bill of bills) {
    if (bill.status === 'Cancelled') continue;
    const date = istDate(bill.createdAt);
    if (date && date.startsWith(month) && date <= upToDate) add(row, bill);
  }
  return {
    bills: row.bills, items: row.items, taxable: rupees(row.taxable), discount: rupees(row.discount),
    gst: rupees(row.gst), cgst: rupees(Math.floor(row.gst / 2)), sgst: rupees(row.gst - Math.floor(row.gst / 2)), totalSales: rupees(row.sales),
  };
}

const HEAD_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF5B2145' } };
const TOTAL_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1E4EC' } };
const MONEY = '#,##0.00';

function styleHeader(sheet) {
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = HEAD_FILL;
  header.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  header.height = 30;
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

function columns(first) {
  return [
    first,
    { header: 'Bills', key: 'bills', width: 9 },
    { header: 'Items', key: 'items', width: 9 },
    { header: 'Taxable Value', key: 'taxable', width: 16, style: { numFmt: MONEY } },
    { header: 'Discount', key: 'discount', width: 13, style: { numFmt: MONEY } },
    { header: 'CGST', key: 'cgst', width: 13, style: { numFmt: MONEY } },
    { header: 'SGST', key: 'sgst', width: 13, style: { numFmt: MONEY } },
    { header: 'Total GST', key: 'gst', width: 13, style: { numFmt: MONEY } },
    { header: 'Total Sales (incl. GST)', key: 'sales', width: 20, style: { numFmt: MONEY } },
    ...PAY_COLS.map((m) => ({ header: m, key: `pay_${m}`, width: 14, style: { numFmt: MONEY } })),
  ];
}

function rowValues(label, key, r) {
  const cgst = Math.floor(r.gst / 2);
  const values = {
    [key]: label, bills: r.bills, items: r.items, taxable: rupees(r.taxable), discount: rupees(r.discount),
    cgst: rupees(cgst), sgst: rupees(r.gst - cgst), gst: rupees(r.gst), sales: rupees(r.sales),
  };
  for (const m of PAY_COLS) values[`pay_${m}`] = rupees(r.pay[m]);
  return values;
}

function addTotalRow(sheet, label, firstDataRow, lastDataRow) {
  const total = sheet.addRow({});
  total.getCell(1).value = label;
  for (let c = 2; c <= sheet.columnCount; c += 1) {
    const col = sheet.getColumn(c).letter;
    total.getCell(c).value = { formula: `SUM(${col}${firstDataRow}:${col}${lastDataRow})` };
  }
  total.font = { bold: true };
  total.eachCell((cell) => { cell.fill = TOTAL_FILL; });
  return total;
}

// Workbook: "Daily GST" (one row per date of the month) + "Monthly Summary" (one row per month, all history).
export async function buildGstWorkbook(bills, month, upToDate) {
  const { days, months } = aggregate(bills);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'JMS Textiles';

  const daily = workbook.addWorksheet('Daily GST');
  daily.columns = columns({ header: 'Date', key: 'date', width: 14 });
  styleHeader(daily);
  const dates = daysInMonth(month).filter((d) => d <= upToDate);
  for (const date of dates) daily.addRow(rowValues(date, 'date', days.get(date) || emptyRow()));
  if (dates.length) addTotalRow(daily, `Total ${month}`, 2, dates.length + 1);

  const summary = workbook.addWorksheet('Monthly Summary');
  summary.columns = columns({ header: 'Month', key: 'month', width: 14 });
  styleHeader(summary);
  const keys = [...months.keys()].sort();
  for (const key of keys) summary.addRow(rowValues(key, 'month', months.get(key)));
  if (keys.length) addTotalRow(summary, 'All months', 2, keys.length + 1);

  return workbook.xlsx.writeBuffer();
}
