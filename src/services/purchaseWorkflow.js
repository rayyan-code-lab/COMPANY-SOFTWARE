import { sdk } from '@/services/sdk';

const { eq } = window.ApperSDK.CoreSDK;

export const PURCHASE_FIELDS = [
  'Name',
  'purchaseRef_c',
  'stockItem_c',
  'quantityKg_c',
  'pricePerKg_c',
  'totalPurchaseValue_c',
  'purchaseDate_c',
  'supplierName_c',
  'notes_c',
  'advanceAmount_c',
  'advanceDate_c',
  'advanceMethod_c',
  'cashAtPurchase_c',
  'onlineAtPurchase_c',
  'totalPaid_c',
  'outstandingBalance_c',
  'paymentStatus_c',
  'recordStatus_c',
  'revision_c',
  'idempotencyKey_c',
  'cancellationReason_c',
  'cancelledAt_c',
];

export const PAYMENT_FIELDS = [
  'Name',
  'paymentRef_c',
  'purchase_c',
  'paymentType_c',
  'paymentMethod_c',
  'amount_c',
  'paymentDate_c',
  'reference_c',
  'notes_c',
  'idempotencyKey_c',
];

export const STOCK_ITEM_FIELDS = [
  'Name',
  'itemCode_c',
  'unit_c',
  'status_c',
  'notes_c',
];

export const MOVEMENT_FIELDS = [
  'Name',
  'movementType_c',
  'weightKg_c',
  'unitPrice_c',
  'totalValue_c',
  'movementDate_c',
  'supplierOrReason_c',
  'notes_c',
  'stockItem_c',
  'purchase_c',
  'purchaseId_c',
  'movementKey_c',
];

export const AUDIT_FIELDS = [
  'Name',
  'auditKey_c',
  'purchase_c',
  'action_c',
  'summary_c',
  'eventAt_c',
];

export const money = (value) => Number(value ?? 0);

export function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function formatInr(value) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0));
}

export function newIdempotencyKey(prefix = 'PUR') {
  const random = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()
    : (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).toUpperCase();

  return prefix + ':' + random;
}

export function newPurchaseReference(purchaseDate) {
  const datePart = String(purchaseDate || new Date().toISOString().slice(0, 10)).replaceAll('-', '');
  return 'PUR-' + datePart + '-' + newIdempotencyKey('REF').slice(-6);
}

export function getPurchaseTotals(purchase, payments = []) {
  const advance = money(purchase.advanceAmount_c);
  const cashAtPurchase = money(purchase.cashAtPurchase_c);
  const onlineAtPurchase = money(purchase.onlineAtPurchase_c);
  const laterPayments = payments.reduce((sum, payment) => sum + money(payment.amount_c), 0);
  const totalPaid = roundMoney(advance + cashAtPurchase + onlineAtPurchase + laterPayments);
  const totalValue = roundMoney(money(purchase.totalPurchaseValue_c));
  const outstanding = roundMoney(Math.max(0, totalValue - totalPaid));
  const advanceIsCash = purchase.advanceMethod_c === 'Cash';
  const laterCash = payments
    .filter((payment) => payment.paymentMethod_c === 'Cash')
    .reduce((sum, payment) => sum + money(payment.amount_c), 0);
  const laterOnline = payments
    .filter((payment) => payment.paymentMethod_c !== 'Cash')
    .reduce((sum, payment) => sum + money(payment.amount_c), 0);
  const cashPaid = roundMoney(cashAtPurchase + (advanceIsCash ? advance : 0) + laterCash);
  const onlinePaid = roundMoney(onlineAtPurchase + (advanceIsCash ? 0 : advance) + laterOnline);
  const paymentStatus = totalPaid <= 0
    ? 'Unpaid'
    : totalPaid >= totalValue - 0.005
      ? 'Paid'
      : 'Partially Paid';

  return {
    totalValue,
    totalPaid,
    outstanding,
    cashPaid,
    onlinePaid,
    paymentStatus,
    laterPayments,
  };
}

