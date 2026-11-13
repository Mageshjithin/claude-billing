import { paymentStatus } from './PaymentDetails.jsx';
import SalesExplorer from './SalesExplorer.jsx';
import ManualItems from './ManualItems.jsx';
import './manual-billing.css';
import { printReceipt } from './printReceipt.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowDownToLine, Ban, BarChart3, Camera, Check, ChevronDown, CircleDollarSign,
  Clock3, FilePlus2, LayoutDashboard, LoaderCircle, Minus, Package, Plus, Printer, Pencil,
  QrCode, ReceiptText, Search, Shirt, ShoppingBag, Trash2, Wallet,
} from 'lucide-react';

const API = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
const money = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(n || 0));
const dateTime = (value) => new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });

async function request(path, options) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(localStorage.getItem('jms_session') ? { Authorization: `Bearer ${localStorage.getItem('jms_session')}` } : {}), ...(options?.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(data.message || `Request failed (${response.status})`); error.status = response.status; throw error; }
  return data;
}

// Reads the role from the session token. Only decides what to show; the server enforces access.
function sessionRole() {
  try {
    const payload = JSON.parse(atob(localStorage.getItem('jms_session').split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.role === 'user' ? 'user' : 'admin';
  } catch { return 'admin'; }
}
const ADMIN_PAGES = ['Overview', 'New bill', 'Billing option', 'Inventory', 'Sales'];
const USER_PAGES = ['New bill', 'Billing option', 'Inventory'];

function App() {
  const [loggedIn, setLoggedIn] = useState(Boolean(localStorage.getItem('jms_session')));
  const [role, setRole] = useState(() => localStorage.getItem('jms_session') ? sessionRole() : 'admin');
  const isAdmin = role === 'admin';
  const [page, setPage] = useState(() => localStorage.getItem('jms_session') && sessionRole() === 'user' ? 'New bill' : 'Overview');
  const [summary, setSummary] = useState(null);
  const [products, setProducts] = useState([]);
  const [bills, setBills] = useState([]);
  const [cart, setCart] = useState([]);
  const [manualCart, setManualCart] = useState([{ name: '', quantity: '1', rate: '' }]);
  const isManual = page === 'Billing option';
  const billItems = isManual ? manualCart : cart;
  const [search, setSearch] = useState('');
  const [barcode, setBarcode] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [discount, setDiscount] = useState('0');
  const [gstPercent, setGstPercent] = useState('5');
  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [amountReceived, setAmountReceived] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [lastBill, setLastBill] = useState(null);
  const [showProductForm, setShowProductForm] = useState(false);
  const [showCameraScanner, setShowCameraScanner] = useState(false);
  const barcodeRef = useRef(null);
  const [inventorySearch, setInventorySearch] = useState('');
  const [editingProduct, setEditingProduct] = useState(null);
  const inventoryProducts = products.filter(p => [p.name, p.sku, p.barcode, p.category].some(v => String(v || '').toLowerCase().includes(inventorySearch.trim().toLowerCase())));
  const [roundOff, setRoundOff] = useState(true);
  const [gstInclusive, setGstInclusive] = useState(true);
  const [productForm, setProductForm] = useState({ name: '', sku: '', barcode: '', category: 'Saree', price: '', costPrice: '', stock: '' });

  const load = useCallback(async () => {
    try {
      if (sessionRole() !== 'admin') {
        const p = await request('/products');
        setProducts(p.products || []); setBills([]); setSummary(null); setError('');
        return;
      }
      const [p, b, d] = await Promise.all([request('/products'), request('/bills?limit=50'), request('/dashboard/summary')]);
      setProducts(p.products || []); setBills(b.bills || []); setSummary(d.summary || {}); setError('');
    } catch (e) { setError(e.message); if (e.status === 401) { localStorage.removeItem('jms_session'); setLoggedIn(false); } }
  }, []);
  useEffect(() => { if (loggedIn) load(); }, [load, loggedIn]);
  // Staff never stay on an admin-only page (e.g. after switching accounts).
  useEffect(() => { if (!(isAdmin ? ADMIN_PAGES : USER_PAGES).includes(page)) setPage(isAdmin ? 'Overview' : 'New bill'); }, [isAdmin, page]);

  const subtotal = useMemo(() => isManual
    ? manualCart.reduce((sum, row) => sum + Math.round((Number(row.rate) || 0) * 100) * (Number(row.quantity) || 0), 0) / 100
    : cart.reduce((sum, row) => sum + Math.round(row.price * row.quantity * 100), 0) / 100, [cart, manualCart, isManual]);
  const safeDiscount = Math.round(Math.min(Math.max(Number(discount) || 0, 0), subtotal) * 100) / 100;
  const taxable = Math.max(0, subtotal - safeDiscount);
  const gstRate = Math.max(0, Number(gstPercent) || 0);
  const tax = gstInclusive ? Math.round((taxable - taxable / (1 + gstRate / 100)) * 100) / 100 : Math.round(taxable * gstRate) / 100;
  const exactTotal = gstInclusive ? Math.round(taxable * 100) / 100 : Math.round((taxable + tax) * 100) / 100;
  const total = roundOff ? Math.round(exactTotal) : exactTotal;
  const roundOffAmount = Math.round((total - exactTotal) * 100) / 100;
  const received = Number(amountReceived);
  const paymentError = amountReceived.trim() === '' ? 'Enter the amount received.' : !Number.isFinite(received) || received < 0 || received > 100000000 || Math.abs(received * 100 - Math.round(received * 100)) > 0.00001 ? 'Enter a valid amount with up to two decimal places.' : paymentMethod !== 'Cash' && received > total ? 'Digital payment cannot exceed the bill total.' : '';
  const balanceDue = Math.max(0, Math.round((total - received) * 100) / 100);
  const changeDue = Math.max(0, Math.round((received - total) * 100) / 100);
  const filtered = useMemo(() => {
    const value = (barcode || search).trim().toLowerCase();
    return products.filter((p) => !value || `${p.name} ${p.sku} ${p.barcode || ''} ${p.category}`.toLowerCase().includes(value));
  }, [products, search, barcode]);

  function addToCart(product) {
    setError(''); setMessage('');
    if (!product || product.stock < 1) { setError('This product is out of stock.'); return; }
    setCart((current) => {
      const found = current.find((x) => x._id === product._id);
      if (found) {
        if (found.quantity >= product.stock) { setError(`Only ${product.stock} in stock for ${product.name}.`); return current; }
        return current.map((x) => x._id === product._id ? { ...x, quantity: x.quantity + 1 } : x);
      }
      return [...current, { ...product, quantity: 1, price: Number(product.price) }];
    });
  }

  function addScannedValue(scannedValue, refocusInput = true) {
    const value = scannedValue.trim().toLowerCase();
    if (!value) return;
    const found = products.find((p) => p.barcode?.toLowerCase() === value || p.sku?.toLowerCase() === value);
    if (!found) setError(`No product found for barcode or SKU “${scannedValue}”. Add it in Inventory first.`);
    else addToCart(found);
    setBarcode('');
    if (refocusInput) barcodeRef.current?.focus();
  }

  function scanBarcode(event) {
    event.preventDefault();
    const value = barcode.trim().toLowerCase();
    if (!value) return;
    const exact = products.find(p => String(p.barcode || '').toLowerCase() === value || String(p.sku || '').toLowerCase() === value);
    if (exact) {
      addScannedValue(barcode);
      setSearch('');
    } else {
      setSearch('');
      setError(filtered.length ? 'Select a matching product below to add it to the bill.' : 'No matching products. Check the barcode, SKU or product name.');
    }
  }

  function setQuantity(id, amount) {
    setCart((current) => current.map((x) => x._id === id ? { ...x, quantity: Math.min(x.stock, Math.max(1, amount)) } : x));
  }

  async function saveBill() {
    if (busy) return;
    if (!billItems.length) { setError(isManual ? 'Add at least one manual item.' : 'Scan or select products before saving the bill.'); return; }
    if (isManual && manualCart.some(item => !item.name.trim() || item.name.trim().length > 120 || !Number.isSafeInteger(Number(item.quantity)) || Number(item.quantity) < 1 || Number(item.quantity) > 1000000 || item.rate.trim() === '' || !Number.isFinite(Number(item.rate)) || Number(item.rate) < 0 || Number(item.rate) > 100000000 || Math.abs(Number(item.rate) * 100 - Math.round(Number(item.rate) * 100)) > 0.00001 || Math.round(Number(item.rate) * 100) * Number(item.quantity) > 10000000000)) {
      setError('Enter an item name, positive whole-number quantity and valid rate with up to two decimal places for every item.'); return;
    }
    if (paymentError) { setError(paymentError); return; }
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await request('/bills', { method: 'POST', body: JSON.stringify({
        customerName: customerName || 'Walk-in customer', customerPhone, discount: safeDiscount, paymentMethod, amountReceived: received,
        billingMode: isManual ? 'manual' : 'inventory',
        gstPercent: Math.max(0, Number(gstPercent) || 0), gstInclusive, roundOff, items: isManual ? manualCart.map(item => ({ name: item.name.trim(), quantity: Number(item.quantity), rate: Number(item.rate) })) : cart.map((x) => ({ productId: x._id, quantity: x.quantity })),
      }) });
      setLastBill(result.bill); setAmountReceived(''); setPaymentMethod('Cash'); if (isManual) setManualCart([{ name: '', quantity: '1', rate: '' }]); else setCart([]); setCustomerName(''); setCustomerPhone(''); setDiscount('0'); setGstPercent('5'); setRoundOff(true); setGstInclusive(true);
      setMessage(isManual ? `Manual bill ${result.bill.invoiceNo} saved.` : `Bill ${result.bill.invoiceNo} saved. Stock has been updated.`); await load();
    } catch (e) { await load(); setError(e.message); }
    finally { setBusy(false); }
  }

  function openProductForm(product = null) {
    setEditingProduct(product);
    setProductForm(product ? { name: product.name, sku: product.sku, barcode: product.barcode || '', category: product.category, price: String(product.price), costPrice: product.costPrice == null ? '' : String(product.costPrice), stock: String(product.stock) } : { name: '', sku: '', barcode: '', category: 'Saree', price: '', costPrice: '', stock: '' });
    setShowProductForm(true); setError('');
  }

  async function createProduct(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const payload = { ...productForm, price: Number(productForm.price), stock: Number(productForm.stock) };
      if (editingProduct) {
        payload.expectedUpdatedAt = editingProduct.updatedAt;
        if (payload.stock === editingProduct.stock) delete payload.stock;
      }
      const result = await request(editingProduct ? `/products/${encodeURIComponent(editingProduct._id)}` : '/products', { method: editingProduct ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
      if (editingProduct) setCart(current => current.map(item => item._id === result.product._id ? { ...item, ...result.product, quantity: Math.min(item.quantity, result.product.stock) } : item).filter(item => item.quantity > 0));
      setShowProductForm(false); setEditingProduct(null);
      setMessage(editingProduct ? 'Product updated.' : 'Product added to inventory.'); await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function adjustStock(product, amount) {
    const stock = product.stock + amount;
    if (stock < 0) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await request(`/products/${product._id}`, { method: 'PATCH', body: JSON.stringify({ stockDelta: amount }) });
      await load(); setMessage(`Stock updated for ${product.name}.`);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function deleteProduct(product) {
    if (!window.confirm(`Delete ${product.name} and its remaining stock from inventory? Past bills will be kept.`)) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await request(`/products/${product._id}`, { method: 'DELETE' });
      setCart((current) => current.filter((item) => item._id !== product._id));
      await load();
      setMessage(`${product.name} was removed from inventory.`);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function voidBill(bill) {
    if (bill.status === 'Cancelled') return;
    if (!window.confirm(`Cancel bill ${bill.invoiceNo}? It stays in history marked Cancelled, is removed from sales totals, and its stock is returned to inventory.`)) return;
    const reason = window.prompt('Reason for cancelling (optional):', '') ?? '';
    setBusy(true); setError(''); setMessage('');
    try {
      await request(`/bills/${bill._id}/void`, { method: 'POST', body: JSON.stringify({ reason }) });
      setLastBill(null);
      await load();
      setMessage(`Bill ${bill.invoiceNo} was cancelled and its stock restored.`);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  if (!loggedIn) return <Login onLogin={(newRole) => { setRole(newRole); setPage(newRole === 'user' ? 'New bill' : 'Overview'); setLoggedIn(true); setError(''); }} />;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><Shirt size={21}/></span><span><strong>JMS</strong><small>TEXTILES</small></span></div>
      <div className="store-label">STORE MANAGEMENT</div>
      <nav>{[
        ['Overview', LayoutDashboard], ['New bill', ReceiptText], ['Billing option', Pencil], ['Inventory', Package], ['Sales', BarChart3],
      ].filter(([label]) => (isAdmin ? ADMIN_PAGES : USER_PAGES).includes(label)).map(([label, Icon]) => <button key={label} className={`nav-item ${page === label ? 'active' : ''}`} onClick={() => setPage(label)}><Icon size={18}/><span>{label}</span>{label === 'New bill' && <span className="nav-dot"/>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="online-dot"/> <span>Billing system ready</span><span className="version">v1.0</span></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div><div className="breadcrumb">JMS Textiles <span>/</span> {page}</div><h1>{isManual ? 'Manual billing' : page === 'New bill' ? 'Create a bill' : page}</h1></div><div className="top-actions"><span className="today-chip"><Clock3 size={15}/>{new Date().toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}</span><span className="role-chip">{isAdmin ? 'Admin' : 'User'}</span><button className="avatar logout-button" title="Sign out" onClick={() => { localStorage.removeItem('jms_session'); setLoggedIn(false); setCart([]); setManualCart([{ name: '', quantity: '1', rate: '' }]); setProducts([]); setBills([]); setSummary(null); setLastBill(null); }}>JM</button></div></header>
      <div className="content">
        {error && <div className="alert error"><AlertTriangle size={17}/>{error}<button onClick={() => setError('')}>×</button></div>}
        {message && <div className="alert success"><Check size={17}/>{message}<button onClick={() => setMessage('')}>×</button></div>}
        {isAdmin && page === 'Overview' && <>
          <section className="welcome-row"><div><p className="eyebrow">YOUR SHOP AT A GLANCE</p><h2>Good day, JMS <span>✦</span></h2><p>Here’s what’s happening at your store today.</p></div><button className="primary" onClick={() => setPage('New bill')}><Plus size={17}/> Create new bill</button></section>
          <div className="stats-grid">
            <Stat icon={CircleDollarSign} label="Today's sales" value={money(summary?.todaySales)} note={`${summary?.todayBills || 0} bills today`} tone="plum"/>
            <Stat icon={ReceiptText} label="Bills today" value={summary?.todayBills || 0} note="Successful checkouts" tone="peach"/>
            <Stat icon={Package} label="Products in stock" value={summary?.productCount || 0} note="Active products" tone="sage"/>
            <Stat icon={AlertTriangle} label="Low stock items" value={summary?.lowStock || 0} note="5 units or fewer" tone="gold"/>
            <Stat icon={Package} label="Inventory value" value={money(summary?.inventoryValue)} note={inventoryNote(summary)} tone="plum"/>
          </div>
          <div className="overview-grid">
            <section className="panel recent-panel"><div className="panel-heading"><div><h3>Recent bills</h3><p>Your latest customer checkouts</p></div><div className="inventory-actions"><button className="text-button" onClick={() => setPage('Sales')}>View all <ArrowDownToLine size={15}/></button></div></div><BillTable bills={bills.slice(0, 5)} onSelect={setLastBill} onDelete={voidBill} busy={busy}/></section>
            <section className="panel quick-panel"><div className="panel-heading"><div><h3>Quick actions</h3><p>Common tasks, one click away</p></div></div><button className="quick-action" onClick={() => setPage('New bill')}><span className="quick-icon lavender"><FilePlus2 size={19}/></span><span><b>Start a new bill</b><small>Scan items and checkout</small></span><Plus size={17}/></button><button className="quick-action" onClick={() => { setPage('Inventory'); openProductForm(); }}><span className="quick-icon softgreen"><Package size={19}/></span><span><b>Add a product</b><small>Update your store catalogue</small></span><Plus size={17}/></button><div className="quick-note"><Activity size={17}/><span>Sales and stock update as soon as a bill is saved.</span></div></section>
          </div>
          <section className="panel lowstock-panel"><div className="panel-heading"><div><h3>Stock to watch</h3><p>Products at 5 units or fewer</p></div><button className="text-button" onClick={() => setPage('Inventory')}>Inventory <ChevronDown size={15}/></button></div><LowStock products={products.filter((p) => p.stock <= 5).slice(0, 5)}/></section>
        </>}

        {(page === 'New bill' || isManual) && <div className="billing-layout">
          {isManual ? <ManualItems items={manualCart} onChange={setManualCart} busy={busy} /> : <section className="panel bill-left"><div className="panel-heading"><div><h3>Items</h3><p>Scan a barcode or find a product</p></div><span className="soft-count">{cart.reduce((a, b) => a + b.quantity, 0)} items</span></div>
            <form className="scan-box" style={{ height: 'auto', minHeight: 46, flexWrap: 'wrap', padding: '8px 10px' }} onSubmit={scanBarcode}><QrCode size={19}/><input ref={barcodeRef} style={{ flex: '1 1 180px' }} value={barcode} onChange={(e) => { setBarcode(e.target.value); setSearch(''); setError(''); }} aria-label="Barcode or product search" placeholder="Scan or search barcode, SKU or product name" autoFocus/><button type="button" className="camera-scan-button" aria-label="Scan with camera" onClick={() => setShowCameraScanner(true)}><Camera size={15}/><span>Camera</span></button><button type="button" aria-label="Search barcode or product" onClick={() => { setSearch(''); setError(''); barcodeRef.current?.focus(); }}><Search size={15}/> Search</button><button type="submit">Add</button></form>
            <div className="search-field"><Search size={17}/><input value={search} onChange={(e) => { setSearch(e.target.value); setBarcode(''); setError(''); }} aria-label="Search products" placeholder="Search product name, SKU or barcode"/></div>
            {(barcode || search) && <div className="panel-heading"><span className="soft-count" role="status">{filtered.length} matching products</span><button type="button" className="text-button" onClick={() => { setBarcode(''); setSearch(''); setError(''); }}>Clear search</button></div>}
            <div className="product-picker">{filtered.map((p) => <button className="picker-row" key={p._id} onClick={() => { addToCart(p); setBarcode(''); setSearch(''); barcodeRef.current?.focus(); }} disabled={!p.stock}><span className="fabric-swatch">{p.name.slice(0, 1).toUpperCase()}</span><span className="picker-name"><b>{p.name}</b><small>{p.sku} · {p.barcode || 'No barcode'} · {p.category}</small></span><span className="picker-price"><b>{money(p.price)}</b><small>{p.stock} in stock</small></span><Plus size={17}/></button>)}{!filtered.length && <div className="empty-state">No matching products. Add them from Inventory.</div>}</div>
            <div className="cart-heading"><h3>Bill items</h3><button className="text-button" onClick={() => setCart([])} disabled={!cart.length}><Trash2 size={14}/> Clear</button></div>
            <div className="cart-list">{cart.map((item) => <div className="cart-row" key={item._id}><span className="fabric-swatch small">{item.name.slice(0, 1).toUpperCase()}</span><span className="cart-name"><b>{item.name}</b><small>{money(item.price)} each</small></span><div className="qty-control"><button onClick={() => setQuantity(item._id, item.quantity - 1)}><Minus size={13}/></button><span>{item.quantity}</span><button onClick={() => setQuantity(item._id, item.quantity + 1)}><Plus size={13}/></button></div><b className="line-total">{money(item.price * item.quantity)}</b><button className="icon-button remove" onClick={() => setCart((c) => c.filter((x) => x._id !== item._id))}><Trash2 size={16}/></button></div>)}{!cart.length && <div className="empty-cart"><ShoppingBag size={23}/><b>No items yet</b><span>Scan a product barcode or select one above.</span></div>}</div>
          </section>}
          <aside className="panel checkout-panel"><div className="checkout-title"><div><p className="eyebrow">CHECKOUT</p><h3>Bill summary</h3></div><ReceiptText size={20}/></div>
            <label className="field-label">Customer name <span>OPTIONAL</span><input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Walk-in customer"/></label>
            <label className="field-label">Phone number <span>OPTIONAL</span><input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="Customer phone" inputMode="tel"/></label>
            <div className="summary-lines"><div><span>Subtotal</span><b>{money(subtotal)}</b></div><div className="discount-line"><label>Discount <span>(₹)</span></label><input type="number" min="0" max={subtotal} value={discount} onChange={(e) => setDiscount(e.target.value)} /></div><div className="discount-line"><label>GST <span>(%)</span></label><input type="number" min="0" max="100" value={gstPercent} onChange={(e) => setGstPercent(e.target.value)} /></div><div className="check-line"><label><input type="checkbox" checked={gstInclusive} onChange={(e) => setGstInclusive(e.target.checked)} /> GST included in rate</label></div><div><span>{gstInclusive ? 'GST (included)' : 'Tax'}</span><b>{money(tax)}</b></div><div className="check-line"><label><input type="checkbox" checked={roundOff} onChange={(e) => setRoundOff(e.target.checked)} /> Round off to nearest ₹</label><b>{roundOffAmount > 0 ? '+' : ''}{roundOffAmount.toFixed(2)}</b></div></div>
            <div className="total-row"><span>Total payable</span><strong>{money(total)}</strong></div><div className="payment-form">
              <label className="field-label">Payment method<select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}>{['Cash', 'UPI', 'Card', 'Bank transfer'].map(method => <option key={method}>{method}</option>)}</select></label>
              <label className="field-label">{paymentMethod === 'Cash' ? 'Cash received (₹)' : 'Amount received (₹)'}<input type="number" min="0" step="0.01" max="100000000" placeholder="Enter amount received" value={amountReceived} onChange={e => setAmountReceived(e.target.value)} /></label>
              <button type="button" className="text-button" onClick={() => setAmountReceived(total.toFixed(2))}>Exact amount</button>
              <div className="summary-lines" aria-live="polite">{amountReceived !== '' && !paymentError && <>
                {paymentMethod === 'Cash' && <div><span>Change to return</span><b>{money(changeDue)}</b></div>}
                <div><span>Balance due</span><b>{money(balanceDue)}</b></div>
                <div><span>Status</span><b>{balanceDue === 0 ? 'Paid' : received > 0 ? 'Partially paid' : 'Unpaid'}</b></div>
              </>}{amountReceived !== '' && paymentError && <p role="alert">{paymentError}</p>}</div>
            </div><button className="primary save-bill" onClick={saveBill} disabled={busy || !billItems.length}>{busy ? <LoaderCircle className="spin" size={18}/> : <Check size={18}/>} {busy ? 'Saving bill…' : 'Save bill'}</button><p className="checkout-foot"><Check size={14}/> {isManual ? 'Manual bill will be saved to sales history' : 'Stock will update after this bill is saved'}</p>
          </aside>
        </div>}

        {page === 'Inventory' && <section className="panel inventory-panel"><div className="panel-heading"><div><h3>Product inventory</h3><p>{isAdmin ? 'Manage products, barcodes, prices and available stock' : 'Products, selling prices and available stock (view only)'}</p></div>{isAdmin && <div className="inventory-actions"><button className="primary" onClick={() => openProductForm()}><Plus size={17}/> Add product</button></div>}</div>{isAdmin && showProductForm && <form className="product-form" onSubmit={createProduct}><h3>{editingProduct ? `Edit ${editingProduct.name}` : 'Add product'}</h3><div className="form-grid"><Field label="Product name" value={productForm.name} onChange={(v) => setProductForm({ ...productForm, name: v })} required/><Field label="SKU" value={productForm.sku} onChange={(v) => setProductForm({ ...productForm, sku: v })} required/><Field label="Barcode / QR value" value={productForm.barcode} onChange={(v) => setProductForm({ ...productForm, barcode: v })}/><Field label="Category" value={productForm.category} onChange={(v) => setProductForm({ ...productForm, category: v })}/><Field label="Selling price (₹)" value={productForm.price} onChange={(v) => setProductForm({ ...productForm, price: v })} type="number" required/><Field label="Cost price (₹, optional)" value={productForm.costPrice} onChange={(v) => setProductForm({ ...productForm, costPrice: v })} type="number"/><Field label={editingProduct ? "Current stock" : "Opening stock"} value={productForm.stock} onChange={(v) => setProductForm({ ...productForm, stock: v })} type="number" required/></div><div className="form-actions"><button type="button" className="secondary" disabled={busy} onClick={() => { setShowProductForm(false); setEditingProduct(null); }}>Cancel</button><button className="primary" disabled={busy}>{busy ? 'Saving…' : editingProduct ? 'Save changes' : 'Save product'}</button></div></form>}<div className="inventory-search-row"><div className="search-field"><Search size={18} aria-hidden="true"/><input aria-label="Search inventory" value={inventorySearch} onChange={e => setInventorySearch(e.target.value)} placeholder="Search name, SKU, barcode or category"/>{inventorySearch && <button type="button" className="text-button" onClick={() => setInventorySearch('')}>Clear search</button>}</div><span className="soft-count">{inventoryProducts.length} of {products.length} products</span><button className="secondary" disabled={busy} onClick={load}>Refresh inventory</button></div><div className="table-wrap"><table><thead><tr><th>PRODUCT</th><th>SKU / BARCODE</th><th>CATEGORY</th><th>PRICE</th>{isAdmin && <th>COST</th>}<th>STOCK</th>{isAdmin && <><th>ADJUST STOCK</th><th>EDIT</th><th>DELETE</th></>}</tr></thead><tbody>{inventoryProducts.map((p) => <tr key={p._id}><td><div className="product-cell"><span className="fabric-swatch small">{p.name.slice(0, 1).toUpperCase()}</span><b>{p.name}</b></div></td><td>{p.sku}<small className="table-sub">{p.barcode || 'No barcode'}</small></td><td>{p.category}</td><td><b>{money(p.price)}</b></td>{isAdmin && <td>{p.costPrice == null ? '—' : money(p.costPrice)}</td>}<td><span className={`stock-badge ${p.stock <= 5 ? 'low' : ''}`}>{p.stock} {p.stock <= 5 && <AlertTriangle size={12}/>}</span></td>{isAdmin && <><td><div className="stock-actions"><button type="button" className="stock-adjust-button" aria-label={`Remove one ${p.name} from stock`} title="Remove one from stock" disabled={busy || p.stock <= 0} onClick={() => adjustStock(p, -1)}><Minus size={15}/></button><button type="button" className="stock-adjust-button" aria-label={`Add one ${p.name} to stock`} title="Add one to stock" disabled={busy} onClick={() => adjustStock(p, 1)}><Plus size={15}/></button></div></td><td><button type="button" className="secondary small-button" aria-label={`Edit ${p.name}`} disabled={busy} onClick={() => { openProductForm(p); document.querySelector('.inventory-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}><Pencil size={14}/> Edit</button></td><td><button type="button" className="clear-inventory-button product-delete-button" aria-label={`Delete ${p.name} from inventory`} disabled={busy} onClick={() => deleteProduct(p)}><Trash2 size={14}/> Delete</button></td></>}</tr>)}</tbody></table>{!inventoryProducts.length && <div className="empty-state">{products.length ? 'No products match your search. Clear search to see all products.' : (isAdmin ? 'No products yet. Add your first product to get started.' : 'No products yet. Ask the admin to add products.')}</div>}</div></section>}

        {isAdmin && page === 'Sales' && <SalesExplorer request={request} onSelect={setLastBill}/> }
      </div>
    </main>
    {showCameraScanner && <CameraScanner onClose={() => setShowCameraScanner(false)} onScan={(value) => {
      setShowCameraScanner(false);
      addScannedValue(value, false);
    }}/>}
    {lastBill && <div className="modal-backdrop invoice-backdrop" onClick={() => setLastBill(null)}><div className="invoice-modal" onClick={(e) => e.stopPropagation()}><div className="invoice-actions"><span className="soft-count">{lastBill.status === 'Cancelled' ? 'Cancelled bill' : 'Saved bill'}</span>{isAdmin && lastBill.status !== 'Cancelled' && <button className="secondary" disabled={busy} onClick={() => voidBill(lastBill)}><Ban size={16}/> Cancel bill</button>}<button className="secondary" onClick={() => printReceipt(document.querySelector('.invoice-paper')).catch((error) => setError(error.message))}><Printer size={16}/> Print receipt</button><button className="icon-button" onClick={() => setLastBill(null)}>×</button></div><Invoice bill={lastBill}/></div></div>}
  </div>;
}

function CameraScanner({ onClose, onScan }) {
  const [error, setError] = useState('');
  const onScanRef = useRef(onScan);
  const hasScanned = useRef(false);
  onScanRef.current = onScan;

  useEffect(() => {
    let scanner;
    let cancelled = false;
    let started = false;

    async function startCamera() {
      try {
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');
        if (cancelled) return;
        scanner = new Html5Qrcode('billing-camera-reader', {
          verbose: false,
          formatsToSupport: [
            Html5QrcodeSupportedFormats.QR_CODE,
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.UPC_E,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.CODE_93,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.ITF,
          ],
        });
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 250, height: 180 } },
          (decodedText) => {
            if (!cancelled && !hasScanned.current) {
              hasScanned.current = true;
              onScanRef.current(decodedText);
            }
          },
          () => {},
        );
        started = true;
        if (cancelled) {
          await scanner.stop();
          scanner.clear();
        }
      } catch (cameraError) {
        if (!cancelled) setError(cameraError.message || 'Camera access was unavailable.');
        else console.error('Unable to start or stop the barcode scanner camera.', cameraError);
      }
    }

    startCamera();
    return () => {
      cancelled = true;
      if (started && scanner?.isScanning) {
        scanner.stop()
          .then(() => scanner.clear())
          .catch((cameraError) => console.error('Unable to stop the barcode scanner camera.', cameraError));
      }
    };
  }, []);

  return <div className="scanner-backdrop" onClick={onClose}>
    <section className="scanner-dialog" role="dialog" aria-modal="true" aria-labelledby="camera-scanner-title" onClick={(event) => event.stopPropagation()}>
      <header className="scanner-heading"><div><p className="eyebrow">BILLING</p><h2 id="camera-scanner-title">Scan a barcode or QR code</h2></div><button className="icon-button" onClick={onClose} aria-label="Close camera scanner">×</button></header>
      <div id="billing-camera-reader"/>
      {error ? <div className="alert error camera-error">Unable to open the camera: {error}. Check camera permission and use HTTPS.</div> : <p className="scanner-hint">Point your rear camera at the product code. Camera access requires permission and a secure connection (HTTPS).</p>}
    </section>
  </div>;
}

function Login({ onLogin }) {
  const [username, setUsername] = useState(''); const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { const result = await request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }); localStorage.setItem('jms_session', result.token); onLogin(result.role === 'user' ? 'user' : 'admin'); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <div className="login-screen"><form className="login-card" onSubmit={submit}><div className="brand login-brand"><span className="brand-mark"><Shirt size={21}/></span><span><strong>JMS</strong><small>TEXTILES</small></span></div><p className="eyebrow">STORE MANAGEMENT</p><h1>Welcome back</h1><p className="login-description">Sign in to manage billing and stock.</p>{error && <div className="alert error">{error}</div>}<label className="field-label">Username<input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required /></label><label className="field-label">Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label><button className="primary login-submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button></form></div>;
}

function Field({ label, value, onChange, type = 'text', required }) { return <label className="field-label">{label}<input type={type} required={required} min={type === 'number' ? '0' : undefined} step={type === 'number' && label.includes('price') ? '0.01' : type === 'number' ? '1' : undefined} value={value} onChange={(e) => onChange(e.target.value)} /></label>; }
function inventoryNote(s) {
  const units = s?.inventoryUnits || 0, costed = s?.costedProducts || 0, all = s?.productCount || 0;
  if (!costed) return `${units} units at selling price`;
  return costed === all ? `${units} units · cost ${money(s.inventoryCost)}` : `${units} units · cost ${money(s.inventoryCost)} (${costed} of ${all} products)`;
}
function Stat({ icon: Icon, label, value, note, tone }) { return <div className="stat-card"><span className={`stat-icon ${tone}`}><Icon size={20}/></span><span className="stat-label">{label}</span><strong>{value}</strong><small>{note}</small></div>; }
function BillTable({ bills, onSelect, onDelete, busy = false }) { return <div className="table-wrap"><table><thead><tr><th>INVOICE</th><th>CUSTOMER</th><th>ITEMS</th><th>DATE & TIME</th><th>AMOUNT</th><th>PAYMENT METHOD</th><th>BALANCE DUE</th><th>STATUS</th>{onDelete && <th>ACTION</th>}</tr></thead><tbody>{bills.map((b) => <tr key={b._id} className="click-row" onClick={() => onSelect(b)}><td><b className="invoice-link">{b.invoiceNo}</b></td><td>{b.customerName || 'Walk-in customer'}</td><td>{b.items?.reduce((n, item) => n + item.quantity, 0) || 0}</td><td>{dateTime(b.createdAt)}</td><td><b>{money(b.total)}</b></td><td>{b.paymentMethod || 'Not recorded'}</td><td>{b.paymentMethod ? money(b.balanceDue) : '—'}</td><td>{paymentStatus(b)}</td>{onDelete && <td><button type="button" className="icon-button remove" aria-label={`Cancel bill ${b.invoiceNo}`} title={`Cancel ${b.invoiceNo}`} disabled={busy || b.status === 'Cancelled'} onClick={(event) => { event.stopPropagation(); onDelete(b); }}><Ban size={16}/></button></td>}</tr>)}</tbody></table>{!bills.length && <div className="empty-state"><ReceiptText size={22}/>No bills saved yet.</div>}</div>; }
function LowStock({ products }) { return <div className="lowstock-list">{products.map((p) => <div className="lowstock-row" key={p._id}><span className="fabric-swatch small">{p.name.slice(0,1)}</span><b>{p.name}</b><small>{p.sku}</small><span className="stock-badge low">{p.stock} left</span></div>)}{!products.length && <div className="empty-state">Stock levels look good. No low-stock items.</div>}</div>; }
const SHOP = { name: 'JMS TEXTILES', address: ['No:58/1 Vandikaran Street,', 'Guindy 600032'], phone: 'Ph : 9043557183 / 7845999726', gstin: '33GYVPS1725R1ZB' };
const amt = (n) => Number(n || 0).toFixed(2);
const receiptDate = (value) => new Date(value).toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).replace(',', '').replace(/\b(am|pm)\b/, (m) => m.toUpperCase());
function Invoice({ bill }) {
  const items = bill.items || [];
  const qty = items.reduce((n, item) => n + (Number(item.quantity) || 0), 0);
  const tax = Number(bill.tax) || 0;
  const inclusive = bill.gstInclusive === true;
  const taxable = bill.taxableValue != null ? Number(bill.taxableValue) : Math.round((Number(bill.subtotal || 0) - Number(bill.discount || 0)) * 100) / 100;
  const cgst = Math.round(tax * 100 / 2) / 100;
  const sgst = Math.round((tax - cgst) * 100) / 100;
  const method = bill.paymentMethod;
  const title = bill.status === 'Cancelled' ? 'CANCELLED BILL' : method ? `${method.toUpperCase()} BILL` : 'SALES INVOICE';
  return <div className="invoice-paper receipt-style"><div className="invoice-brand"><span className="brand-mark"><Shirt size={20}/></span><div><h2>{SHOP.name}</h2><p className="shop-contact">{SHOP.address[0]}<br/>{SHOP.address[1]}</p><p className="shop-contact">{SHOP.phone}</p><p className="shop-contact gst-line">GST No : {SHOP.gstin}</p></div></div><p className="receipt-title">{title}</p><div className="invoice-meta"><div><span>Bill No</span><b>: {bill.invoiceNo}</b></div><div><span>Date</span><b>: {receiptDate(bill.createdAt)}</b></div><div><span>Customer</span><b>: {bill.customerName || 'Walk-in customer'}{bill.customerPhone ? ` (${bill.customerPhone})` : ''}</b></div></div><table className="invoice-items"><thead><tr><th>S No</th><th>Item Particulars</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead><tbody>{items.map((item, i) => <tr key={i}><td>{i + 1}</td><td>{item.name}{item.sku && <small>{item.sku}</small>}</td><td>{item.quantity}</td><td>{amt(item.unitPrice)}</td><td>{amt(item.lineTotal)}</td></tr>)}</tbody></table><div className="receipt-total"><span>Total : {qty}</span><b>{amt(bill.subtotal)}</b></div><div className="invoice-totals"><div><span>Basic Value</span><b>{amt(bill.subtotal)}</b></div>{bill.discount > 0 && <div><span>Discount</span><b>− {amt(bill.discount)}</b></div>}{bill.gstPercent > 0 && !inclusive && <div><span>GST ({bill.gstPercent}%)</span><b>{amt(tax)}</b></div>}{Number(bill.roundOff) !== 0 && bill.roundOff != null && <div><span>Round Off</span><b>{Number(bill.roundOff) > 0 ? '+ ' : '− '}{amt(Math.abs(bill.roundOff))}</b></div>}<div className="invoice-grand"><span>Net Value</span><b>{amt(bill.total)}</b></div>{method ? <><div><span>{method} Value</span><b>{amt(bill.amountPaid)}</b></div><div><span>Tender Value</span><b>{amt(bill.amountReceived)}</b></div>{method === 'Cash' && bill.changeDue > 0 && <div><span>Change</span><b>{amt(bill.changeDue)}</b></div>}{bill.balanceDue > 0 && <div><span>Balance Due</span><b>{amt(bill.balanceDue)}</b></div>}</> : <div><span>Payment</span><b>Not recorded</b></div>}</div>{bill.gstPercent > 0 && <table className="tax-table"><thead><tr><th>Tax Name</th><th>Taxable</th><th>CGST</th><th>SGST</th><th>Total</th></tr></thead><tbody><tr><td>GST {bill.gstPercent}%</td><td>{amt(taxable)}</td><td>{amt(cgst)}</td><td>{amt(sgst)}</td><td>{amt(tax)}</td></tr></tbody></table>}{inclusive && bill.gstPercent > 0 && <p className="incl-note">Inclusive of All Taxes</p>}<p className="thankyou">THANK YOU..! VISIT AGAIN...!!!</p></div>;
}

export default App;

