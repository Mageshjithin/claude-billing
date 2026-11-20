const invalid = (message) => Object.assign(new Error(message), { status: 400 });
const cents = (value) => Math.round((Number(value) || 0) * 100);
export const istDate = (value) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Date(date.getTime() + 330 * 60000).toISOString().slice(0, 10) : '';
};
// Taxable value = amount after discount, before GST. Bills with GST included in the rate store it as
// taxableValue; older bills (GST added on top) have it as subtotal - discount.
const taxableCents = (bill) => bill.taxableValue != null ? cents(bill.taxableValue) : cents(bill.subtotal) - cents(bill.discount);
// Profit = amount after discount (before GST) minus the cost of the items sold.
// Only items with a known cost count: inventory items (cost saved on the bill at sale time, else the
// product's current cost price). Manual items have no cost, so a bill mixing both gets a PARTIAL profit:
// the costed items' share of the taxable value (by their line totals, so discount and GST are shared
// fairly) minus their cost. A bill with no costed item has unknown profit (null).
const profitOf = (bill, costById) => {
  const items = bill.items || [];
  let cost = 0, costedLines = 0, allLines = 0, costed = 0;
  for (const item of items) {
    const quantity = Number(item.quantity) || 0;
    const line = item.lineTotal != null ? cents(item.lineTotal) : cents(item.unitPrice) * quantity;
    allLines += line;
    const saved = item.unitCost ?? (item.productId ? costById.get(item.productId) : undefined);
    if (typeof saved !== 'number' || !Number.isFinite(saved)) continue;
    cost += Math.round(saved * 100) * quantity;
    costedLines += line;
    costed += 1;
  }
  if (!costed) return null;
  const taxable = taxableCents(bill);
  const profitSales = costed === items.length || allLines <= 0 ? taxable : Math.round(taxable * costedLines / allLines);
  return { profit: profitSales - cost, profitSales, partial: costed < items.length, uncostedItems: items.length - costed };
};
export function salesReport(bills, query = {}, products = []) {
  const costById = new Map(products.map(p => [p._id, p.costPrice]));
  const mode = String(query.mode || 'all');
  const period = String(query.period || '');
  if (!['all', 'day', 'month', 'year'].includes(mode)) throw invalid('Choose a valid report period.');
  const patterns = { day: /^\d{4}-\d{2}-\d{2}$/, month: /^\d{4}-\d{2}$/, year: /^\d{4}$/ };
  if (mode !== 'all') {
    if (!patterns[mode].test(period)) throw invalid('Enter a valid report date.');
    const day = period + (mode === 'year' ? '-01-01' : mode === 'month' ? '-01' : '');
    const parsed = new Date(day + 'T00:00:00Z');
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) throw invalid('Enter a valid calendar date.');
  }
  const limit = Math.min(Math.max(Math.floor(Number(query.limit) || 30), 1), 100);
  const requestedPage = Math.max(Math.floor(Number(query.page) || 1), 1);
  if (!Number.isFinite(requestedPage)) throw invalid('Invalid page number.');
  const paymentMethod = String(query.paymentMethod || 'all');
  const methods = ['Cash', 'UPI', 'Card', 'Bank transfer'];
  if (!['all', 'Not recorded', ...methods].includes(paymentMethod)) throw invalid('Choose a valid payment method.');
  const methodOf = bill => methods.includes(bill.paymentMethod) ? bill.paymentMethod : 'Not recorded';
  const search = String(query.search || '').trim().toLowerCase().slice(0, 150);
  const matching = bills.filter(b => {
    const date = istDate(b.createdAt);
    return (paymentMethod === 'all' || methodOf(b) === paymentMethod) && (mode === 'all' || date.startsWith(period)) && (!search || [b.invoiceNo, b.customerName, b.customerPhone].some(v => String(v || '').toLowerCase().includes(search)));
  }).sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt) || String(b._id).localeCompare(String(a._id)));
  const groups = new Map();
  const paymentGroups = new Map();
  const summary = { billCount: 0, items: 0, subtotal: 0, discount: 0, taxable: 0, tax: 0, sales: 0, profit: 0, profitSales: 0, profitBills: 0, partialProfitBills: 0 };
  for (const bill of matching) {
    if (bill.status === 'Cancelled') continue; // voided bills stay listed but never count as sales
    const method = methodOf(bill);
    const paymentGroup = paymentGroups.get(method) || { paymentMethod: method, billCount: 0, sales: 0 };
    paymentGroup.billCount += 1;
    paymentGroup.sales += cents(bill.total);
    paymentGroups.set(method, paymentGroup);
    const date = istDate(bill.createdAt);
    const key = mode === 'year' ? date.slice(0,7) : mode === 'all' ? date.slice(0,4) : date;
    const group = groups.get(key) || { period: key || 'Unknown date', billCount: 0, items: 0, subtotal: 0, discount: 0, taxable: 0, tax: 0, sales: 0, profit: 0, profitSales: 0, profitBills: 0, partialProfitBills: 0 };
    const p = profitOf(bill, costById);
    const known = p !== null;
    const values = {profit: known ? p.profit : 0, profitSales: known ? p.profitSales : 0, profitBills: known ? 1 : 0, partialProfitBills: known && p.partial ? 1 : 0, billCount: 1, items: (bill.items || []).reduce((n,item) => n + (Number(item.quantity)||0),0), subtotal:cents(bill.subtotal), discount:cents(bill.discount), taxable:taxableCents(bill), tax:cents(bill.tax), sales:cents(bill.total)};
    for (const [k,v] of Object.entries(values)) {summary[k] += v; group[k] += v;}
    groups.set(key,group);
  }
  const amounts = row => {for (const key of ['subtotal','discount','taxable','tax','sales','profit','profitSales']) row[key] /= 100;return row;};
  const totalPages = Math.max(1,Math.ceil(matching.length / limit));
  const page = Math.min(requestedPage,totalPages);
  const marginOf = (profit, sales) => sales > 0 ? Math.round(profit / sales * 1000) / 10 : null;
  const billsPage = matching.slice((page-1)*limit,page*limit).map(b => {
    const p = b.status === 'Cancelled' ? null : profitOf(b, costById);
    if (p === null) return {...b, profit: null, profitMargin: null, profitPartial: false, uncostedItems: (b.items || []).length};
    return {...b, profit: p.profit / 100, profitMargin: marginOf(p.profit, p.profitSales), profitPartial: p.partial, uncostedItems: p.uncostedItems};
  });
  amounts(summary);
  summary.profitMargin = marginOf(summary.profit, summary.profitSales);
  return {bills:billsPage, page, limit, total:matching.length,totalPages,summary,groups:[...groups.values()].sort((a,b)=>b.period.localeCompare(a.period)).map(row=>{amounts(row);row.profitMargin=marginOf(row.profit,row.profitSales);return row;}),paymentGroups:[...paymentGroups.values()].map(row=>({...row,sales:row.sales/100})).sort((a,b)=>a.paymentMethod.localeCompare(b.paymentMethod)),timeZone:'Asia/Kolkata'};
}
