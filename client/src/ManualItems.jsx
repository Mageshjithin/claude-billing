import { Plus, Trash2 } from 'lucide-react';

const money = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(value);

export default function ManualItems({ items, onChange, busy }) {
  function update(index, key, value) {
    onChange(items.map((item, i) => i === index ? { ...item, [key]: value } : item));
  }
  return <section className="panel bill-left manual-billing">
    <div className="panel-heading"><div><h3>Manual billing</h3><p>Enter item name, quantity and rate to create a bill.</p></div><span className="soft-count">{items.length} items</span></div>
    <p className="manual-note">Manual items are saved in sales history. Inventory stock is not adjusted.</p>
    <div className="manual-items">
      {items.map((item, index) => <div className="manual-item-row" key={index}>
        <label className="field-label manual-item-name">Item name<input aria-label={`Item ${index + 1} name`} maxLength={120} value={item.name} disabled={busy} placeholder="e.g. Cotton saree" onChange={e => update(index, 'name', e.target.value)} /></label>
        <label className="field-label">Quantity<input aria-label={`Item ${index + 1} quantity`} type="number" min="1" max="1000000" step="1" value={item.quantity} disabled={busy} onChange={e => update(index, 'quantity', e.target.value)} /></label>
        <label className="field-label">Rate (₹)<input aria-label={`Item ${index + 1} rate`} type="number" min="0" max="100000000" step="0.01" value={item.rate} disabled={busy} placeholder="0.00" onChange={e => update(index, 'rate', e.target.value)} /></label>
        <div className="field-label">Amount<strong>{money(Math.round((Number(item.rate) || 0) * 100) * (Number(item.quantity) || 0) / 100)}</strong></div>
        <button type="button" className="icon-button remove" aria-label={`Remove item ${index + 1}`} disabled={busy} onClick={() => onChange(items.filter((_, i) => i !== index))}><Trash2 size={16} /></button>
      </div>)}
    </div>
    {!items.length && <div className="empty-state">Add an item to start your manual bill.</div>}
    <button type="button" className="secondary" disabled={busy || items.length >= 100} onClick={() => onChange([...items, { name: '', quantity: '1', rate: '' }])}><Plus size={16} /> Add item</button>
  </section>;
}
