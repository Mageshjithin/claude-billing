import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// In-memory stand-in for ../db.js so the real product and dashboard routes run without Postgres.
// transaction() applies changes only when fn succeeds, like the real rollback behaviour.
const dbStub = `
  export const loadData = async () => globalThis.costTestStore;
  export const httpError = (status, message) => Object.assign(new Error(message), { status });
  export const transaction = async (fn) => {
    const draft = structuredClone(globalThis.costTestStore);
    const result = await fn(draft);
    globalThis.costTestStore = draft;
    return result;
  };
`;

test('cost price is optional, validated, editable, clearable and totalled on the dashboard', async () => {
  globalThis.costTestStore = { products: [], bills: [] };
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (specifier === '../db.js' && /\/routes\/(products|dashboard)\.js$/.test(context.parentURL)) {
        return { url: 'data:text/javascript,' + encodeURIComponent(dbStub), shortCircuit: true };
      }
      return next(specifier, context);
    },
  });
  const express = (await import('express')).default;
  const products = (await import('../src/routes/products.js')).default;
  const dashboard = (await import('../src/routes/dashboard.js')).default;
  const app = express();
  app.use(express.json());
  app.use('/products', products);
  app.use('/dashboard', dashboard);
  app.use((err, req, res, next) => res.status(err.status || 500).json({ message: err.message }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: res.status, data: await res.json() };
  };
  const item = { name: 'Cotton Kurta', sku: 'K1', price: 1450, stock: 10 };

  try {
    // Without a cost the product still saves, and no cost is stored.
    const plain = await call('POST', '/products', { ...item, costPrice: '' });
    assert.equal(plain.status, 201);
    assert.equal(plain.data.product.costPrice, undefined);

    // A valid cost is saved as a number, including when sent as a string from the form.
    const costed = await call('POST', '/products', { ...item, sku: 'K2', name: 'Linen Shirt', price: 1100, stock: 5, costPrice: '700.50' });
    assert.equal(costed.status, 201);
    assert.equal(costed.data.product.costPrice, 700.5);

    // Zero is a valid cost (e.g. a gifted item); a cost above the selling price is allowed.
    assert.equal((await call('POST', '/products', { ...item, sku: 'K3', costPrice: 0 })).data.product.costPrice, 0);
    assert.equal((await call('POST', '/products', { ...item, sku: 'K4', costPrice: 9999 })).status, 201);

    // Invalid costs are rejected and nothing is saved.
    const before = structuredClone(globalThis.costTestStore);
    for (const costPrice of [-1, 'abc', 1.234, 100000001, true, {}]) {
      const res = await call('POST', '/products', { ...item, sku: 'BAD', costPrice });
      assert.equal(res.status, 400, `costPrice ${JSON.stringify(costPrice)} should be rejected`);
      assert.match(res.data.message, /Cost price/);
    }
    assert.deepEqual(globalThis.costTestStore, before);

    // Editing: set a cost, then clear it with a blank value.
    const id = plain.data.product._id;
    const set = await call('PATCH', `/products/${id}`, { costPrice: '800' });
    assert.equal(set.data.product.costPrice, 800);
    assert.equal(set.data.product.price, 1450);
    const unrelated = await call('PATCH', `/products/${id}`, { stockDelta: -1 });
    assert.equal(unrelated.data.product.costPrice, 800, 'other edits keep the cost');
    const cleared = await call('PATCH', `/products/${id}`, { costPrice: '' });
    assert.equal(cleared.data.product.costPrice, undefined);
    assert.equal((await call('PATCH', `/products/${id}`, { costPrice: -5 })).status, 400);

    // Dashboard totals count only products that have a cost.
    const summary = (await call('GET', '/dashboard/summary')).data.summary;
    // K1 (cleared, stock 9) is excluded; K2 700.5*5 + K3 0*10 + K4 9999*10
    assert.equal(summary.costedProducts, 3);
    assert.equal(summary.inventoryCost, 700.5 * 5 + 9999 * 10);
    assert.equal(summary.productCount, 4);
  } finally {
    server.close();
    hooks.deregister();
    delete globalThis.costTestStore;
  }
});
