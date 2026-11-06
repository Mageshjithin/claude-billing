const methods = ['Cash', 'UPI', 'Card', 'Bank transfer'];
export function calculatePayment(total, method, received) {
  if (!methods.includes(method)) throw new Error('Choose a valid payment method.');
  if ((typeof received !== 'number' && typeof received !== 'string') || String(received).trim() === '') throw new Error('Enter the amount received (use 0 for an unpaid bill).');
  const amount = Number(received);
  if (!Number.isFinite(amount) || amount < 0 || amount > 100000000 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.00001) throw new Error('Amount received must be a valid non-negative amount with up to two decimal places.');
  const totalCents = Math.round(total * 100);
  const receivedCents = Math.round(amount * 100);
  if (method !== 'Cash' && receivedCents > totalCents) throw new Error('For digital payments, amount received cannot exceed the bill total.');
  return { paymentMethod: method, amountReceived: receivedCents / 100, amountPaid: Math.min(totalCents, receivedCents) / 100, changeDue: Math.max(0, receivedCents - totalCents) / 100, balanceDue: Math.max(0, totalCents - receivedCents) / 100, paymentStatus: receivedCents >= totalCents ? 'Paid' : receivedCents > 0 ? 'Partially paid' : 'Unpaid' };
}
