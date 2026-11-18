import { Package, Plus, Trash2 } from 'lucide-react';

const money = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(value);

// Finds the inventory product a typed manual name refers to (exact name, SKU or barcode, any case).
export function inventoryMatch(products, name) {
  const value = String(name || '').trim().toLowerCase();
  if (!value) return null;
  return products.find(p => p.active !== false && [p.name, p.sku, p.barcode].some(v => String(v || '').trim().toLowerCase() === value)) || null;
}

// Lines typed by hand for things that are not in inventory. They are part of the same bill as the
// scanned / searched inventory items, so they show on both billing screens.
export default function ManualItems({ items, onChange, busy, products = [], onUseProduct, compact = false }) {
  function update(index, key, value) {
    onChange(items.map((item, i) => i === index ? { ...item, [key]: value } : item));
  }
  return <section className={`panel bill-left manual-billing ${compact ? 'manual-compact' : ''}`}>
    <div className="panel-heading"><div><h3>Manual items</h3><p>For items not in inventory: type name, quantity and rate.</p></div><span className="soft-count">{items.length} {items.length === 1 ? 'line' : 'lines'}</span></div>
    <p className="manual-note">Manual items are saved in Sales but do not change stock. For products in inventory, scan or search them instead so stock stays correct.</p>
    <div className="manual-items">
      {items.map((item, index) => {
        const match = inventoryMatch(products, item.name);
        return <div key={index}>
          <div className="manual-item-row">
            <label className="field-label manual-item-name">Item name<input aria-label={`Item ${index + 1} name`} maxLength={120} value={item.name} disabled={busy} placeholder="e.g. Blouse stitching" onChange={e => update(index, 'name', e.target.value)} list="inventory-names" /></label>
            <label className="field-label">Quantity<input aria-label={`Item ${index + 1} quantity`} type="number" min="1" max="1000000" step="1" value={item.quantity} disabled={busy} onChange={e => update(index, 'quantity', e.target.value)} /></label>
            <label className="field-label">Rate (₹)<input aria-label={`Item ${index + 1} rate`} type="number" min="0" max="100000000" step="0.01" value={item.rate} disabled={busy} placeholder="0.00" onChange={e => update(index, 'rate', e.target.value)} /></label>
            <div className="field-label">Amount<strong>{money(Math.round((Number(item.rate) || 0) * 100) * (Number(item.quantity) || 0) / 100)}</strong></div>
            <button type="button" className="icon-button remove" aria-label={`Remove item ${index + 1}`} disabled={busy} onClick={() => onChange(items.filter((_, i) => i !== index))}><Trash2 size={16} /></button>
          </div>
          {match && onUseProduct && <div className="manual-match">
            <Package size={14} /><span><b>{match.name}</b> is in inventory ({money(Number(match.price) || 0)}, {match.stock} in stock).</span>
            <button type="button" className="secondary small-button" disabled={busy || match.stock < 1} onClick={() => onUseProduct(index, match)}>{match.stock < 1 ? 'Out of stock' : 'Use inventory item (stock updates)'}</button>
          </div>}
        </div>;
      })}
    </div>
    <datalist id="inventory-names">{products.filter(p => p.active !== false).slice(0, 500).map(p => <option key={p._id} value={p.name}>{p.sku}</option>)}</datalist>
    {!items.length && <div className="empty-state">No manual items in this bill.</div>}
    <button type="button" className="secondary" disabled={busy || items.length >= 100} onClick={() => onChange([...items, { name: '', quantity: '1', rate: '' }])}><Plus size={16} /> Add manual item</button>
  </section>;
}
