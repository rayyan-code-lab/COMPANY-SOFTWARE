/**
 * SimpleFinanceModule.jsx
 *
 * Handles two "kinds": 'sales' and 'expenses'.
 *
 * Changes vs original:
 *  SALES FORM:
 *   - Auto-generated Sales ID (SAL-YYYYMMDD-XXXXXXXX) stored in Name field.
 *   - Removed manual description input and manual amount input.
 *   - Quantity (kg) and Rate per kg are required; Total = qty × rate, read-only.
 *
 *  EXPENSES FORM:
 *   - Removed Category (category_c) and Paid To (paidTo_c) fields from UI.
 *     DB columns are preserved; historical data is unaffected.
 *   - Added optional receipt / photo upload (JPG, JPEG, PNG, WebP) via existing
 *     FilePicker + sdk.storage, stored in receipt_c field.
 *
 *  LIST (both):
 *   - Monthly / Weekly / Daily period filter with previous/next navigation.
 *   - Defaults to current-month view on first open.
 *   - Summaries (total amount, record count) are derived from filtered rows only.
 *   - Existing search, sorting, and register columns are preserved.
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { sdk } from '@/services/sdk';
import { useFetch } from '@/hooks/useFetch';
import { useProfile } from '@/hooks/useProfile';
import { getTableAccess } from '@/services/userPermissions';
import { formatLocalDate, DATE_FORMATS } from '@/utils/date';
import { todayLocal, getPeriodBounds, filterByPeriod } from '@/utils/period';
import PeriodFilter from '@/components/PeriodFilter';
import FilePicker from '@/components/FilePicker';
import { toast } from 'sonner';
import ApperIcon from '@/components/ApperIcon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';

const { contains, or } = window.ApperSDK.CoreSDK;

const cash = (value) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0));

// ── Sales ID generation ─────────────────────────────────────────────────────

/** Generate a stable Sales ID: SAL-YYYYMMDD-XXXXXXXX */
function generateSalesId(dateStr) {
  const datePart = String(dateStr || todayLocal()).replaceAll('-', '');
  const random = (
    globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()
      : (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).toUpperCase().slice(0, 8)
  );
  return `SAL-${datePart}-${random}`;
}

// ── Module configuration ────────────────────────────────────────────────────

const MODULES = {
  sales: {
    title: 'Sales',
    table: 'sales_c',
    path: '/sales',
    singular: 'sale',
    icon: 'TrendingUp',
    amountKey: 'amount_c',
    dateKey: 'saleDate_c',
    counterpartyKey: 'customerName_c',
    searchFields: ['Name', 'customerName_c', 'notes_c'],
    selectFields: ['Name', 'salesId_c', 'saleDate_c', 'customerName_c', 'amount_c', 'paymentMethod_c', 'weightKg_c', 'unitPrice_c', 'notes_c'],
    columns: [
      ['Name', 'Sales ID'],
      ['saleDate_c', 'Date'],
      ['customerName_c', 'Customer'],
      ['weightKg_c', 'Qty (kg)'],
      ['unitPrice_c', 'Rate / kg'],
      ['amount_c', 'Amount'],
      ['paymentMethod_c', 'Paid via'],
    ],
  },
  expenses: {
    title: 'Expenses',
    table: 'expenses_c',
    path: '/expenses',
    singular: 'expense',
    icon: 'ReceiptIndianRupee',
    amountKey: 'amount_c',
    dateKey: 'expenseDate_c',
    counterpartyKey: null, // paidTo_c no longer in form, but kept in DB
    searchFields: ['Name', 'notes_c'],
    selectFields: ['Name', 'expenseDate_c', 'category_c', 'paidTo_c', 'amount_c', 'paymentMethod_c', 'notes_c', 'receipt_c'],
    columns: [
      ['Name', 'Description'],
      ['expenseDate_c', 'Date'],
      ['amount_c', 'Amount'],
      ['paymentMethod_c', 'Paid via'],
      ['receipt_c', 'Receipt'],
    ],
  },
};

// ── Data loading ─────────────────────────────────────────────────────────────

