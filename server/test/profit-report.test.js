import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { salesReport } from '../src/lib/salesReport.js';

const bill = (id, items, extra = {}) => {
  const subtotal = items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
  return { _id: id, invoiceNo: id, createdAt: '2026-11-10T06:00:00.000Z', items, subtotal, discount: 0, tax: 0, total: subtotal, paymentMethod: 'Cash', ...extra };
};

test('profit = amount after discount (before GST) minus cost of items sold', () => {
  const products = [{ _id: 'p1', costPrice: 600 }, { _id: 'p2' }];
  const bills = [
    // Saved cost wins over the product's current cost (700 here, 600 on the product).
    bill('A', [{ productId: 'p1', quantity: 2, unitPrice: 1000, unitCost: 700 }]),
    // No saved cost: falls back to the product's current cost price (600).
    bill('B', [{ productId: 'p1', quantity: 1, unitPrice: 1000 }], { discount: 100, tax: 45, total: 945 }),
    // Product without a cost, and a manual item: profit unknown.
    bill('C', [{ productId: 'p2', quantity: 1, unitPrice: 500 }]),
    bill('D', [{ name: 'Manual saree', quantity: 1, unitPrice: 650 }]),
    // Cancelled bills never count.
    bill('E', [{ productId: 'p1', quantity: 1, unitPrice: 1000, unitCost: 100 }], { status: 'Cancelled' }),
  ];
  const report = salesReport(bills, {}, products);
  const byId = Object.fromEntries(report.bills.map(b => [b._id, b.profit]));
  const marginById = Object.fromEntries(report.bills.map(b => [b._id, b.profitMargin]));
  assert.equal(byId.A, 600);   // 2000 - 2*700
  assert.equal(byId.B, 300);   // 1000 - 100 discount - 600 cost; GST is not income
  assert.equal(byId.C, null);
  assert.equal(byId.D, null);
  assert.equal(byId.E, null);
  assert.equal(marginById.A, 30);   // 600 / 2000
  assert.equal(marginById.B, 33.3); // 300 / 900 (after discount, before GST)
  assert.equal(marginById.C, null);
  assert.equal(report.summary.profit, 900);
  assert.equal(report.summary.profitBills, 2);
  assert.equal(report.summary.billCount, 4);
  assert.equal(report.summary.profitSales, 2900); // 2000 + 900 for the two costed bills
  assert.equal(report.summary.profitMargin, 31);  // 900 / 2900 = 31.0%
  assert.equal(report.groups[0].profit, 900);
  assert.equal(report.groups[0].profitBills, 2);
  assert.equal(report.groups[0].profitMargin, 31);
});

test('zero cost is a real cost, and no costed bills gives no margin', () => {
  const free = salesReport([bill('F', [{ productId: 'p1', quantity: 1, unitPrice: 400, unitCost: 0 }])]);
  assert.equal(free.bills[0].profit, 400);
  const none = salesReport([bill('G', [{ name: 'Manual', quantity: 1, unitPrice: 100 }])]);
  assert.equal(none.summary.profit, 0);
  assert.equal(none.summary.profitBills, 0);
  assert.equal(none.summary.profitMargin, null);
  // Existing callers that pass no products still work.
  assert.equal(salesReport([]).summary.profitMargin, null);
});

test('a loss is reported as negative profit', () => {
  const report = salesReport([bill('H', [{ productId: 'p1', quantity: 1, unitPrice: 500, unitCost: 650 }])]);
  assert.equal(report.bills[0].profit, -150);
  assert.equal(report.summary.profit, -150);
});

test('saving a bill stores each product cost on its items', async () => {
  globalThis.profitTestStore = {
    products: [
      { _id: 'p1', name: 'Kurta', sku: 'K1', price: 1000, costPrice: 650.5, stock: 5, active: true },
      { _id: 'p2', name: 'Shirt', sku: 'S1', price: 500, stock: 5, active: true },
    ],
    bills: [],
  };
  const stub = `
    export const loadData = async () => globalThis.profitTestStore;
    export const httpError = (status, message) => Object.assign(new Error(message), { status });
    export const transaction = async (fn) => { const d = structuredClone(globalThis.profitTestStore); const r = await fn(d); globalThis.profitTestStore = d; return r; };
  `;
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (specifier === '../db.js' && context.parentURL.endsWith('/routes/bills.js')) return { url: 'data:text/javascript,' + encodeURIComponent(stub), shortCircuit: true };
      return next(specifier, context);
    },
  });
  const express = (await import('express')).default;
  const router = (await import('../src/routes/bills.js')).default;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { role: 'admin' }; next(); });
  app.use('/bills', router);
  app.use((err, req, res, next) => res.status(err.status || 500).json({ message: err.message }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/bills`;
  try {
    const res = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ productId: 'p1', quantity: 2 }, { productId: 'p2', quantity: 1 }], paymentMethod: 'Cash', amountReceived: 2500 }) });
    assert.equal(res.status, 201);
    const items = (await res.json()).bill.items;
    assert.equal(items.find(i => i.productId === 'p1').unitCost, 650.5);
    assert.equal('unitCost' in items.find(i => i.productId === 'p2'), false, 'no cost saved when the product has none');
    // The report treats the bill as unknown because one product has no cost.
    const report = await (await fetch(base)).json();
    assert.equal(report.bills[0].profit, null);
    // Give the second product a cost: profit becomes known using the saved cost for p1.
    globalThis.profitTestStore.products[1].costPrice = 300;
    const after = await (await fetch(base)).json();
    assert.equal(after.bills[0].profit, 2500 - 2 * 650.5 - 300);
  } finally {
    server.close();
    hooks.deregister();
    delete globalThis.profitTestStore;
  }
});
