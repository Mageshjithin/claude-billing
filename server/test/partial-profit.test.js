import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salesReport } from '../src/lib/salesReport.js';

const base = { createdAt: '2026-11-19T12:26:00.000Z', paymentMethod: 'UPI', gstPercent: 5, gstInclusive: true, roundOff: 0 };
// The real bill JMS-20261119-12: Inshirt (manual) 260 + Maxi L (inventory, cost 610) 880 = 1140, GST included.
const mixed = { ...base, _id: 'M', invoiceNo: 'JMS-20261119-12', subtotal: 1140, discount: 0, taxableValue: 1085.71, tax: 54.29, total: 1140,
  items: [{ name: 'inshirt', quantity: 1, unitPrice: 260, lineTotal: 260 }, { productId: 'mx', name: 'Maxi (Size L)', quantity: 1, unitPrice: 880, unitCost: 610, lineTotal: 880 }] };
const manualOnly = { ...base, _id: 'N', invoiceNo: 'N', subtotal: 300, discount: 0, taxableValue: 285.71, tax: 14.29, total: 300,
  items: [{ name: 'Bangles', quantity: 1, unitPrice: 300, lineTotal: 300 }] };
const inventoryOnly = { ...base, _id: 'I', invoiceNo: 'I', subtotal: 1050, discount: 0, taxableValue: 1000, tax: 50, total: 1050,
  items: [{ productId: 'p', name: 'Festival', quantity: 1, unitPrice: 1050, unitCost: 592, lineTotal: 1050 }] };

test('mixed bill: profit counts inventory items only, on their share of the taxable value', () => {
  const report = salesReport([mixed, manualOnly, inventoryOnly]);
  const byId = Object.fromEntries(report.bills.map((b) => [b._id, b]));
  // Maxi share of taxable: 1085.71 * 880 / 1140 = 838.09 -> profit 838.09 - 610 = 228.09
  assert.equal(byId.M.profit, 228.09);
  assert.equal(byId.M.profitPartial, true);
  assert.equal(byId.M.uncostedItems, 1);
  assert.equal(byId.M.profitMargin, 27.2); // 228.09 / 838.09
  assert.equal(byId.N.profit, null, 'manual-only bill has no profit');
  assert.equal(byId.I.profit, 408);
  assert.equal(byId.I.profitPartial, false);
  assert.equal(report.summary.profit, 636.09);
  assert.equal(report.summary.profitBills, 2);
  assert.equal(report.summary.partialProfitBills, 1);
  assert.equal(report.summary.profitSales, 1838.09);
  assert.equal(report.summary.sales, 2490, 'sales still include manual items');
});

test('a discount is shared across items by their amounts', () => {
  const discounted = { ...mixed, _id: 'D', discount: 114, taxableValue: 977.14, tax: 48.86, total: 1026 };
  const [b] = salesReport([discounted]).bills;
  // 977.14 * 880 / 1140 = 754.28 -> 754.28 - 610 = 144.28
  assert.equal(b.profit, 144.28);
});
