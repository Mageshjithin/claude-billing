const invalid = (message) => Object.assign(new Error(message), { status: 400 });
const cents = (value) => Math.round((Number(value) || 0) * 100);
export const istDate = (value) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Date(date.getTime() + 330 * 60000).toISOString().slice(0, 10) : '';
};
export function salesReport(bills, query = {}) {
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
  const summary = { billCount: 0, items: 0, subtotal: 0, discount: 0, tax: 0, sales: 0 };
  for (const bill of matching) {
    if (bill.status === 'Cancelled') continue; // voided bills stay listed but never count as sales
    const method = methodOf(bill);
    const paymentGroup = paymentGroups.get(method) || { paymentMethod: method, billCount: 0, sales: 0 };
    paymentGroup.billCount += 1;
    paymentGroup.sales += cents(bill.total);
    paymentGroups.set(method, paymentGroup);
    const date = istDate(bill.createdAt);
    const key = mode === 'year' ? date.slice(0,7) : mode === 'all' ? date.slice(0,4) : date;
    const group = groups.get(key) || { period: key || 'Unknown date', billCount: 0, items: 0, subtotal: 0, discount: 0, tax: 0, sales: 0 };
    const values = {billCount: 1, items: (bill.items || []).reduce((n,item) => n + (Number(item.quantity)||0),0), subtotal:cents(bill.subtotal), discount:cents(bill.discount), tax:cents(bill.tax), sales:cents(bill.total)};
    for (const [k,v] of Object.entries(values)) {summary[k] += v; group[k] += v;}
    groups.set(key,group);
  }
  const amounts = row => {for (const key of ['subtotal','discount','tax','sales']) row[key] /= 100;return row;};
  const totalPages = Math.max(1,Math.ceil(matching.length / limit));
  const page = Math.min(requestedPage,totalPages);
  return {bills:matching.slice((page-1)*limit,page*limit), page, limit, total:matching.length,totalPages,summary:amounts(summary),groups:[...groups.values()].sort((a,b)=>b.period.localeCompare(a.period)).map(amounts),paymentGroups:[...paymentGroups.values()].map(row=>({...row,sales:row.sales/100})).sort((a,b)=>a.paymentMethod.localeCompare(b.paymentMethod)),timeZone:'Asia/Kolkata'};
}
