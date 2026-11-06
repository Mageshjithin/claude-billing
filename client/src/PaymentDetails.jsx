export const paymentStatus = bill => bill.status === 'Cancelled' ? 'Cancelled' : bill.paymentMethod ? bill.paymentStatus : 'Not recorded';
const money = n => new Intl.NumberFormat('en-IN', {style:'currency', currency:'INR'}).format(Number(n || 0));
export default function PaymentDetails({ bill }) {
  if (!bill.paymentMethod) return <div><span>Payment details</span><b>Not recorded</b></div>;
  return <>
    <div><span>Payment method</span><b>{bill.paymentMethod}</b></div>
    <div><span>{bill.paymentMethod === 'Cash' ? 'Cash received' : 'Amount received'}</span><b>{money(bill.amountReceived)}</b></div>
    {bill.paymentMethod === 'Cash' && <div><span>Change to return</span><b>{money(bill.changeDue)}</b></div>}
    <div><span>Balance due</span><b>{money(bill.balanceDue)}</b></div>
    <div><span>Payment status</span><b>{paymentStatus(bill)}</b></div>
  </>;
}
