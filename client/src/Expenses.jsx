import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';

const money = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(n) || 0);
const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const showDate = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
const blank = () => ({ date: today(), description: '', category: 'Other', amount: '', status: 'Paid', note: '' });

// Shop expenses (rent, EB, transport, purchases...), kept separate from sales. Admin only.
export default function Expenses({ request }) {
  const [mode, setMode] = useState('month');
  const [month, setMonth] = useState(today().slice(0, 7));
  const [year, setYear] = useState(today().slice(0, 4));
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null); // null = closed; { ...fields, _id? } = adding/editing
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const params = new URLSearchParams(mode === 'month' ? { month } : mode === 'year' ? { year } : {});
    try { setData(await request(`/expenses?${params}`)); setError(''); } catch (e) { setError(e.message); }
  }, [request, mode, month, year]);
  useEffect(() => { load(); }, [load]);

  const categories = data?.categories || ['Other'];
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function save(e) {
    e.preventDefault();
    setBusy(true); setError(''); setMessage('');
    const { _id, ...body } = form;
    try {
      await request(_id ? `/expenses/${_id}` : '/expenses', { method: _id ? 'PATCH' : 'POST', body: JSON.stringify({ ...body, amount: Number(body.amount) }) });
      setMessage(_id ? 'Expense updated.' : `Expense of ${money(body.amount)} added.`);
      setForm(null);
      await load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function remove(expense) {
    if (!window.confirm(`Delete the expense "${expense.description}" of ${money(expense.amount)}? This cannot be undone.`)) return;
    setBusy(true); setError(''); setMessage('');
    try { await request(`/expenses/${expense._id}`, { method: 'DELETE' }); setMessage('Expense deleted.'); await load(); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  const s = data?.summary;
  const periodLabel = mode === 'month' ? new Date(`${month}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) : mode === 'year' ? year : 'All time';

  return (
    <section className="panel expenses-panel">
      <div className="panel-heading">
        <div><h3>Expenses</h3><p>Rent, EB, transport, purchases and other shop costs · kept separate from sales</p></div>
        <button className="primary" onClick={() => setForm(blank())}><Plus size={17} /> Add expense</button>
      </div>
      {error && <div className="alert error">{error}<button onClick={() => setError('')}>×</button></div>}
      {message && <div className="alert success">{message}<button onClick={() => setMessage('')}>×</button></div>}

      {form && <form className="product-form" onSubmit={save}>
        <div className="form-grid">
          <label className="field-label">Date<input type="date" required value={form.date} onChange={set('date')} /></label>
          <label className="field-label">What was it for<input required maxLength={200} placeholder="e.g. Rent, EB bill, Auto" value={form.description} onChange={set('description')} /></label>
          <label className="field-label">Amount (₹)<input type="number" required min="0.01" step="0.01" value={form.amount} onChange={set('amount')} /></label>
          <label className="field-label">Category<select value={form.category} onChange={set('category')}>{categories.map((c) => <option key={c}>{c}</option>)}</select></label>
          <label className="field-label">Status<select value={form.status} onChange={set('status')}><option>Paid</option><option>Pending</option></select></label>
          <label className="field-label">Note<input maxLength={300} placeholder="Bill no., balance due…" value={form.note} onChange={set('note')} /></label>
        </div>
        <div className="form-actions">
          <button type="button" className="secondary" onClick={() => setForm(null)}>Cancel</button>
          <button className="primary" disabled={busy}>{form._id ? 'Save changes' : 'Add expense'}</button>
        </div>
      </form>}

      <div className="report-filters">
        <label className="field-label">Show<select value={mode} onChange={(e) => setMode(e.target.value)}><option value="month">Month wise</option><option value="year">Year wise</option><option value="all">All time</option></select></label>
        {mode === 'month' && <label className="field-label">Month<input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label>}
        {mode === 'year' && <label className="field-label">Year<input type="number" min="2020" max="2100" value={year} onChange={(e) => setYear(e.target.value)} /></label>}
      </div>

      {s && <div className="report-cards expense-cards">
        <div><span>Total expenses · {periodLabel}</span><b>{money(s.total)}</b></div>
        <div><span>Paid</span><b>{money(s.paid)}</b></div>
        <div><span>Pending</span><b>{money(s.pending)}</b></div>
        <div><span>Entries</span><b>{s.count}</b></div>
      </div>}

      {data?.byCategory?.length > 0 && <div className="expense-categories">
        {data.byCategory.map((c) => <span key={c.category} className="soft-count">{c.category}: {money(c.total)}</span>)}
      </div>}

      <div className="table-wrap"><table>
        <thead><tr><th>DATE</th><th>DESCRIPTION</th><th>CATEGORY</th><th>AMOUNT</th><th>STATUS</th><th>NOTE</th><th>EDIT</th><th>DELETE</th></tr></thead>
        <tbody>{(data?.expenses || []).map((e) => <tr key={e._id}>
          <td>{showDate(e.date)}</td><td><b>{e.description}</b></td><td>{e.category}</td><td><b>{money(e.amount)}</b></td>
          <td><span className={`stock-badge ${e.status === 'Pending' ? 'low' : ''}`}>{e.status}</span></td><td>{e.note || '—'}</td>
          <td><button className="secondary small-button" disabled={busy} onClick={() => setForm({ ...e, amount: String(e.amount), note: e.note || '' })}><Pencil size={14} /> Edit</button></td>
          <td><button className="secondary small-button" disabled={busy} onClick={() => remove(e)}><Trash2 size={14} /> Delete</button></td>
        </tr>)}</tbody>
        {data?.expenses?.length > 0 && <tfoot><tr className="inventory-total"><td colSpan={3}><b>Total</b></td><td><b>{money(s.total)}</b></td><td colSpan={4} /></tr></tfoot>}
      </table>
      {data && !data.expenses.length && <div className="empty-state">No expenses for {periodLabel}. Use “Add expense” to record one.</div>}
      {!data && !error && <div className="empty-state">Loading expenses…</div>}
      </div>
    </section>
  );
}