export function validatePurchaseInput(input) {
  const quantity = Number(input.quantityKg_c);
  const price = Number(input.pricePerKg_c);
  const advance = Number(input.advanceAmount_c || 0);
  const cash = Number(input.cashAtPurchase_c || 0);
  const online = Number(input.onlineAtPurchase_c || 0);

  if (!input.stockItem_c) throw new Error('Select a stock item.');
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('Quantity must be greater than zero kilograms.');
  }
  if (!Number.isFinite(price) || price < 0) {
    throw new Error('Price per kilogram cannot be negative.');
  }
  for (const [label, amount] of [
    ['Advance payment', advance],
    ['Cash payment', cash],
    ['Online payment', online],
  ]) {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error(label + ' cannot be negative.');
    }
  }
  if (!input.purchaseDate_c) throw new Error('Choose the actual purchase date.');
  if (advance > 0 && !input.advanceMethod_c) {
    throw new Error('Choose how the advance was paid.');
  }

  const total = roundMoney(quantity * price);
  const paid = roundMoney(advance + cash + online);

  if (paid > total + 0.005) {
    throw new Error('Advance plus cash and online payments cannot exceed the purchase total.');
  }

  return {
    quantity,
    price,
    total,
    advance,
    cash,
    online,
    paid,
    outstanding: roundMoney(Math.max(0, total - paid)),
    status: paid <= 0 ? 'Unpaid' : paid >= total - 0.005 ? 'Paid' : 'Partially Paid',
  };
}

async function fetchByKey(table, fields, keyField, key) {
  const response = await sdk.table(table)
    .select(fields)
    .where(eq(keyField, key))
    .page(1, 10)
    .fetch();

  if (!response.success) {
    throw new Error(response.message || 'Could not verify the existing record.');
  }

  return response.data ?? [];
}

async function writeAudit(purchase, auditKey, action, summary) {
  const existing = await fetchByKey('purchase_audit_c', AUDIT_FIELDS, 'auditKey_c', auditKey);
  if (existing.length) return existing[0];

  const response = await sdk.table('purchase_audit_c').create({
    Name: auditKey,
    auditKey_c: auditKey,
    purchase_c: purchase.Id,
    action_c: action,
    summary_c: summary,
    eventAt_c: new Date().toISOString(),
  });

  if (!response.data?.length) {
    throw new Error(response.messages?.[0] || 'The audit entry could not be saved.');
  }

  return response.data[0];
}

export async function getStockItems(includeInactive = false) {
  const response = await sdk.table('stock_items_c')
    .select(STOCK_ITEM_FIELDS)
    .orderBy('Name')
    .page(1, 100)
    .fetch();

  if (!response.success) throw new Error(response.message || 'Could not load the stock catalogue.');
  const records = response.data ?? [];
  return includeInactive ? records : records.filter((item) => item.status_c === 'Active');
}

export async function createStockItem(name) {
  const cleanName = String(name ?? '').trim();
  if (!cleanName) throw new Error('Enter a stock item name.');

  const existing = await fetchByKey('stock_items_c', ['Name', 'itemCode_c'], 'Name', cleanName);
  if (existing.length) return existing[0];

  const items = await getStockItems(true);
  const nextNumber = items.length + 1;
  const response = await sdk.table('stock_items_c').create({
    Name: cleanName,
    itemCode_c: 'STK-' + String(nextNumber).padStart(3, '0'),
    unit_c: 'kg',
    status_c: 'Active',
    notes_c: 'Added from Purchase Management.',
  });

  if (!response.data?.length) {
    throw new Error(response.messages?.[0] || 'Could not create the stock item.');
  }

  return response.data[0];
}

export async function getPurchases() {
  const response = await sdk.table('purchases_c')
    .select(PURCHASE_FIELDS)
    .orderByDesc('purchaseDate_c')
    .page(1, 100)
    .fetch();

  if (!response.success) throw new Error(response.message || 'Could not load purchases.');
  return response.data ?? [];
}

export async function getPaymentsForPurchase(purchaseId) {
  const response = await sdk.table('purchase_payments_c')
    .select(PAYMENT_FIELDS)
    .where(eq('purchase_c', purchaseId))
    .orderByDesc('paymentDate_c')
    .page(1, 100)
    .fetch();

  if (!response.success) throw new Error(response.message || 'Could not load purchase payments.');
  return response.data ?? [];
}

