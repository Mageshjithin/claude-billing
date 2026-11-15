import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const dbStub = `
  export const loadData = async () => globalThis.expStore;
  export const httpError = (status, message) => Object.assign(new Error(message), { status });
  export const transaction = async (fn) => { const d = structuredClone(globalThis.expStore); const r = await fn(d); globalThis.expStore = d; return r; };
`;

test('expenses: admin can add, list by month, edit and delete; staff cannot see them; sales are untouched', async () => {
  Object.assign(process.env, {
    ADMIN_USERNAME: 'owner', ADMIN_PASSWORD: 'owner-password-123', STAFF_USERNAME: 'counter', STAFF_PASSWORD: 'counter-password-123',
    JWT_SECRET: 'z'.repeat(48), CLIENT_ORIGIN: 'http://localhost:5180',
  });
  globalThis.expStore = { products: [], bills: [{ _id: 'b1', invoiceNo: 'X', total: 500, items: [] }] };
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if ((specifier === '../db.js' || specifier === './db.js') && context.parentURL.includes('/src/')) return { url: 'data:text/javascript,' + encodeURIComponent(dbStub), shortCircuit: true };
      return next(specifier, context);
    },
  });
  const app = (await import('../src/app.js')).default;
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (method, path, token, body) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body && JSON.stringify(body) });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  const login = async (u, p) => (await call('POST', '/auth/login', null, { username: u, password: p })).data.token;
  try {
    const admin = await login('owner', 'owner-password-123');
    const staff = await login('counter', 'counter-password-123');
    const rent = await call('POST', '/expenses', admin, { date: '2026-11-06', description: 'Rent', category: 'Rent', amount: 25000 });
    assert.equal(rent.status, 201);
    await call('POST', '/expenses', admin, { date: '2026-11-12', description: 'Inverter', category: 'Equipment', amount: 10000, note: 'Balance 10000 to pay' });
    await call('POST', '/expenses', admin, { date: '2026-10-27', description: 'Lock', category: 'Shop supplies', amount: 428 });
    const stock = await call('POST', '/expenses', admin, { date: '2026-09-15', description: 'Saree stock from supplier', category: 'Stock', amount: 50000 });
    assert.equal(stock.data.expense.category, 'Stock');
    assert.ok((await call('GET', '/expenses', admin)).data.categories.includes('Stock'));
    assert.equal((await call('POST', '/expenses', admin, { date: '2026-11-01', description: 'x', amount: 0 })).status, 400);
    assert.equal((await call('POST', '/expenses', admin, { date: 'bad', description: 'x', amount: 5 })).status, 400);

    const nov = (await call('GET', '/expenses?month=2026-11', admin)).data;
    assert.equal(nov.summary.total, 35000);
    assert.equal(nov.expenses.length, 2);
    assert.equal(nov.expenses[0].description, 'Inverter', 'newest first');
    assert.deepEqual(nov.byCategory.map((c) => c.category), ['Rent', 'Equipment']);
    assert.equal((await call('GET', '/expenses', admin)).data.summary.total, 85428);

    const edited = await call('PATCH', `/expenses/${rent.data.expense._id}`, admin, { status: 'Pending' });
    assert.equal(edited.data.expense.status, 'Pending');
    assert.equal(edited.data.expense.amount, 25000);
    assert.equal((await call('GET', '/expenses?month=2026-11', admin)).data.summary.pending, 25000);

    assert.equal((await call('DELETE', `/expenses/${rent.data.expense._id}`, admin)).status, 200);
    assert.equal((await call('GET', '/expenses?month=2026-11', admin)).data.summary.total, 10000);

    assert.equal((await call('GET', '/expenses', staff)).status, 403);
    assert.equal((await call('POST', '/expenses', staff, { date: '2026-11-01', description: 'x', amount: 5 })).status, 403);
    assert.equal(globalThis.expStore.bills.length, 1, 'bills untouched');
  } finally { server.close(); hooks.deregister(); delete globalThis.expStore; }
});
