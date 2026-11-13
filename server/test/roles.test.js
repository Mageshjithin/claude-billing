import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// Runs the real app (login, auth middleware and routes) against an in-memory stand-in for db.js.
const dbStub = `
  export const loadData = async () => globalThis.roleTestStore;
  export const httpError = (status, message) => Object.assign(new Error(message), { status });
  export const transaction = async (fn) => { const d = structuredClone(globalThis.roleTestStore); const r = await fn(d); globalThis.roleTestStore = d; return r; };
`;

test('admin sees and changes everything; staff user can only bill and view inventory without cost', async () => {
  Object.assign(process.env, {
    ADMIN_USERNAME: 'owner', ADMIN_PASSWORD: 'owner-password-123',
    STAFF_USERNAME: 'counter', STAFF_PASSWORD: 'counter-password-123',
    JWT_SECRET: 'x'.repeat(48), CLIENT_ORIGIN: 'http://localhost:5180',
  });
  globalThis.roleTestStore = {
    products: [{ _id: 'p1', name: 'Frock (Size 20)', sku: 'KW01-20', barcode: 'KW01-20', category: 'Kids', price: 1100, costPrice: 500, stock: 5, active: true }],
    bills: [],
  };
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if ((specifier === '../db.js' || specifier === './db.js') && context.parentURL.includes('/src/')) {
        return { url: 'data:text/javascript,' + encodeURIComponent(dbStub), shortCircuit: true };
      }
      return next(specifier, context);
    },
  });
  const app = (await import('../src/app.js')).default;
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (method, path, token, body) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body && JSON.stringify(body) });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  const login = async (username, password) => (await call('POST', '/auth/login', null, { username, password })).data;
  try {
    const admin = await login('owner', 'owner-password-123');
    const staff = await login('counter', 'counter-password-123');
    assert.equal(admin.role, 'admin');
    assert.equal(staff.role, 'user');
    assert.equal((await call('POST', '/auth/login', null, { username: 'counter', password: 'wrong' })).status, 401);

    // Inventory: both can view; only the admin sees the cost price.
    assert.equal((await call('GET', '/products', admin.token)).data.products[0].costPrice, 500);
    const staffProduct = (await call('GET', '/products', staff.token)).data.products[0];
    assert.equal(staffProduct.price, 1100);
    assert.equal('costPrice' in staffProduct, false);

    // Staff cannot add, edit, adjust stock or delete products.
    assert.equal((await call('POST', '/products', staff.token, { name: 'X', sku: 'X1', price: 1, stock: 1 })).status, 403);
    assert.equal((await call('PATCH', '/products/p1', staff.token, { stockDelta: 1 })).status, 403);
    assert.equal((await call('PATCH', '/products/p1', staff.token, { price: 1 })).status, 403);
    assert.equal((await call('DELETE', '/products/p1', staff.token)).status, 403);

    // Staff can create a bill; the response carries no cost.
    const sale = await call('POST', '/bills', staff.token, { items: [{ productId: 'p1', quantity: 1 }], gstPercent: 5, paymentMethod: 'Cash', amountReceived: 1100 });
    assert.equal(sale.status, 201);
    assert.equal(sale.data.bill.total, 1100);
    assert.equal('unitCost' in sale.data.bill.items[0], false);
    assert.equal(globalThis.roleTestStore.bills[0].items[0].unitCost, 500, 'cost is still saved for admin profit reports');

    // Staff cannot see sales history, reports or the dashboard, or cancel bills.
    assert.equal((await call('GET', '/bills', staff.token)).status, 403);
    assert.equal((await call('GET', '/bills?mode=day', staff.token)).status, 403);
    assert.equal((await call('GET', '/dashboard/summary', staff.token)).status, 403);
    assert.equal((await call('POST', `/bills/${sale.data.bill._id}/void`, staff.token, {})).status, 403);

    // Admin keeps full access.
    assert.equal((await call('GET', '/bills', admin.token)).data.bills.length, 1);
    assert.equal((await call('GET', '/dashboard/summary', admin.token)).status, 200);
    assert.equal((await call('PATCH', '/products/p1', admin.token, { stockDelta: 1 })).status, 200);
  } finally {
    server.close();
    hooks.deregister();
    delete globalThis.roleTestStore;
  }
});
