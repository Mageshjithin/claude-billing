const invalid = message => Object.assign(new Error(message), { status: 400 });

export function manualItems(requested) {
  if (!Array.isArray(requested) || !requested.length || requested.length > 100) {
    throw invalid('Add between 1 and 100 manual items.');
  }
  return requested.map(item => {
    if (!item || typeof item.name !== 'string' || !item.name.trim() || item.name.trim().length > 120) {
      throw invalid('Each manual item needs a name of up to 120 characters.');
    }
    const numeric = value => ['number', 'string'].includes(typeof value) && String(value).trim() !== '';
    const quantity = Number(item.quantity);
    const unitPrice = Number(item.rate);
    if (!numeric(item.quantity) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000000) {
      throw invalid('Manual item quantity must be a whole number between 1 and 1000000.');
    }
    if (!numeric(item.rate) || !Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 100000000 || Math.abs(unitPrice * 100 - Math.round(unitPrice * 100)) > 0.00001) {
      throw invalid('Manual item rate must be a non-negative amount with up to two decimal places.');
    }
    const lineCents = Math.round(unitPrice * 100) * quantity;
    if (!Number.isSafeInteger(lineCents) || lineCents > 10000000000) throw invalid('Manual item amount is too large.');
    return { name: item.name.trim(), quantity, unitPrice: Math.round(unitPrice * 100) / 100, lineTotal: lineCents / 100 };
  });
}
