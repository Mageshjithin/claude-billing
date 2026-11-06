import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { loadData, transaction, httpError } from '../db.js';

const router = Router();
const editable = ['name', 'sku', 'barcode', 'category', 'price', 'stock', 'active'];
const pick = (body,  keys) => Object.fromEntries(Object.entries(body || {}).filter(([key]) => keys.includes(key)));

function clean(p) {
  const product = {
    ...p,
    name: String(p.name ?? '').trim(),
    sku: String(p.sku ?? '').trim().toUpperCase(),
    barcode: String(p.barcode ?? '').trim() || undefined,
    category: String(p.category ?? '').trim() || 'General',
    price: Number(p.price),
    stock: Number(p.stock),
    active: p.active !== false && p.active !== 'false',
  };
  if (!product.name || product.name.length > 120 || !product.sku || !Number.isFinite(product.price) || product.price < 0 || product.price > 100000000 || Math.abs(product.price * 100 - Math.round(product.price * 100)) > 0.00001 || !Number.isInteger(product.stock) || product.stock < 0) {
    throw httpError(400, 'Enter a product name, SKU, valid price and whole-number stock.');
  }
  return product;
}

function assertUnique(products, product) {
  const taken = products.some((p) => p._id !== product._id && (p.sku === product.sku || (product.barcode && p.barcode === product.barcode) || (product.barcode && p.sku === product.barcode.toUpperCase()) || p.barcode?.toUpperCase() === product.sku));
  if (taken) throw httpError(409, 'That SKU or barcode is already in use.');
}

router.get('/', async (req, res, next) => {
  try {
    const search = String(req.query.search || '').trim().toLowerCase();
    const matches = (value) => String(value || '').toLowerCase().includes(search);
    const { products } = await loadData();
    const result = products
      .filter((p) => p.active && (!search || matches(p.name) || matches(p.sku) || matches(p.barcode) || matches(p.category)))
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json({ products: result });
  } catch (error) { next(error); }
});

router.post('/', async (req, res, next) => {
  try {
    const now = new Date().toISOString();
    const product = await transaction((data) => {
      const created = clean({ _id: randomUUID(), ...pick(req.body, editable.filter((k) => k !== 'active')), active: true, createdAt: now, updatedAt: now });
      assertUnique(data.products, created);
      data.products.push(created);
      return created;
    });
    res.status(201).json({ product });
  } catch (error) { next(error); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await transaction((data) => {
      const index = data.products.findIndex((product) => product._id === req.params.id);
      if (index === -1) throw httpError(404, 'Product not found.');
      data.products.splice(index, 1);
    });
    res.json({ message: 'Product deleted.' });
  } catch (error) { next(error); }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const product = await transaction((data) => {
      const index = data.products.findIndex((p) => p._id === req.params.id);
      if (index === -1) throw httpError(404, 'Product not found.');
      if (req.body.expectedUpdatedAt && req.body.expectedUpdatedAt !== data.products[index].updatedAt) {
        throw httpError(409, 'This product changed after you opened it. Cancel, refresh inventory and edit again.');
      }
      const changes = pick(req.body, editable);
      // stockDelta changes stock relative to the value saved on the server, so +/- clicks never overwrite a sale.
      if (req.body.stockDelta !== undefined) {
        const delta = Number(req.body.stockDelta);
        if (!Number.isInteger(delta) || Math.abs(delta) > 1000000) throw httpError(400, 'Stock change must be a whole number.');
        changes.stock = data.products[index].stock + delta;
      }
      const updated = clean({ ...data.products[index], ...changes, updatedAt: new Date().toISOString() });
      assertUnique(data.products, updated);
      data.products[index] = updated;
      return updated;
    });
    res.json({ product });
  } catch (error) { next(error); }
});

export default router;