export async function getAllPurchasePayments() {
  const response = await sdk.table('purchase_payments_c')
    .select(PAYMENT_FIELDS)
    .orderByDesc('paymentDate_c')
    .page(1, 100)
    .fetch();

  if (!response.success) throw new Error(response.message || 'Could not load purchase payment summaries.');
  return response.data ?? [];
}

export async function getPurchaseAudit(purchaseId) {
  const response = await sdk.table('purchase_audit_c')
    .select(AUDIT_FIELDS)
    .where(eq('purchase_c', purchaseId))
    .orderByDesc('eventAt_c')
    .page(1, 100)
    .fetch();

  if (!response.success) throw new Error(response.message || 'Could not load the audit history.');
  return response.data ?? [];
}

export async function repairPurchaseStockMovement(purchase) {
  const movement = await ensurePurchaseStockMovement(purchase);
  if (movement) {
    await writeAudit(
      purchase,
      'REPAIR:' + purchase.Id,
      'Inventory Repaired',
      'Verified or repaired the linked stock-in movement for ' + purchase.purchaseRef_c + '.'
    );
  }
  return movement;
}

export async function getPurchaseById(id) {
  const response = await sdk.table('purchases_c').select(PURCHASE_FIELDS).get(id);
  if (!response.success) return null;
  return response.data;
}

export async function getMovementsForPurchase(purchaseId) {
  const response = await sdk.table('stock_movements_c')
    .select(MOVEMENT_FIELDS)
    .where(eq('purchase_c', purchaseId))
    .page(1, 100)
    .fetch();

  if (!response.success) throw new Error(response.message || 'Could not verify the linked inventory movement.');
  return response.data ?? [];
}

export async function ensurePurchaseStockMovement(purchase) {
  if (!purchase || purchase.recordStatus_c === 'Cancelled') return null;

  const movementKey = 'PURCHASE:' + purchase.Id;
  const existing = await fetchByKey('stock_movements_c', MOVEMENT_FIELDS, 'movementKey_c', movementKey);
  if (existing.length) return existing[0];

  const response = await sdk.table('stock_movements_c').create({
    Name: 'Purchase stock-in · ' + purchase.purchaseRef_c,
    movementType_c: 'Stock In',
    weightKg_c: money(purchase.quantityKg_c),
    unitPrice_c: money(purchase.pricePerKg_c),
    totalValue_c: money(purchase.totalPurchaseValue_c),
    movementDate_c: purchase.purchaseDate_c,
    supplierOrReason_c: purchase.supplierName_c || '',
    notes_c: 'Stock-in linked to purchase ' + purchase.purchaseRef_c + '. ' + (purchase.notes_c || ''),
    stockItem_c: purchase.stockItem_c?.Id ?? purchase.stockItem_c,
    purchase_c: purchase.Id,
    purchaseId_c: purchase.purchaseRef_c,
    movementKey_c: movementKey,
  });

  if (!response.data?.length) {
    throw new Error(response.messages?.[0] || 'Purchase saved, but the stock-in movement could not be created.');
  }

  return response.data[0];
}

