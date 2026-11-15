import { Router } from 'express';
import crypto from 'node:crypto';
import { loadData, transaction, httpError } from '../db.js';

// Shop expenses (rent, EB, transport, purchases...), kept apart from sales. Admin only (mounted behind requireAdmin).
const router = Router();

export const EXPENSE_CATEGORIES = ['Rent', 'Electricity (EB)', 'Transport', 'Shop supplies', 'Equipment', 'GST / Tax', 'Salary', 'Other'];
const STATUSES = ['Paid', 'Pending'];
const money = (value) => Math.round(Number(value) * 100) / 100;
const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

function clean(body, existing = {}) {
  const next = { ...existing };
  if ('date' in body || !existing.date) {
    if (!isDate(body.date)) throw httpError(400, 'Enter the expense date (YYYY-MM-DD).');
    next.date = body.date;
  }
  if ('description' in body || !existing.description) {
    const description = String(body.description ?? '').trim();
    if (!description) throw httpError(400, 'Enter what the expense was for.');
    if (description.length > 200) throw httpError(400, 'Description is too long (200 characters max).');
    next.description = description;
  }
  if ('amount' in body || existing.amount == null) {
    const amount = money(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw httpError(400, 'Amount must be more than zero.');
    if (amount > 10000000) throw httpError(400, 'Amount is too large.');
    next.amount = amount;
  }
  if ('category' in body || !existing.category) {
    next.category = EXPENSE_CATEGORIES.includes(body.category) ? body.category : 'Other';
  }
  if ('status' in body || !existing.status) {
    next.status = STATUSES.includes(body.status) ? body.status : 'Paid';
  }
  if ('note' in body) next.note = String(body.note ?? '').trim().slice(0, 300);
  return next;
}

// GET /api/expenses?month=YYYY-MM (or year=YYYY, or nothing for all)
router.get('/', async (req, res, next) => {
  try {
    const { month, year } = req.query;
    const all = (await loadData()).expenses || [];
    const expenses = all
      .filter((e) => (month ? e.date?.startsWith(`${month}-`) : year ? e.date?.startsWith(`${year}-`) : true))
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
    const sum = (list) => money(list.reduce((t, e) => t + (Number(e.amount) || 0), 0));
    const byCategory = EXPENSE_CATEGORIES
      .map((category) => ({ category, total: sum(expenses.filter((e) => e.category === category)), count: expenses.filter((e) => e.category === category).length }))
      .filter((c) => c.count > 0);
    res.json({
      expenses,
      categories: EXPENSE_CATEGORIES,
      summary: { total: sum(expenses), paid: sum(expenses.filter((e) => e.status !== 'Pending')), pending: sum(expenses.filter((e) => e.status === 'Pending')), count: expenses.length },
      byCategory,
    });
  } catch (error) { next(error); }
});

router.post('/', async (req, res, next) => {
  try {
    const expense = await transaction((data) => {
      const now = new Date().toISOString();
      const created = { _id: crypto.randomUUID(), ...clean(req.body), createdAt: now, updatedAt: now };
      data.expenses = [...(data.expenses || []), created];
      return created;
    });
    res.status(201).json({ expense });
  } catch (error) { next(error); }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const expense = await transaction((data) => {
      const list = data.expenses || [];
      const index = list.findIndex((e) => e._id === req.params.id);
      if (index === -1) throw httpError(404, 'Expense not found.');
      list[index] = { ...clean(req.body, list[index]), updatedAt: new Date().toISOString() };
      data.expenses = list;
      return list[index];
    });
    res.json({ expense });
  } catch (error) { next(error); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await transaction((data) => {
      const list = data.expenses || [];
      if (!list.some((e) => e._id === req.params.id)) throw httpError(404, 'Expense not found.');
      data.expenses = list.filter((e) => e._id !== req.params.id);
    });
    res.json({ deleted: true });
  } catch (error) { next(error); }
});

export default router;