async function loadRecords(config, search) {
  const results = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    let query = sdk.table(config.table).select(config.selectFields);
    if (search.trim()) {
      const filters = config.searchFields.map((field) => contains(field, search.trim()));
      query = query.where(filters.length > 1 ? or(...filters) : filters[0]);
    }

    const response = await query.orderByDesc(config.dateKey).page(page, 100).fetch();
    if (!response.success) {
      throw new Error(response.message || 'Unable to load ' + config.title.toLowerCase());
    }

    results.push(...(response.data ?? []));
    hasMore = Boolean(response.hasMore);
    page += 1;
  }

  return results;
}

// ── Cell renderer ─────────────────────────────────────────────────────────────

function cellValue(row, key, config) {
  const value = row[key];

  if (key === 'Name' && config.table === 'sales_c') {
    return row.salesId_c || row.Name || '—';
  }

  if (key === 'receipt_c') {
    const files = Array.isArray(value) ? value : value ? [value] : [];
    if (!files.length) return '—';
    const file = files[0];
    return (
      <button
        type="button"
        onClick={async (e) => {
          e.stopPropagation();
          try {
            const res = await sdk.storage.preview(file);
            if (res?.url) window.open(res.url, '_blank', 'noopener,noreferrer');
          } catch {
            toast.error('Could not preview receipt.');
          }
        }}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
        title={file.Name ?? file.name ?? 'View receipt'}
      >
        <ApperIcon name="FileText" size={14} />
        <span>Receipt</span>
      </button>
    );
  }

  if (value == null || value === '') return '—';
  if (key === config.amountKey || key === 'unitPrice_c') return cash(value);
  if (key === 'weightKg_c') return Number(value).toLocaleString('en-IN');
  if (key === config.dateKey) return formatLocalDate(value, DATE_FORMATS.SHORT);
  return String(value);
}

// ── SimpleFinanceList ─────────────────────────────────────────────────────────

