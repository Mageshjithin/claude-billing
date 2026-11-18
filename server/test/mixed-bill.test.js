import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

test('one bill can mix inventory items (stock goes down) and manual items (stock untouched)', async () => {
  globalThis.mixStore = { products: [{ _id: 'p1', name: 'Rahul (Size 24)', sku: 'KW074-24', price: 780, costPrice: 276, stock: 3, active: true }], bills: [] };
  const stub = `
    export const loadData = async () => globalThis.mixStore;
    export const httpError = (status, message) => Object.assign(new Error(message), { status });
    export const transaction = async (fn) => { const d = structuredClone(globalThis.mixStore); const r = await fn(d); globalThis.mixStore = d; return r; };
  `;
  const hooks = registerHooks({ resolve(s, c, n) { if (s === '../db.js' && c.parentURL.endsWith('/routes/bills.js')) return { url: 'data:text/javascript,' + encodeURIComponent(stub), shortCircuit: true }; return n(s, c); } });
  const express = (await import('express')).default;
  const router = (await import('../src/routes/bills.js')).default;
  const app = express(); app.use(express.json()); app.use((req, _r, next) => { req.user = { role: 'admin' }; next(); }); app.use('/bills', router);
  app.use((err, req, res, next) => res.status(err.status || 500).json({ message: err.message }));
  const server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
  const post = (body) => fetch(`http://127.0.0.1:${server.address().port}/bills`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paymentMethod: 'Cash', amountReceived: 5000, ...body }) });
  try {
    const res = await post({ billingMode: 'mixed', items: [{ productId: 'p1', quantity: 2 }, { name: 'Blouse stitching', quantity: 1, rate: 250 }] });
    assert.equal(res.status, 201);
    const { bill } = await res.json();
    assert.equal(bill.billingMode, 'mixed');
    assert.equal(bill.subtotal, 1810);
    assert.equal(bill.items.length, 2);
    assert.equal(globalThis.mixStore.products[0].stock, 1, 'only the inventory item reduced stock');

    const manualOnly = await (await post({ billingMode: 'mixed', items: [{ name: 'Fall stitching', quantity: 1, rate: 100 }] })).json();
    assert.equal(manualOnly.bill.billingMode, 'manual');
    assert.equal(globalThis.mixStore.products[0].stock, 1);

    const tooMany = await post({ billingMode: 'mixed', items: [{ productId: 'p1', quantity: 2 }, { name: 'X', quantity: 1, rate: 1 }] });
    assert.equal(tooMany.status, 409, 'not enough stock: nothing saved');
    assert.equal(globalThis.mixStore.bills.length, 2);
    assert.equal((await post({ billingMode: 'mixed', items: [{ name: '', quantity: 1, rate: 5 }] })).status, 400);
  } finally { server.close(); hooks.deregister(); delete globalThis.mixStore; }
});