export async function createPurchase(input, idempotencyKey) {
  const totals = validatePurchaseInput(input);
  const existing = await fetchByKey('purchases_c', PURCHASE_FIELDS, 'idempotencyKey_c', idempotencyKey);

  if (existing.length) {
    const existingPurchase = existing[0];
    await ensurePurchaseStockMovement(existingPurchase);
    await writeAudit(existingPurchase, 'CREATE:' + existingPurchase.Id, 'Created', 'Purchase submission retry checked; inventory link verified.');
    return existingPurchase;
  }

  const purchaseRef = newPurchaseReference(input.purchaseDate_c);
  const payload = {
    Name: purchaseRef,
    purchaseRef_c: purchaseRef,
    stockItem_c: input.stockItem_c,
    quantityKg_c: totals.quantity,
    pricePerKg_c: totals.price,
    totalPurchaseValue_c: totals.total,
    purchaseDate_c: input.purchaseDate_c,
    supplierName_c: String(input.supplierName_c ?? '').trim(),
    notes_c: String(input.notes_c ?? '').trim(),
    advanceAmount_c: totals.advance,
    advanceDate_c: input.advanceDate_c || input.purchaseDate_c,
    advanceMethod_c: totals.advance > 0 ? input.advanceMethod_c : 'Cash',
    cashAtPurchase_c: totals.cash,
    onlineAtPurchase_c: totals.online,
    totalPaid_c: totals.paid,
    outstandingBalance_c: totals.outstanding,
    paymentStatus_c: totals.status,
    recordStatus_c: 'Active',
    revision_c: 1,
    idempotencyKey_c: idempotencyKey,
    cancellationReason_c: '',
    cancelledAt_c: null,
  };

  const response = await sdk.table('purchases_c').create(payload);
  if (!response.data?.length) {
    throw new Error(response.messages?.[0] || 'Purchase could not be saved.');
  }

  const purchase = response.data[0];

  try {
    await ensurePurchaseStockMovement(purchase);
    await writeAudit(purchase, 'CREATE:' + purchase.Id, 'Created', 'Purchase created. Initial paid amount: ' + formatInr(totals.paid) + '. Stock-in movement linked.');
  } catch (error) {
    error.purchaseId = purchase.Id;
    error.purchaseRef = purchase.purchaseRef_c;
    throw error;
  }

  return purchase;
}

export async function computeCurrentStock(stockItemId) {
  const response = await sdk.table('stock_movements_c')
    .select(MOVEMENT_FIELDS)
    .where(eq('stockItem_c', stockItemId))
    .page(1, 100)
    .fetch();

  if (!response.success) throw new Error(response.message || 'Could not calculate item stock.');
  return (response.data ?? []).reduce((balance, row) => {
    const weight = money(row.weightKg_c);
    if (row.movementType_c === 'Stock Out') return balance - Math.abs(weight);
    if (row.movementType_c === 'Stock In') return balance + Math.abs(weight);
    return balance + weight;
  }, 0);
}

export async function addPurchasePayment(purchaseId, input, idempotencyKey) {
  const existing = await fetchByKey('purchase_payments_c', PAYMENT_FIELDS, 'idempotencyKey_c', idempotencyKey);
  if (existing.length) return { payment: existing[0], duplicate: true };

  const purchase = await getPurchaseById(purchaseId);
  if (!purchase) throw new Error('Purchase not found.');
  if (purchase.recordStatus_c !== 'Active') throw new Error('Payments cannot be added to a cancelled purchase.');

  const amount = roundMoney(Number(input.amount_c));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Payment must be greater than ₹0.00.');

  const payments = await getPaymentsForPurchase(purchaseId);
  const totals = getPurchaseTotals(purchase, payments);
  if (amount > totals.outstanding + 0.005) {
    throw new Error('Payment exceeds the outstanding balance of ' + formatInr(totals.outstanding) + '.');
  }
  if (!input.paymentMethod_c) throw new Error('Choose a payment method.');
  if (!input.paymentDate_c) throw new Error('Choose a payment date.');

  const paymentRef = 'PAY-' + input.paymentDate_c.replaceAll('-', '') + '-' + newIdempotencyKey('PAY').slice(-6);
  const response = await sdk.table('purchase_payments_c').create({
    Name: paymentRef,
    paymentRef_c: paymentRef,
    purchase_c: purchaseId,
    paymentType_c: 'Subsequent Payment',
    paymentMethod_c: input.paymentMethod_c,
    amount_c: amount,
    paymentDate_c: input.paymentDate_c,
    reference_c: String(input.reference_c ?? '').trim(),
    notes_c: String(input.notes_c ?? '').trim(),
    idempotencyKey_c: idempotencyKey,
  });

  if (!response.data?.length) {
    throw new Error(response.messages?.[0] || 'Payment could not be saved.');
  }

  const payment = response.data[0];
  const allPayments = [...payments, payment];
  const updatedTotals = getPurchaseTotals(purchase, allPayments);
  let summarySynced = true;

  const summaryUpdate = await sdk.table('purchases_c').update({
    Id: purchase.Id,
    totalPaid_c: updatedTotals.totalPaid,
    outstandingBalance_c: updatedTotals.outstanding,
    paymentStatus_c: updatedTotals.paymentStatus,
  });

  if (!summaryUpdate.data?.length) summarySynced = false;

  try {
    await writeAudit(
      purchase,
      'PAYMENT:' + payment.Id,
      'Payment Added',
      'Payment ' + paymentRef + ' recorded for ' + formatInr(amount) + ' by ' + input.paymentMethod_c + '.'
    );
  } catch {
    summarySynced = false;
  }

  return { payment, summarySynced, duplicate: false, totals: updatedTotals };
}

