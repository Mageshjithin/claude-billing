import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { calculatePayment } from '../src/lib/payment.js';

test('cash, digital, partial, unpaid and rounding calculations', () => {
  assert.deepEqual(calculatePayment(850, 'Cash', 1000), {paymentMethod:'Cash',amountReceived:1000,amountPaid:850,changeDue:150,balanceDue:0,paymentStatus:'Paid'});
  assert.equal(calculatePayment(850, 'Cash', 800).balanceDue, 50);
  assert.equal(calculatePayment(850, 'Cash', 800).paymentStatus, 'Partially paid');
  assert.equal(calculatePayment(850, 'Cash', 0).paymentStatus, 'Unpaid');
  assert.equal(calculatePayment(0, 'Cash', 0).paymentStatus, 'Paid');
  assert.equal(calculatePayment(10.10, 'Cash', 20).changeDue, 9.9);
  for (const method of ['UPI', 'Card', 'Bank transfer']) {
    assert.equal(calculatePayment(850, method, 850).paymentStatus, 'Paid');
    assert.equal(calculatePayment(850, method, 800).balanceDue, 50);
    assert.throws(() => calculatePayment(850, method, 1000));
  }
  for (const value of ['', ' ', null, undefined, true, [], {}, -1, Infinity, 'abc', 1.234, 100000001]) assert.throws(() => calculatePayment(850, 'Cash', value));
  assert.throws(() => calculatePayment(850, 'Other', 850));
});

test('bill API persists payment, preserves history and rolls back invalid requests', async () => {
  const state = {products:[{_id:'p1',name:'Kurti',sku:'K1',price:850,stock:20,active:true}],bills:[]};
  globalThis.paymentTestStore = state;
  const hooks = registerHooks({resolve(specifier, context, next) {
    if (specifier === '../db.js' && context.parentURL.endsWith('/routes/bills.js')) return {url:'data:text/javascript,'+encodeURIComponent(`export const loadData = async () => globalThis.paymentTestStore; export const httpError = (status,message) => Object.assign(new Error(message),{status}); export const transaction = async fn => { const draft=structuredClone(globalThis.paymentTestStore); const result=await fn(draft); Object.assign(globalThis.paymentTestStore,draft); return result; };`),shortCircuit:true};
    return next(specifier,context);
  }});
  const express = (await import('express')).default;
  const router = (await import('../src/routes/bills.js')).default;
  const app=express();app.use(express.json());app.use('/bills',router);app.use((err,req,res,next)=>res.status(err.status||500).json({message:err.message}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${server.address().port}/bills`;
  const post=async payment=>{const res=await fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:[{productId:'p1',quantity:1}],...payment})});return {status:res.status,data:await res.json()};};
  try {
    const cash=await post({paymentMethod:'Cash',amountReceived:1000});assert.equal(cash.status,201);assert.equal(cash.data.bill.changeDue,150);assert.equal(state.products[0].stock,19);
    const partial=await post({paymentMethod:'UPI',amountReceived:800});assert.equal(partial.status,201);assert.equal(partial.data.bill.balanceDue,50);assert.equal(partial.data.bill.paymentStatus,'Partially paid');
    for (const payment of [{},{paymentMethod:'Cash',amountReceived:-1},{paymentMethod:'UPI',amountReceived:1000},{paymentMethod:'invalid',amountReceived:850}]) {const before=structuredClone(state);assert.equal((await post(payment)).status,400);assert.deepEqual(state,before);}
    const bills=(await (await fetch(base)).json()).bills;assert.equal(bills.length,2);assert.equal(bills.find(b=>b.paymentMethod==='Cash').changeDue,150);assert.equal(bills.find(b=>b.paymentMethod==='UPI').balanceDue,50);
    const stockBefore = structuredClone(state.products);
    const manual = await post({ billingMode: 'manual', items: [{ name: 'Manual saree', quantity: 2, rate: 650 }], discount: 100, paymentMethod: 'Cash', amountReceived: 1500 });
    assert.equal(manual.status, 201);assert.equal(manual.data.bill.billingMode, 'manual');assert.equal(manual.data.bill.total, 1200);assert.equal(manual.data.bill.changeDue, 300);assert.deepEqual(manual.data.remainingStock, []);assert.deepEqual(state.products, stockBefore);
    for (const items of [[{name:'',quantity:1,rate:10}], [{name:'Item',quantity:0,rate:10}], [{name:'Item',quantity:1,rate:-1}]]) {
      const before = structuredClone(state);
      assert.equal((await post({billingMode:'manual',items,paymentMethod:'Cash',amountReceived:1000})).status,400);assert.deepEqual(state,before);
    }
    assert.equal((await post({billingMode:'unknown',paymentMethod:'Cash',amountReceived:850})).status,400);
    const history=(await (await fetch(base)).json()).bills;assert.equal(history.length,3);assert.equal(history.find(b=>b.billingMode==='manual').items[0].name,'Manual saree');
  } finally {server.close();hooks.deregister();delete globalThis.paymentTestStore;}
});

