import {test} from 'node:test';
import assert from 'node:assert/strict';
import {salesReport} from '../src/lib/salesReport.js';
const bills=Array.from({length:65},(_,i)=>({_id:String(i),invoiceNo:`JMS-${i}`,customerName:'Test',createdAt:'2026-10-25T20:00:00Z',total:10.1,subtotal:10.1,items:[{quantity:1}],...(i<40?{paymentMethod:'Cash'}:i<60?{paymentMethod:'UPI'}:i===60?{paymentMethod:'Card'}:i===61?{paymentMethod:'Bank transfer'}:{})}));
test('payment filtering precedes pagination and totals include every match',()=>{
 const r=salesReport(bills,{paymentMethod:'Cash',limit:30,page:2});
 assert.equal(r.total,40);assert.equal(r.bills.length,10);assert.equal(r.summary.sales,404);assert.equal(r.groups[0].sales,404);assert.equal(r.paymentGroups[0].sales,404);assert.ok(r.bills.every(b=>b.paymentMethod==='Cash'));
});
test('all methods, old bills, empty results and invalid input',()=>{
 const all=salesReport(bills);assert.equal(all.total,65);assert.equal(all.paymentGroups.length,5);assert.equal(all.summary.sales,656.5);
 for(const [method,count] of [['UPI',20],['Card',1],['Bank transfer',1],['Not recorded',3]])assert.equal(salesReport(bills,{paymentMethod:method}).total,count);
 assert.equal(salesReport(bills,{paymentMethod:'Cash',search:'missing'}).summary.sales,0);
 assert.throws(()=>salesReport(bills,{paymentMethod:'invalid'}),{status:400});
});
test('payment filter combines with IST day, month, year and invoice search',()=>{
 for(const [mode,period] of [['day','2026-10-26'],['month','2026-10'],['year','2026']])assert.equal(salesReport(bills,{paymentMethod:'Cash',mode,period}).total,40);
 assert.equal(salesReport(bills,{paymentMethod:'Cash',mode:'day',period:'2026-10-25'}).total,0);
 assert.equal(salesReport(bills,{paymentMethod:'UPI',search:'JMS-60'}).total,0);
 assert.equal(salesReport(bills,{paymentMethod:'Card',search:'JMS-60'}).total,1);
});
test('cancelled bills stay listed but are excluded from totals',()=>{
 const list=[{_id:'a',invoiceNo:'A',createdAt:'2026-10-25T20:00:00Z',total:100,subtotal:100,items:[{quantity:1}],paymentMethod:'Cash'},{_id:'b',invoiceNo:'B',createdAt:'2026-10-25T20:00:00Z',total:50,subtotal:50,items:[{quantity:1}],paymentMethod:'Cash',status:'Cancelled'}];
 const r=salesReport(list);assert.equal(r.total,2);assert.equal(r.summary.sales,100);assert.equal(r.summary.billCount,1);
});
