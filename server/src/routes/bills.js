import { calculatePayment } from '../lib/payment.js';
import { salesReport } from '../lib/salesReport.js';
import { manualItems } from '../lib/manualItems.js';
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { loadData, transaction, httpError } from '../db.js';
import { istDate } from '../lib/salesReport.js';
import { isAdmin, requireAdmin, billWithoutCost } from '../lib/roles.js';

const router = Router();
const money = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

router.get('/', requireAdmin, async (req, res, next) => {
  try {
    const { bills, products } = await loadData();
    res.json(salesReport(bills, req.query, products));
  } catch (error) { next(error); }
});

// Bills are never deleted (GST/accounting records). A bill can be voided instead:
// it is marked Cancelled, kept in history, excluded from sales totals, and stock is restored.
router.post('/:id/void', requireAdmin, async (req, res, next) => {
  try {
    const bill = await transaction((data) => {
      const found = data.bills.find((b) => b._id === req.params.id);
      if (!found) throw httpError(404, 'Bill not found.');
      if (found.status === 'Cancelled') throw httpError(409, 'This bill is already cancelled.');
      const now = new Date().toISOString();
      for (const item of found.items || []) {
        if (!item.productId) continue; // manual items never touched stock
        const product = data.products.find((p) => p._id === item.productId);
        if (product) { product.stock += Number(item.quantity) || 0; product.updatedAt = now; }
      }
      found.status = 'Cancelled';
      found.cancelledAt = now;
      found.cancelReason = String(req.body?.reason || '').trim().slice(0, 200);
      found.updatedAt = now;
      return found;
    });
    res.json({ bill });
  } catch (error) { next(error); }
});

router.post('/', async (req, res, next) => {
  try {
    const billingMode = req.body.billingMode ?? 'inventory';
    if (!['inventory', 'manual'].includes(billingMode)) throw httpError(400, 'Choose a valid billing mode.');
    const requested = Array.isArray(req.body.items) ? req.body.items : [];
    if (!requested.length) return res.status(400).json({ message: 'Add at least one product to the bill.' });

    const enteredItems = billingMode === 'manual' ? manualItems(requested) : [];
    const quantities = new Map();
    for (const item of billingMode === 'manual' ? [] : requested) {
      if (typeof item.productId !== 'string' || !item.productId || !Number.isInteger(Number(item.quantity)) || Number(item.quantity) < 1) {
        return res.status(400).json({ message: 'Each item needs a valid product and whole-number quantity.' });
      }
      quantities.set(item.productId, (quantities.get(item.productId) || 0) + Number(item.quantity));
    }

    // Runs as one transaction: if anything fails, no stock is reduced and no bill is saved.
    const result = await transaction((data) => {
      const now = new Date().toISOString();
      const items = [...enteredItems];
      for (const [productId, quantity] of quantities) {
        const product = data.products.find((p) => p._id === productId && p.active);
        if (!product) throw httpError(400, 'One or more selected products are unavailable.');
        if (product.stock < quantity) throw httpError(409, `Not enough stock for ${product.name}. Refresh stock and try again.`);
        product.stock -= quantity;
        product.updatedAt = now;
        items.push({ productId, name: product.name, sku: product.sku, quantity, unitPrice: product.price, ...(typeof product.costPrice === 'number' ? { unitCost: product.costPrice } : {}), lineTotal: money(product.price * quantity) });
      }

      const subtotal = money(items.reduce((sum, item) => sum + item.lineTotal, 0));
      const discount = money(Number(req.body.discount) || 0);
      const gstPercent = Number(req.body.gstPercent) || 0;
      if (!Number.isFinite(discount) || !Number.isFinite(gstPercent) || discount < 0 || discount > subtotal || gstPercent < 0 || gstPercent > 100) {
        throw httpError(400, 'Discount or GST value is outside the allowed range.');
      }
      // GST is included in the item rates by default (gstInclusive): the customer pays rate x qty - discount,
      // and the GST inside it is shown in the tax table. gstInclusive=false adds GST on top instead.
      const gstInclusive = req.body.gstInclusive !== false && req.body.gstInclusive !== 'false';
      const net = money(subtotal - discount);
      const tax = gstInclusive ? money(net - net / (1 + gstPercent / 100)) : money(net * gstPercent / 100);
      const taxableValue = gstInclusive ? money(net - tax) : net;
      const exactTotal = gstInclusive ? net : money(net + tax);
      // Round off to the nearest rupee by default (892.50 -> 893.00); the cashier can switch it off per bill.
      const roundOffOn = req.body.roundOff !== false && req.body.roundOff !== 'false';
      const total = roundOffOn ? Math.round(exactTotal) : exactTotal;
      const roundOff = money(total - exactTotal);
      let payment;
      try { payment = calculatePayment(total, req.body.paymentMethod, req.body.amountReceived); }
      catch (error) { throw httpError(400, error.message); }
      const prefix = (process.env.INVOICE_PREFIX || 'JMS').replace(/[^A-Za-z0-9-]/g, '').slice(0, 10);
      let invoiceSequence = Number.isSafeInteger(data.invoiceSequence) && data.invoiceSequence >= 0
        ? data.invoiceSequence + 1
        : 1;
      let invoiceNo = `${prefix}-${istDate(now).replaceAll('-', '')}-${invoiceSequence}`;
      while (data.bills.some((existing) => existing.invoiceNo === invoiceNo)) {
        invoiceSequence += 1;
        invoiceNo = `${prefix}-${istDate(now).replaceAll('-', '')}-${invoiceSequence}`;
      }
      data.invoiceSequence = invoiceSequence;
      const bill = {
        _id: randomUUID(),
        invoiceNo,
        billingMode,
        customerName: String(req.body.customerName || 'Walk-in customer').trim().slice(0, 100),
        customerPhone: String(req.body.customerPhone || '').trim().slice(0, 20),
        items,
        subtotal,
        discount,
        gstPercent,
        gstInclusive,
        taxableValue,
        tax,
        roundOff,
        total,
        ...payment,
        createdAt: now,
        updatedAt: now,
      };
      data.bills.push(bill);
      const remainingStock = items.filter(item => item.productId).map(({ productId }) => ({ productId, stock: data.products.find((p) => p._id === productId).stock }));
      return { bill, remainingStock };
    });
    return res.status(201).json(isAdmin(req) ? result : { ...result, bill: billWithoutCost(result.bill) });
  } catch (error) { return next(error); }
});

export default router;

