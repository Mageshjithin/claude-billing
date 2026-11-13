import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salesReport } from '../src/lib/salesReport.js';
import { monthToDate, daysInMonth, buildGstWorkbook } from '../src/lib/gstExcel.js';

// A GST-inclusive bill: 2 x 1050 = 2100, 5% GST inside it -> taxable 2000, GST 100.
const inclusive = {
  _id: 'I', invoiceNo: 'I', createdAt: '2026-11-10T06:00:00.000Z', paymentMethod: 'Cash',
  items: [{ productId: 'p1', quantity: 2, unitPrice: 1050, unitCost: 600 }],
  subtotal: 2100, discount: 0, gstPercent: 5, gstInclusive: true, taxableValue: 2000, tax: 100, roundOff: 0, total: 2100,
};
// An older bill with GST added on top: 1000 + 5% = 1050, no taxableValue stored.
const onTop = {
  _id: 'O', invoiceNo: 'O', createdAt: '2026-11-11T06:00:00.000Z', paymentMethod: 'UPI',
  items: [{ productId: 'p1', quantity: 1, unitPrice: 1000, unitCost: 600 }],
  subtotal: 1000, discount: 0, gstPercent: 5, tax: 50, total: 1050,
};

test('profit and taxable value exclude GST for both inclusive and older bills', () => {
  const report = salesReport([inclusive, onTop]);
  const byId = Object.fromEntries(report.bills.map(b => [b._id, b]));
  assert.equal(byId.I.profit, 800);          // 2000 taxable - 1200 cost (GST inside the rate is not income)
  assert.equal(byId.I.profitMargin, 40);     // 800 / 2000
  assert.equal(byId.O.profit, 400);          // 1000 - 600
  assert.equal(report.summary.taxable, 3000);
  assert.equal(report.summary.tax, 150);
  assert.equal(report.summary.sales, 3150);
});

test('GST month-to-date totals skip cancelled bills and split CGST/SGST', () => {
  const cancelled = { ...onTop, _id: 'C', status: 'Cancelled' };
  const mtd = monthToDate([inclusive, onTop, cancelled], '2026-11', '2026-11-30');
  assert.equal(mtd.bills, 2);
  assert.equal(mtd.taxable, 3000);
  assert.equal(mtd.gst, 150);
  assert.equal(mtd.cgst + mtd.sgst, 150);
  assert.equal(mtd.totalSales, 3150);
  assert.equal(daysInMonth('2026-02').length, 28);
});

test('GST Excel workbook builds', async () => {
  const buffer = await buildGstWorkbook([inclusive, onTop], '2026-11', '2026-11-13');
  assert.ok(buffer.byteLength > 1000);
});

test('saving a bill: GST included in rate and round off by default, both can be switched off', async () => {
  const { registerHooks } = await import('node:module');
  globalThis.gstTestStore = { products: [{ _id: 'p1', name: 'Frock', sku: 'F1', price: 892.5, stock: 10, active: true }], bills: [] };
  const stub = `
    export const loadData = async () => globalThis.gstTestStore;
    export const httpError = (status, message) => Object.assign(new Error(message), { status });
    export const transaction = async (fn) => { const d = structuredClone(globalThis.gstTestStore); const r = await fn(d); globalThis.gstTestStore = d; return r; };
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
  const save = async (extra) => {
    const res = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ productId: 'p1', quantity: 1 }], gstPercent: 5, paymentMethod: 'Cash', amountReceived: 2000, ...extra }) });
    assert.equal(res.status, 201);
    return (await res.json()).bill;
  };
  try {
    const a = await save({});
    assert.equal(a.gstInclusive, true);
    assert.equal(a.tax, 42.5);            // 892.50 - 892.50 / 1.05
    assert.equal(a.taxableValue, 850);
    assert.equal(a.total, 893);           // rounded up from 892.50
    assert.equal(a.roundOff, 0.5);
    const b = await save({ gstInclusive: false, roundOff: false });
    assert.equal(b.tax, 44.63);           // 5% on top of 892.50
    assert.equal(b.taxableValue, 892.5);
    assert.equal(b.total, 937.13);
    assert.equal(b.roundOff, 0);
  } finally {
    server.close();
    hooks.deregister();
    delete globalThis.gstTestStore;
  }
});