async function getAllItemMovements(stockItemId) {
  const response = await sdk.table('stock_movements_c')
    .select(MOVEMENT_FIELDS)
    .where(eq('stockItem_c', stockItemId))
    .page(1, 100)
    .fetch();

  if (!response.success) throw new Error(response.message || 'Could not verify available stock.');
  return response.data ?? [];
}

async function ensureAdjustment(purchase, movementKey, weightDelta, unitPrice, date, reason) {
  const existing = await fetchByKey('stock_movements_c', MOVEMENT_FIELDS, 'movementKey_c', movementKey);
  if (existing.length) return existing[0];
  if (Math.abs(weightDelta) < 0.0005) return null;

  const response = await sdk.table('stock_movements_c').create({
    Name: reason + ' · ' + purchase.purchaseRef_c,
    movementType_c: 'Adjustment',
    weightKg_c: roundMoney(weightDelta),
    unitPrice_c: money(unitPrice),
    totalValue_c: roundMoney(Math.abs(weightDelta) * money(unitPrice)),
    movementDate_c: date,
    supplierOrReason_c: purchase.supplierName_c || 'Purchase adjustment',
    notes_c: reason + ' for ' + purchase.purchaseRef_c + '. This is an auditable balance adjustment.',
    stockItem_c: purchase.stockItem_c?.Id ?? purchase.stockItem_c,
    purchase_c: purchase.Id,
    purchaseId_c: purchase.purchaseRef_c,
    movementKey_c: movementKey,
  });

  if (!response.data?.length) {
    throw new Error(response.messages?.[0] || 'The inventory adjustment could not be recorded.');
  }

  return response.data[0];
}

