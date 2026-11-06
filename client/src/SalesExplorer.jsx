import { paymentStatus } from './PaymentDetails.jsx';
import { useEffect, useState } from 'react';
const money = n => new Intl.NumberFormat('en-IN', {style:'currency',currency:'INR'}).format(Number(n)||0);
const today = () => new Date(Date.now()+330*60000).toISOString().slice(0,10);
const dateTime = value => new Date(value).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'});
export default function SalesExplorer({reports, request, onSelect}) {
  const [mode,setMode]=useState(reports?'day':'all');
  const [date,setDate]=useState(today());
  const [month,setMonth]=useState(today().slice(0,7));
  const [year,setYear]=useState(today().slice(0,4));
  const [paymentMethod,setPaymentMethod]=useState('all');
  const [search,setSearch]=useState('');
  const [page,setPage]=useState(1);
  const [data,setData]=useState(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [refresh,setRefresh]=useState(0);
  const period=mode==='day'?date:mode==='month'?month:mode==='year'?year:'';
  useEffect(()=>{
    let active=true;setLoading(true);setError('');setData(null);
    const timer=setTimeout(()=>{
      const params=new URLSearchParams({mode,period,search,paymentMethod,page:String(page),limit:'30'});
      request(`/bills?${params}`).then(result=>{if(active)setData(result);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});
    },200);
    return ()=>{active=false;clearTimeout(timer);};
  },[mode,period,search,paymentMethod,page,refresh,request]);
  function changeMode(value){setMode(value);setPage(1);}
  return <section className="panel sales-explorer">
    <div className="panel-heading"><div><h3>{reports?'Sales reports':'All bill history'}</h3><p>All saved bills · Dates and times in IST · Click a bill to view or reprint</p></div><button className="secondary" onClick={()=>setRefresh(n=>n+1)} disabled={loading}>Refresh</button></div>
    <div className="report-filters">
      <label className="field-label">Period<select aria-label="Report period" value={mode} onChange={e=>changeMode(e.target.value)}><option value="day">Day wise</option><option value="month">Month wise</option><option value="year">Year wise</option><option value="all">All time</option></select></label>
      {mode==='day'&&<label className="field-label">Date<input type="date" value={date} onChange={e=>{setDate(e.target.value);setPage(1);}}/></label>}
      {mode==='month'&&<label className="field-label">Month<input type="month" value={month} onChange={e=>{setMonth(e.target.value);setPage(1);}}/></label>}
      {mode==='year'&&<label className="field-label">Year<input type="number" min="1900" max="9999" value={year} onChange={e=>{setYear(e.target.value);setPage(1);}}/></label>}
      <label className="field-label">Payment method<select aria-label="Filter by payment method" value={paymentMethod} onChange={e=>{setPaymentMethod(e.target.value);setPage(1);}}><option value="all">All payment methods</option>{['Cash','UPI','Card','Bank transfer','Not recorded'].map(method=><option key={method} value={method}>{method}</option>)}</select></label>
      <label className="field-label report-search">Find a bill<input value={search} placeholder="Invoice number, customer name or phone" onChange={e=>{setSearch(e.target.value);setPage(1);}}/></label>
    </div>
    {loading&&<p role="status">Loading sales and bills…</p>}
    {error&&<div role="alert" className="alert error">{error}</div>}
    {!loading&&data&&<>
      <div className="report-cards">
        <div><span>Total sales</span><strong>{money(data.summary.sales)}</strong><small>After discount, including GST</small></div>
        <div><span>Bills</span><strong>{data.summary.billCount}</strong><small>{data.summary.items} items sold</small></div>
        <div><span>Discount</span><strong>{money(data.summary.discount)}</strong><small>Subtotal {money(data.summary.subtotal)}</small></div>
        <div><span>GST collected</span><strong>{money(data.summary.tax)}</strong><small>Totals for the selected filters</small></div>
      </div>
      {reports&&data.paymentGroups?.length>0&&<><h3 className="report-bills-title">Sales by payment method</h3><div className="table-wrap report-breakdown"><table><thead><tr><th>PAYMENT METHOD</th><th>BILLS</th><th>SALES</th></tr></thead><tbody>{data.paymentGroups.map(group=><tr key={group.paymentMethod}><td>{group.paymentMethod}</td><td>{group.billCount}</td><td>{money(group.sales)}</td></tr>)}</tbody></table></div></>}
      {reports&&data.groups.length>0&&<div className="table-wrap report-breakdown"><table><thead><tr><th>{mode==='year'?'MONTH':mode==='all'?'YEAR':'DATE'}</th><th>BILLS</th><th>ITEMS</th><th>DISCOUNT</th><th>GST</th><th>SALES</th></tr></thead><tbody>{data.groups.map(g=><tr key={g.period}><td>{g.period}</td><td>{g.billCount}</td><td>{g.items}</td><td>{money(g.discount)}</td><td>{money(g.tax)}</td><td><b>{money(g.sales)}</b></td></tr>)}</tbody></table></div>}
      <h3 className="report-bills-title">Bills {data.total>0&&`(${data.total})`}</h3>
      <div className="table-wrap"><table><thead><tr><th>INVOICE</th><th>CUSTOMER</th><th>DATE & TIME (IST)</th><th>ITEMS</th><th>TOTAL</th><th>PAYMENT METHOD</th><th>RECEIVED</th><th>CHANGE</th><th>BALANCE DUE</th><th>STATUS</th></tr></thead><tbody>{data.bills.map(b=><tr key={b._id}><td><button className="text-button" onClick={()=>onSelect(b)}>{b.invoiceNo}</button></td><td>{b.customerName||'Walk-in customer'}<small className="table-sub">{b.customerPhone}</small></td><td>{dateTime(b.createdAt)}</td><td>{(b.items||[]).reduce((n,i)=>n+Number(i.quantity||0),0)}</td><td><b>{money(b.total)}</b></td><td>{b.paymentMethod || 'Not recorded'}</td><td>{b.paymentMethod ? money(b.amountReceived) : '—'}</td><td>{b.paymentMethod ? money(b.changeDue) : '—'}</td><td>{b.paymentMethod ? money(b.balanceDue) : '—'}</td><td>{paymentStatus(b)}</td></tr>)}</tbody></table></div>
      {!data.total&&<div className="empty-state">No bills match these filters. Try All time or All payment methods to find other bills.</div>}
      <div className="report-pagination"><button className="secondary" disabled={data.page<=1} onClick={()=>setPage(data.page-1)}>Previous</button><span>Page {data.page} of {data.totalPages} · {data.total} bills</span><button className="secondary" disabled={data.page>=data.totalPages} onClick={()=>setPage(data.page+1)}>Next</button></div>
    </>}
  </section>;
}
