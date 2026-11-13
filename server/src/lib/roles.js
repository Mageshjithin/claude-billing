// Roles: 'admin' can do everything; 'user' (staff) can create bills and view inventory at selling price.
export const isAdmin = (req) => req.user?.role === 'admin';

export function requireAdmin(req, res, next) {
  if (isAdmin(req)) return next();
  return res.status(403).json({ message: 'Only the admin can do this.' });
}

// Staff never see cost prices or profit.
export const withoutCost = ({ costPrice, ...product }) => product;
export const billWithoutCost = (bill) => ({ ...bill, items: (bill.items || []).map(({ unitCost, ...item }) => item) });
