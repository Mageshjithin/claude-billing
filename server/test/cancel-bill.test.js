import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

test('cancelling a bill restores stock and deletes the bill; invoice numbers are not reused', async () => {
  globalThis.cancelStore = { products: [{ _id: 'p1', name: 'Frock', sku: 'F1', price: 500, stock: 5, active: true }], bills: [] };
  const stub = `
    export const loadData = async () => globalThis.cancelStore;
    export const httpError = (status, message) => Object.assign(new Error(message), { status });
    export const transaction = async (fn) => { const d = structuredClone(globalThis.cancelStore); const r = await fn(d); globalThis.cancelStore = d; return r; };
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
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/bills`;
  const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const sale = { items: [{ productId: 'p1', quantity: 2 }], paymentMethod: 'Cash', amountReceived: 1000 };
  try {
    const first = (await (await post('', sale)).json()).bill;
    assert.equal(globalThis.cancelStore.products[0].stock, 3);

    const cancel = await post(`/${first._id}/void`, {});
    assert.equal(cancel.status, 200);
    assert.equal(globalThis.cancelStore.products[0].stock, 5, 'stock restored');
    assert.equal(globalThis.cancelStore.bills.length, 0, 'bill deleted from the database');
    assert.equal((await post(`/${first._id}/void`, {})).status, 404, 'cannot cancel twice');
    assert.equal(globalThis.cancelStore.products[0].stock, 5, 'stock not restored twice');

    const second = (await (await post('', sale)).json()).bill;
    assert.notEqual(second.invoiceNo, first.invoiceNo, 'invoice number of the cancelled bill is not reused');

    // A bill cancelled under the old rule (stock already returned) is deleted without restocking again.
    globalThis.cancelStore.bills.push({ ...second, _id: 'old', invoiceNo: 'OLD-1', status: 'Cancelled' });
    const stockBefore = globalThis.cancelStore.products[0].stock;
    assert.equal((await post('/old/void', {})).status, 200);
    assert.equal(globalThis.cancelStore.products[0].stock, stockBefore);
    assert.equal(globalThis.cancelStore.bills.some((b) => b._id === 'old'), false);
  } finally {
    server.close();
    hooks.deregister();
    delete globalThis.cancelStore;
  }
});
