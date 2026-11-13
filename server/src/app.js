import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { timingSafeEqual } from 'node:crypto';
import { loadData } from './db.js';
import { salesReport, istDate } from './lib/salesReport.js';
import { buildGstWorkbook, monthToDate, daysInMonth } from './lib/gstExcel.js';
import productsRouter from './routes/products.js';
import billsRouter from './routes/bills.js';
import dashboardRouter from './routes/dashboard.js';

const app = express();
app.set('trust proxy', 1); // Vercel sits behind a proxy; needed for correct client IPs in rate limiting
app.disable('x-powered-by');
app.use(helmet());
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { message: 'Too many login attempts. Try again in 15 minutes.' } });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false, message: { message: 'Too many requests. Slow down and try again.' } });
const origins = (process.env.CLIENT_ORIGIN || 'http://localhost:5180').split(',').map((s) => s.trim());
const isSameOrigin = (req, origin) => {
  try {
    return new URL(origin).host === (req.headers['x-forwarded-host'] || req.headers.host);
  } catch {
    return false;
  }
};
app.use(cors((req, callback) => {
  const origin = req.headers.origin;
  if (!origin || origins.includes('*') || origins.includes(origin) || isSameOrigin(req, origin)) {
    return callback(null, { origin: true });
  }
  return callback(new Error('Origin is not allowed by CORS'));
}));
app.use(express.json({ limit: '100kb' }));
app.use('/api', apiLimiter);
// Authentication uses environment credentials and must not depend on database availability.
// Data routes load the database themselves after authentication.
app.get('/api/health', async (_req, res, next) => {
  try {
    await loadData();
    res.json({ ok: true, service: 'jms-textiles-billing-api' });
  } catch (error) {
    console.error('Database health check failed:', error);
    res.status(503).json({ ok: false, message: 'Database is unavailable. Check the database configuration and API logs.' });
  }
});
app.post('/api/auth/login', loginLimiter, (req, res) => {
  const { username = '', password = '' } = req.body || {};
  const expectedUser = process.env.ADMIN_USERNAME;
  const expectedPass = process.env.ADMIN_PASSWORD;
  const secret = process.env.JWT_SECRET || '';
  const safeEqual = (a, b) => {
    const left = Buffer.from(String(a)); const right = Buffer.from(String(b));
    return left.length === right.length && timingSafeEqual(left, right);
  };
  if (!expectedUser || !expectedPass || secret.length < 32) {
    return res.status(503).json({ message: 'Admin login is not configured. Set ADMIN_USERNAME, ADMIN_PASSWORD and a 32+ character JWT_SECRET.' });
  }
  if (!safeEqual(username, expectedUser) || !safeEqual(password, expectedPass)) {
    return res.status(401).json({ message: 'Username or password is incorrect.' });
  }
  return res.json({ token: jwt.sign({ sub: expectedUser }, secret, { expiresIn: '12h' }) });
});
const reportLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { message: 'Too many report requests. Try again later.' } });
// Read-only GST reports for the scheduled morning notification. Protected by REPORT_TOKEN, not the admin login.
const reportTokenOk = (req) => {
  const expected = process.env.REPORT_TOKEN || '';
  const left = Buffer.from(String(req.query.token || '')); const right = Buffer.from(expected);
  return expected.length >= 24 && left.length === right.length && timingSafeEqual(left, right);
};
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
app.get('/api/reports/daily', reportLimiter, async (req, res, next) => {
  try {
    if (!reportTokenOk(req)) return res.status(401).json({ message: 'Invalid report token.' });
    const yesterday = istDate(Date.now() - 24 * 60 * 60 * 1000);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? String(req.query.date) : yesterday;
    const { bills } = await loadData();
    const report = salesReport(bills.filter((b) => b.status !== 'Cancelled'), { mode: 'day', period: date, limit: 1 });
    const { summary } = report;
    const cgst = round2(summary.tax / 2);
    const month = date.slice(0, 7);
    const isMonthEnd = daysInMonth(month).at(-1) === date;
    res.json({
      date, bills: summary.billCount, items: summary.items, taxable: round2(summary.taxable), discount: summary.discount,
      gst: summary.tax, cgst, sgst: round2(summary.tax - cgst), totalSales: summary.sales, byPaymentMethod: report.paymentGroups || undefined,
      isMonthEnd, monthToDate: { month, ...monthToDate(bills, month, date) },
    });
  } catch (error) { next(error); }
});
// Excel workbook: one row per date for the month + a month-by-month summary. ?month=YYYY-MM (default: month of yesterday).
app.get('/api/reports/gst.xlsx', reportLimiter, async (req, res, next) => {
  try {
    if (!reportTokenOk(req)) return res.status(401).json({ message: 'Invalid report token.' });
    const yesterday = istDate(Date.now() - 24 * 60 * 60 * 1000);
    const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(req.query.month || '')) ? String(req.query.month) : yesterday.slice(0, 7);
    const lastDay = daysInMonth(month).at(-1);
    const upToDate = month === istDate(Date.now()).slice(0, 7) ? istDate(Date.now()) : lastDay;
    const { bills } = await loadData();
    const buffer = await buildGstWorkbook(bills, month, upToDate);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="JMS-GST-${month}.xlsx"`);
    res.send(Buffer.from(buffer));
  } catch (error) { next(error); }
});
app.use('/api', (req, res, next) => {
  if (req.path === '/health' || req.path === '/auth/login') return next();
  const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
  try {
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error('JWT secret is not configured');
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ message: 'Your session has expired. Sign in again.' });
  }
});
app.use('/api/products', productsRouter);
app.use('/api/bills', billsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use((req, res) => res.status(404).json({ message: `Route not found: ${req.method} ${req.path}` }));
app.use((error, _req, res, _next) => {
  if (!error.status || error.status >= 500) console.error(error);
  res.status(error.status || 500).json({ message: error.status ? error.message : 'Server error. Check the API logs.' });
});

export default app;
