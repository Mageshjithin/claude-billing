import { Router } from 'express';
import { loadData } from '../db.js';

const router = Router();
router.get('/summary', async (_req, res, next) => {
  try {
    const istNow = new Date(Date.now() + 330 * 60 * 1000);
    const start = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate()) - 330 * 60 * 1000).toISOString();
    const { products, bills } = await loadData();
    const today = bills.filter((b) => b.createdAt >= start && b.status !== 'Cancelled');
    const active = products.filter((p) => p.active);
    const costed = active.filter((p) => p.costPrice !== undefined && p.costPrice !== null && Number.isFinite(Number(p.costPrice)));
    res.json({ summary: {
      todaySales: Math.round(today.reduce((sum, b) => sum + b.total, 0) * 100) / 100,
      todayBills: today.length,
      productCount: active.length,
      lowStock: active.filter((p) => p.stock <= 5).length,
      inventoryUnits: active.reduce((sum, p) => sum + Math.max(0, Number(p.stock) || 0), 0),
      inventoryValue: Math.round(active.reduce((sum, p) => sum + (Number(p.price) || 0) * Math.max(0, Number(p.stock) || 0), 0) * 100) / 100,
      inventoryCost: Math.round(costed.reduce((sum, p) => sum + Number(p.costPrice) * Math.max(0, Number(p.stock) || 0), 0) * 100) / 100,
      costedProducts: costed.length,
      billCount: bills.filter((b) => b.status !== 'Cancelled').length,
    } });
  } catch (error) { next(error); }
});
export default router;
