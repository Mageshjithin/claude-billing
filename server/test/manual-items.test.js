import { test } from 'node:test';
import assert from 'node:assert/strict';
import { manualItems } from '../src/lib/manualItems.js';
import { calculatePayment } from '../src/lib/payment.js';
import { salesReport } from '../src/lib/salesReport.js';

test('manual items keep entered names and rates and calculate precise line totals', () => {
  assert.deepEqual(manualItems([{ name: ' Cotton saree ', quantity: '2', rate: '650.50', productId: 'ignored', lineTotal: 1 }]), [
    { name: 'Cotton saree', quantity: 2, unitPrice: 650.5, lineTotal: 1301 },
  ]);
  assert.equal(manualItems([{ name: 'Gift', quantity: 1, rate: 0 }])[0].lineTotal, 0);
  assert.equal(manualItems([{ name: 'Item', quantity: 3, rate: 0.1 }])[0].lineTotal, 0.3);
});

test('manual items reject incomplete entries and invalid financial values', () => {
  for (const items of [null, [], Array(101).fill({}), [null], [{ name: ' ' }], [{ name: 'x'.repeat(121) }]]) assert.throws(() => manualItems(items), { status: 400 });
  for (const quantity of [null, true, [], '', ' ', 0, -1, 1.5, Infinity, 1000001]) assert.throws(() => manualItems([{ name: 'Item', quantity, rate: 10 }]), { status: 400 });
  for (const rate of [null, false, [], '', ' ', -1, Infinity, 'abc', 10.001, 100000001]) assert.throws(() => manualItems([{ name: 'Item', quantity: 1, rate }]), { status: 400 });
  assert.throws(() => manualItems([{ name: 'Item', quantity: 2, rate: 100000000 }]), { status: 400 });
});

test('manual bills contribute to existing period and payment reports', () => {
  const items = manualItems([{ name: 'Saree', quantity: 2, rate: 650 }, { name: 'Kurti', quantity: 1, rate: 400 }]);
  const bill = { billingMode: 'manual', invoiceNo: 'JMS-test', createdAt: '2026-11-03T10:00:00Z', items, subtotal: 1700, discount: 100, tax: 0, total: 1600, ...calculatePayment(1600, 'Cash', 2000) };
  const report = salesReport([bill], { mode: 'day', period: '2026-11-03', paymentMethod: 'Cash' });
  assert.equal(report.summary.sales, 1600);
  assert.equal(report.summary.items, 3);
  assert.equal(report.bills[0].changeDue, 400);
});