export function SimpleFinanceList({ kind }) {
  const config = MODULES[kind];
  const { profile } = useProfile();
  const permission = getTableAccess(profile, config.table);
  const [search, setSearch] = useState('');

  // Period state — default: current month
  const [view, setView] = useState('monthly');
  const [anchor, setAnchor] = useState(todayLocal);

  const { data, loading, error, run } = useFetch(
    () => loadRecords(config, search),
    [kind, search]
  );

  const allRows = data ?? [];

  // Apply period filter on top of search results (client-side; search is already applied server-side)
  const { start, end } = useMemo(() => getPeriodBounds(view, anchor), [view, anchor]);
  const rows = useMemo(
    () => filterByPeriod(allRows, config.dateKey, start, end),
    [allRows, config.dateKey, start, end]
  );

  const total = rows.reduce((sum, row) => sum + Number(row[config.amountKey] ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Finance / {config.title}</p>
          <h1 className="font-heading text-3xl font-semibold">{config.title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">Record and review {config.title.toLowerCase()} in one place.</p>
        </div>
        {permission.canCreate && (
          <Button asChild className="min-h-10 rounded-sm">
            <Link to={config.path + '/new'}>
              <ApperIcon name="Plus" size={16} />
              Add {config.singular}
            </Link>
          </Button>
        )}
      </div>

      {/* Period filter */}
      <PeriodFilter view={view} anchor={anchor} onViewChange={setView} onAnchorChange={setAnchor} />

      {/* Summary cards */}
      <div className="grid gap-3 sm:grid-cols-3">
        <section className="border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Period total</p>
          {loading && data === undefined ? (
            <Skeleton className="mt-3 h-7 w-32" />
          ) : (
            <p className="mt-2 font-heading text-2xl font-semibold tabular-nums">{cash(total)}</p>
          )}
        </section>
        <section className="border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Records in period</p>
          {loading && data === undefined ? (
            <Skeleton className="mt-3 h-7 w-20" />
          ) : (
            <p className="mt-2 font-heading text-2xl font-semibold tabular-nums">{rows.length.toLocaleString('en-IN')}</p>
          )}
        </section>
        <section className="border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">All time total</p>
          {loading && data === undefined ? (
            <Skeleton className="mt-3 h-7 w-32" />
          ) : (
            <p className="mt-2 font-heading text-2xl font-semibold tabular-nums">
              {cash(allRows.reduce((s, r) => s + Number(r[config.amountKey] ?? 0), 0))}
            </p>
          )}
        </section>
      </div>

      {/* Search */}
      <div className="relative max-w-lg">
        <ApperIcon name="Search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={'Search ' + config.title.toLowerCase() + '…'}
          className="min-h-10 rounded-sm pl-9"
          aria-label={'Search ' + config.title.toLowerCase()}
        />
      </div>

      {/* Register */}
      <section className="overflow-hidden border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">{config.title} register</h2>
          <span className="text-xs text-muted-foreground">
            {loading && data === undefined ? 'Loading…' : rows.length + ' record' + (rows.length !== 1 ? 's' : '') + ' in period'}
          </span>
        </div>
        {loading && data === undefined ? (
          <div className="space-y-3 p-5">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : error ? (
          <div className="p-8 text-center">
            <p className="font-medium">Could not load {config.title.toLowerCase()}</p>
            <p className="mt-1 text-sm text-muted-foreground">{error.message ?? String(error)}</p>
            <Button variant="outline" className="mt-3 rounded-sm" onClick={() => run()}>Try again</Button>
          </div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center">
            <ApperIcon name={config.icon} size={28} className="mx-auto text-muted-foreground" />
            <p className="mt-3 font-semibold">No {config.title.toLowerCase()} in this period</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {allRows.length > 0
                ? 'Try changing the period or navigating to a different date.'
                : 'Add your first ' + config.singular + ' to start the register.'}
            </p>
            {permission.canCreate && (
              <Button asChild className="mt-4 rounded-sm">
                <Link to={config.path + '/new'}><ApperIcon name="Plus" size={15} /> Add {config.singular}</Link>
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto" aria-busy={loading}>
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="w-10 px-3 py-3 font-semibold">#</th>
                  {config.columns.map(([key, label]) => (
                    <th
                      key={key}
                      className={'px-4 py-3 font-semibold ' + (key === config.amountKey || key === 'unitPrice_c' || key === 'weightKg_c' ? 'text-right' : '')}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row, index) => (
                  <tr key={row.Id} className="transition-colors hover:bg-muted/30">
                    <td className="px-3 py-3 font-mono text-xs text-muted-foreground">{String(index + 1).padStart(2, '0')}</td>
                    {config.columns.map(([key]) => (
                      <td
                        key={key}
                        className={'whitespace-nowrap px-4 py-3 ' + (key === config.amountKey || key === 'unitPrice_c' || key === 'weightKg_c' ? 'text-right tabular-nums' : '')}
                      >
                        {cellValue(row, key, config)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="text-xs text-muted-foreground">
        Totals and counts reflect the selected period and any active search. Sales and expenses are stored in separate registers.
      </p>
    </div>
  );
}

// ── SimpleFinanceForm ─────────────────────────────────────────────────────────

export function SimpleFinanceForm({ kind }) {
  const isSales = kind === 'sales';
  const isExpenses = kind === 'expenses';
  const config = MODULES[kind];
  const navigate = useNavigate();
  const { profile } = useProfile();
  const permission = getTableAccess(profile, config.table);

  // Sales: date-dependent stable ID (generated once per form mount)
  const today = todayLocal();

  const [saleDate, setSaleDate] = useState(today);
  // Generate ID once; changes when date changes (still stable per session)
  const [salesId] = useState(() => (isSales ? generateSalesId(today) : ''));
  const [salesIdForDate, setSalesIdForDate] = useState(salesId);

  // Track last date used to regenerate ID only when date actually changes
  const [lastDateForId, setLastDateForId] = useState(today);

  function getOrUpdateSalesId(newDate) {
    if (newDate !== lastDateForId) {
      const newId = generateSalesId(newDate);
      setSalesIdForDate(newId);
      setLastDateForId(newDate);
      return newId;
    }
    return salesIdForDate;
  }

  // Common form fields
  const [customerName, setCustomerName] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [notes, setNotes] = useState('');

  // Sales-specific
  const [quantity, setQuantity] = useState('');
  const [rate, setRate] = useState('');

  // Expenses-specific
  const [expenseDate, setExpenseDate] = useState(today);
  const [expenseDesc, setExpenseDesc] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [receiptFiles, setReceiptFiles] = useState([]);

  const [saving, setSaving] = useState(false);

  // Derived total for sales
  const qty = Number(quantity) || 0;
  const rateNum = Number(rate) || 0;
  const calculatedTotal = Math.round(qty * rateNum * 100) / 100;

  const PAYMENT_METHODS = ['Cash', 'UPI', 'Bank Transfer', 'Other'];

  const RECEIPT_FIELD_CONFIG = {
    supportedExtensions: ['jpg', 'jpeg', 'png', 'webp'],
    supportMultipleValues: false,
    minValue: 0,
    maxValue: 10240, // 10 MB
  };

  async function saveSale(event) {
    event.preventDefault();
    if (saving) return;

    const currentId = salesIdForDate;
    const currentDate = saleDate;

    if (!currentDate) { toast.error('Choose a sale date.'); return; }
    if (!Number.isFinite(qty) || qty <= 0) { toast.error('Quantity must be greater than zero.'); return; }
    if (!Number.isFinite(rateNum) || rateNum <= 0) { toast.error('Rate per kg must be greater than zero.'); return; }
    if (!paymentMethod) { toast.error('Choose a payment method.'); return; }
    if (calculatedTotal <= 0) { toast.error('Calculated total must be greater than zero.'); return; }

    setSaving(true);
    try {
      // Ensure unique Sales ID
      let finalId = currentId;
      try {
        const check = await sdk.table('sales_c')
          .select(['Id', 'Name'])
          .where(contains('Name', finalId))
          .page(1, 1)
          .fetch();
        if (check.success && check.data?.length) {
          finalId = generateSalesId(currentDate);
        }
      } catch {
        // proceed with finalId
      }

      const payload = {
        Name: finalId,
        salesId_c: finalId,
        saleDate_c: currentDate,
        customerName_c: customerName.trim(),
        amount_c: calculatedTotal,
        paymentMethod_c: paymentMethod,
        weightKg_c: qty,
        unitPrice_c: rateNum,
        notes_c: notes.trim(),
      };

      const response = await sdk.table('sales_c').create(payload);
      if (!response.data?.length) {
        toast.error(response.messages?.[0] || 'The sale record was not saved.');
        return;
      }
      toast.success('Sale saved.');
      navigate('/sales');
    } catch (err) {
      toast.error('Could not save the sale.', { description: err.message ?? String(err) });
    } finally {
      setSaving(false);
    }
  }

  async function saveExpense(event) {
    event.preventDefault();
    if (saving) return;

    if (!expenseDesc.trim()) { toast.error('Enter a description.'); return; }
    if (!expenseDate) { toast.error('Choose a date.'); return; }
    const amount = Number(expenseAmount);
    if (!Number.isFinite(amount) || amount <= 0) { toast.error('Amount must be greater than zero.'); return; }
    if (!paymentMethod) { toast.error('Choose a payment method.'); return; }

    setSaving(true);
    try {
      const payload = {
        Name: expenseDesc.trim(),
        expenseDate_c: expenseDate,
        amount_c: Math.round(amount * 100) / 100,
        paymentMethod_c: paymentMethod,
        notes_c: notes.trim(),
      };

      // Attach receipt if one was uploaded through FilePicker
      if (receiptFiles.length > 0) {
        payload.receipt_c = sdk.storage.toCreateFormat(receiptFiles);
      }

      const response = await sdk.table('expenses_c').create(payload);
      if (!response.data?.length) {
        toast.error(response.messages?.[0] || 'The expense record was not saved.');
        return;
      }
      toast.success('Expense saved.');
      navigate('/expenses');
    } catch (err) {
      toast.error('Could not save the expense.', { description: err.message ?? String(err) });
    } finally {
      setSaving(false);
    }
  }

  if (!permission.canCreate) {
    return (
      <div className="space-y-3">
        <p>You do not have permission to add {config.title.toLowerCase()}.</p>
        <Button asChild variant="outline"><Link to={config.path}>Back to {config.title}</Link></Button>
      </div>
    );
  }

  // ── Sales form ─────────────────────────────────────────────────────────────
  if (isSales) {
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        <Button asChild variant="ghost" size="sm" className="-ml-2 rounded-sm">
          <Link to="/sales"><ApperIcon name="ArrowLeft" size={16} /> Back to Sales</Link>
        </Button>
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Finance / Sales</p>
          <h1 className="font-heading text-3xl font-semibold">Add sale</h1>
          <p className="mt-2 text-sm text-muted-foreground">Enter the quantity and rate — the total is calculated automatically.</p>
        </div>

        <form onSubmit={saveSale} className="space-y-6 border border-border bg-card p-5 md:p-7">
          {/* Sales ID — read-only display */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium">Sales ID</label>
            <div className="flex h-10 items-center justify-between border border-border bg-muted/50 px-3">
              <span className="text-sm font-semibold tracking-wide">{salesIdForDate}</span>
              <ApperIcon name="LockKeyhole" size={15} className="text-muted-foreground" />
            </div>
            <p className="text-xs text-muted-foreground">Auto-generated; stored with the record and never changes.</p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            {/* Sale date */}
            <div className="space-y-1.5">
              <label htmlFor="sale-date" className="block text-sm font-medium">Date *</label>
              <Input
                id="sale-date"
                type="date"
                required
                value={saleDate}
                onChange={(e) => {
                  const v = e.target.value;
                  setSaleDate(v);
                  getOrUpdateSalesId(v); // regenerate ID when date changes
                }}
                className="min-h-10 rounded-sm"
              />
            </div>

            {/* Customer */}
            <div className="space-y-1.5">
              <label htmlFor="sale-customer" className="block text-sm font-medium">Customer <span className="text-xs text-muted-foreground">(optional)</span></label>
              <Input
                id="sale-customer"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Customer or company name"
                className="min-h-10 rounded-sm"
              />
            </div>

            {/* Quantity */}
            <div className="space-y-1.5">
              <label htmlFor="sale-qty" className="block text-sm font-medium">Quantity (kg) *</label>
              <Input
                id="sale-qty"
                type="number"
                min="0.001"
                step="0.001"
                required
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="e.g. 125.500"
                className="min-h-10 rounded-sm"
              />
            </div>

            {/* Rate per kg */}
            <div className="space-y-1.5">
              <label htmlFor="sale-rate" className="block text-sm font-medium">Rate per kg (₹) *</label>
              <Input
                id="sale-rate"
                type="number"
                min="0.01"
                step="0.01"
                required
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                placeholder="e.g. 80.50"
                className="min-h-10 rounded-sm"
              />
            </div>

            {/* Payment method */}
            <div className="space-y-1.5">
              <label htmlFor="sale-method" className="block text-sm font-medium">Payment method *</label>
              <select
                id="sale-method"
                required
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="min-h-10 h-10 w-full rounded-sm border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Choose payment method</option>
                {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>

            {/* Notes */}
            <div className="space-y-1.5 sm:col-span-2">
              <label htmlFor="sale-notes" className="block text-sm font-medium">Notes <span className="text-xs text-muted-foreground">(optional)</span></label>
              <Textarea
                id="sale-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Invoice number, details, etc."
                rows={2}
              />
            </div>
          </div>

          {/* Calculated total — read-only summary */}
          <div className="border border-border bg-muted/40 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Calculated total</p>
            <p className="mt-2 font-heading text-3xl font-semibold tabular-nums text-primary">
              {qty > 0 && rateNum > 0 ? cash(calculatedTotal) : '—'}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {qty > 0 && rateNum > 0
                ? `${Number(qty).toLocaleString('en-IN')} kg × ₹${rateNum.toFixed(2)}/kg`
                : 'Enter quantity and rate above.'}
            </p>
          </div>

          <div className="flex flex-col-reverse justify-between gap-3 border-t border-border pt-5 sm:flex-row">
            <Button type="button" variant="outline" asChild className="rounded-sm"><Link to="/sales">Cancel</Link></Button>
            <Button
              type="submit"
              disabled={saving || qty <= 0 || rateNum <= 0 || !paymentMethod}
              className="min-h-10 rounded-sm"
            >
              {saving ? 'Saving…' : 'Save sale'}
              {!saving && <ApperIcon name="Check" size={16} />}
            </Button>
          </div>
        </form>
      </div>
    );
  }

  // ── Expenses form ──────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2 rounded-sm">
        <Link to="/expenses"><ApperIcon name="ArrowLeft" size={16} /> Back to Expenses</Link>
      </Button>
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Finance / Expenses</p>
        <h1 className="font-heading text-3xl font-semibold">Add expense</h1>
        <p className="mt-2 text-sm text-muted-foreground">Enter the required details and save the record.</p>
      </div>

      <form onSubmit={saveExpense} className="space-y-6 border border-border bg-card p-5 md:p-7">
        <div className="grid gap-5 sm:grid-cols-2">
          {/* Description */}
          <div className="space-y-1.5 sm:col-span-2">
            <label htmlFor="exp-desc" className="block text-sm font-medium">Description *</label>
            <Input
              id="exp-desc"
              required
              value={expenseDesc}
              onChange={(e) => setExpenseDesc(e.target.value)}
              placeholder="e.g. Workshop electricity bill"
              className="min-h-10 rounded-sm"
            />
          </div>

          {/* Date */}
          <div className="space-y-1.5">
            <label htmlFor="exp-date" className="block text-sm font-medium">Date *</label>
            <Input
              id="exp-date"
              type="date"
              required
              value={expenseDate}
              onChange={(e) => setExpenseDate(e.target.value)}
              className="min-h-10 rounded-sm"
            />
          </div>

          {/* Amount */}
          <div className="space-y-1.5">
            <label htmlFor="exp-amount" className="block text-sm font-medium">Amount (₹) *</label>
            <Input
              id="exp-amount"
              type="number"
              min="0.01"
              step="0.01"
              required
              value={expenseAmount}
              onChange={(e) => setExpenseAmount(e.target.value)}
              placeholder="0.00"
              className="min-h-10 rounded-sm"
            />
          </div>

          {/* Payment method */}
          <div className="space-y-1.5 sm:col-span-2">
            <label htmlFor="exp-method" className="block text-sm font-medium">Payment method *</label>
            <select
              id="exp-method"
              required
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              className="min-h-10 h-10 w-full rounded-sm border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Choose payment method</option>
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          {/* Notes */}
          <div className="space-y-1.5 sm:col-span-2">
            <label htmlFor="exp-notes" className="block text-sm font-medium">Notes <span className="text-xs text-muted-foreground">(optional)</span></label>
            <Textarea
              id="exp-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional details (optional)"
              rows={2}
            />
          </div>

          {/* Receipt / photo upload */}
          <div className="space-y-1.5 sm:col-span-2">
            <label className="block text-sm font-medium">Receipt / photo <span className="text-xs text-muted-foreground">(optional)</span></label>
            <FilePicker
              value={receiptFiles}
              onChange={setReceiptFiles}
              fieldConfig={RECEIPT_FIELD_CONFIG}
              maxFiles={1}
            />
            <p className="text-xs text-muted-foreground">
              JPG, JPEG, PNG or WebP · max 10 MB. The uploaded file is stored with this record.
            </p>
          </div>
        </div>

        <div className="flex flex-col-reverse justify-between gap-3 border-t border-border pt-5 sm:flex-row">
          <Button type="button" variant="outline" asChild className="rounded-sm"><Link to="/expenses">Cancel</Link></Button>
          <Button type="submit" disabled={saving} className="min-h-10 rounded-sm">
            {saving ? 'Saving…' : 'Save expense'}
            {!saving && <ApperIcon name="Check" size={16} />}
          </Button>
        </div>
      </form>
    </div>
  );
}