export async function editPurchase(purchaseId, input) {
  const purchase = await getPurchaseById(purchaseId);
  if (!purchase) throw new Error('Purchase not found.');
  if (purchase.recordStatus_c !== 'Active') throw new Error('Cancelled purchases cannot be edited.');

  const totals = validatePurchaseInput({
    ...input,
    stockItem_c: purchase.stockItem_c?.Id ?? purchase.stockItem_c,
  });

  const payments = await getPaymentsForPurchase(purchaseId);
  const laterPaid = payments.reduce((sum, payment) => sum + money(payment.amount_c), 0);
  const revisedPaid = roundMoney(totals.paid + laterPaid);
  if (revisedPaid > totals.total + 0.005) {
    throw new Error('The new purchase total is below the revised initial payments plus later payments. Record a refund or adjust payments first.');
  }

  const oldQuantity = money(purchase.quantityKg_c);
  const delta = roundMoney(totals.quantity - oldQuantity);
  const nextRevision = Number(purchase.revision_c ?? 1) + 1;

  if (Math.abs(delta) >= 0.0005) {
    const movements = await getAllItemMovements(purchase.stockItem_c?.Id ?? purchase.stockItem_c);
    const balance = movements.reduce((total, row) => {
      const weight = money(row.weightKg_c);
      if (row.movementType_c === 'Stock Out') return total - Math.abs(weight);
      if (row.movementType_c === 'Stock In') return total + Math.abs(weight);
      return total + weight;
    }, 0);

    if (balance + delta < -0.005) {
      throw new Error('This quantity reduction would make stock negative. Reconcile dispatches before editing the purchase.');
    }

    await ensureAdjustment(
      purchase,
      'EDIT:' + purchase.Id + ':' + nextRevision,
      delta,
      totals.price,
      input.purchaseDate_c,
      'Purchase quantity edit'
    );
  }

  const previousSummary = 'kg=' + oldQuantity + ', price=' + money(purchase.pricePerKg_c) + ', total=' + money(purchase.totalPurchaseValue_c);
  const nextSummary = 'kg=' + totals.quantity + ', price=' + totals.price + ', total=' + totals.total;

  const response = await sdk.table('purchases_c').update({
    Id: purchase.Id,
    quantityKg_c: totals.quantity,
    pricePerKg_c: totals.price,
    totalPurchaseValue_c: totals.total,
    purchaseDate_c: input.purchaseDate_c,
    supplierName_c: String(input.supplierName_c ?? '').trim(),
    notes_c: String(input.notes_c ?? '').trim(),
    advanceAmount_c: totals.advance,
    advanceDate_c: input.advanceDate_c || input.purchaseDate_c,
    advanceMethod_c: totals.advance > 0 ? input.advanceMethod_c : 'Cash',
    cashAtPurchase_c: totals.cash,
    onlineAtPurchase_c: totals.online,
    totalPaid_c: revisedPaid,
    outstandingBalance_c: roundMoney(totals.total - revisedPaid),
    paymentStatus_c: revisedPaid <= 0 ? 'Unpaid' : revisedPaid >= totals.total - 0.005 ? 'Paid' : 'Partially Paid',
    revision_c: nextRevision,
  });

  if (!response.data?.length) {
    throw new Error(response.messages?.[0] || 'Purchase details could not be updated. Retry after reviewing the movement history.');
  }

  await writeAudit(
    purchase,
    'EDIT:' + purchase.Id + ':' + nextRevision,
    'Edited',
    'Purchase edited. Before: ' + previousSummary + '. After: ' + nextSummary + '. Stock balance adjusted by ' + delta + ' kg.'
  );

  return response.data[0];
}

export async function cancelPurchase(purchaseId, reason) {
  const purchase = await getPurchaseById(purchaseId);
  if (!purchase) throw new Error('Purchase not found.');
  if (purchase.recordStatus_c === 'Cancelled') return purchase;

  const cleanedReason = String(reason ?? '').trim();
  if (!cleanedReason) throw new Error('Enter a cancellation reason.');

  const reversalKey = 'CANCEL:' + purchase.Id;
  const priorReversal = await fetchByKey('stock_movements_c', MOVEMENT_FIELDS, 'movementKey_c', reversalKey);

  if (!priorReversal.length) {
    const movements = await getAllItemMovements(purchase.stockItem_c?.Id ?? purchase.stockItem_c);
    const currentBalance = movements.reduce((total, row) => {
      const weight = money(row.weightKg_c);
      if (row.movementType_c === 'Stock Out') return total - Math.abs(weight);
      if (row.movementType_c === 'Stock In') return total + Math.abs(weight);
      return total + weight;
    }, 0);

    if (currentBalance - money(purchase.quantityKg_c) < -0.005) {
      throw new Error('Not enough stock remains to reverse this purchase safely. Reconcile current stock before cancelling it.');
    }

    await ensureAdjustment(
      purchase,
      reversalKey,
      -money(purchase.quantityKg_c),
      money(purchase.pricePerKg_c),
      new Date().toISOString().slice(0, 10),
      'Purchase cancellation reversal'
    );
  }

  const now = new Date().toISOString();
  const response = await sdk.table('purchases_c').update({
    Id: purchase.Id,
    recordStatus_c: 'Cancelled',
    cancellationReason_c: cleanedReason,
    cancelledAt_c: now,
    revision_c: Number(purchase.revision_c ?? 1) + 1,
  });

  if (!response.data?.length) {
    throw new Error(response.messages?.[0] || 'The stock reversal was recorded, but the purchase status still needs retrying from this page.');
  }

  await writeAudit(
    purchase,
    'CANCEL:' + purchase.Id,
    'Cancelled',
    'Purchase cancelled. Stock reversal: -' + money(purchase.quantityKg_c) + ' kg. Reason: ' + cleanedReason
  );

  return response.data[0];
}
