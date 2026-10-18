import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useFetch } from '@/hooks/useFetch';
import { useProfile } from '@/hooks/useProfile';
import { getTableAccess } from '@/services/userPermissions';
import { formatLocalDate, DATE_FORMATS } from '@/utils/date';
import { todayLocal, getPeriodBounds } from '@/utils/period';
import PeriodFilter from '@/components/PeriodFilter';
import { toast } from 'sonner';
import ApperIcon from '@/components/ApperIcon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  addPurchasePayment,
  cancelPurchase,
  createPurchase,
  createStockItem,
  editPurchase,
  repairPurchaseStockMovement,
  formatInr,
  getAllPurchasePayments,
  getMovementsForPurchase,
  getPurchaseAudit,
  getPurchaseById,
  getPurchaseTotals,
  getPaymentsForPurchase,
  getPurchases,
  getStockItems,
  newIdempotencyKey,
  roundMoney,
} from '@/services/purchaseWorkflow';

const PAYMENT_METHODS = ['Cash', 'UPI', 'Bank Transfer', 'Other Online'];

const today = () => new Date().toISOString().slice(0, 10);

const localDate = (value) => value
  ? formatLocalDate(value, DATE_FORMATS.SHORT)
  : '—';

const kgFormat = (value) => Number(value ?? 0).toLocaleString('en-IN', {
  maximumFractionDigits: 3,
});

const dateMinusDays = (days) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
};

function StatusLabel({ status }) {
  const className = status === 'Paid' || status === 'Active'
    ? 'border-success-border bg-success-muted text-success'
    : status === 'Partially Paid'
      ? 'border-warning-border bg-warning-muted text-warning-foreground'
      : status === 'Unpaid' || status === 'Cancelled'
        ? 'border-destructive/20 bg-destructive/10 text-destructive'
        : 'border-border bg-muted text-muted-foreground';

  return (
    <span className={'inline-flex items-center rounded-sm border px-2 py-1 text-xs font-semibold ' + className}>
      {status}
    </span>
  );
}

function MetricCard({ label, value, note, icon }) {
  return (
    <div className="border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {label}
        </p>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-primary/10 text-primary">
          <ApperIcon name={icon} size={17} />
        </span>
      </div>
      <p className="mt-4 font-heading text-2xl font-semibold tabular-nums">{value}</p>
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

function InitialPaymentHistory({ purchase }) {
  const rows = [];

  if (Number(purchase.advanceAmount_c) > 0) {
    rows.push({
      id: 'advance',
      title: 'Advance before purchase',
      date: purchase.advanceDate_c || purchase.purchaseDate_c,
      method: purchase.advanceMethod_c || '—',
      amount: Number(purchase.advanceAmount_c),
      note: 'Recorded separately from payment made on purchase date.',
    });
  }

  if (Number(purchase.cashAtPurchase_c) > 0) {
    rows.push({
      id: 'cash-at-purchase',
      title: 'Cash at purchase',
      date: purchase.purchaseDate_c,
      method: 'Cash',
      amount: Number(purchase.cashAtPurchase_c),
      note: 'Payment recorded at the time of purchase.',
    });
  }

  if (Number(purchase.onlineAtPurchase_c) > 0) {
    rows.push({
      id: 'online-at-purchase',
      title: 'Online at purchase',
      date: purchase.purchaseDate_c,
      method: 'Online',
      amount: Number(purchase.onlineAtPurchase_c),
      note: 'Payment recorded at the time of purchase.',
    });
  }

  return rows;
}

export function PurchaseList() {
  const { profile } = useProfile();
  const access = getTableAccess(profile, 'purchases_c');
  const { data: purchases, loading: purchasesLoading, error: purchasesError, run: reloadPurchases } = useFetch(
    getPurchases,
    [],
  );
  const { data: payments, loading: paymentsLoading, error: paymentsError, run: reloadPayments } = useFetch(
    getAllPurchasePayments,
    [],
  );
  const { data: stockItems, loading: itemsLoading } = useFetch(
    () => getStockItems(true),
    [],
  );

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [stockFilter, setStockFilter] = useState('All');
  const [sort, setSort] = useState('date-desc');

  // Period filter state — default: current month
  const [periodView, setPeriodView] = useState('monthly');
  const [periodAnchor, setPeriodAnchor] = useState(todayLocal);

  const { start: periodStart, end: periodEnd } = useMemo(
    () => getPeriodBounds(periodView, periodAnchor),
    [periodView, periodAnchor],
  );

  const itemMap = useMemo(
    () => new Map((stockItems ?? []).map((item) => [String(item.Id), item])),
    [stockItems],
  );

  const paymentsByPurchase = useMemo(() => {
    const grouped = new Map();
    (payments ?? []).forEach((payment) => {
      const purchaseId = String(payment.purchase_c?.Id ?? payment.purchase_c ?? '');
      if (!grouped.has(purchaseId)) grouped.set(purchaseId, []);
      grouped.get(purchaseId).push(payment);
    });
    return grouped;
  }, [payments]);

  const filteredPurchases = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = (purchases ?? []).filter((purchase) => {
      const purchaseDate = String(purchase.purchaseDate_c ?? '');
      const itemId = String(purchase.stockItem_c?.Id ?? purchase.stockItem_c ?? '');
      const itemName = purchase.stockItem_c?.Name ?? itemMap.get(itemId)?.Name ?? '';
      const totals = getPurchaseTotals(purchase, paymentsByPurchase.get(String(purchase.Id)) ?? []);
      const matchesSearch = !query
        || String(purchase.purchaseRef_c ?? purchase.Name ?? '').toLowerCase().includes(query)
        || String(itemName).toLowerCase().includes(query);
      const matchesStatus = statusFilter === 'All' || totals.paymentStatus === statusFilter;
      const matchesStock = stockFilter === 'All' || itemId === stockFilter;
      const matchesPeriod = purchaseDate >= periodStart && purchaseDate <= periodEnd;

      return matchesSearch && matchesStatus && matchesStock && matchesPeriod;
    });

    filtered.sort((a, b) => {
      if (sort === 'amount-desc') return Number(b.totalPurchaseValue_c) - Number(a.totalPurchaseValue_c);
      if (sort === 'amount-asc') return Number(a.totalPurchaseValue_c) - Number(b.totalPurchaseValue_c);
      if (sort === 'date-asc') return String(a.purchaseDate_c).localeCompare(String(b.purchaseDate_c));
      return String(b.purchaseDate_c).localeCompare(String(a.purchaseDate_c));
    });

    return filtered;
  }, [purchases, paymentsByPurchase, search, statusFilter, stockFilter, periodStart, periodEnd, sort, itemMap]);

  const summary = useMemo(() => {
    const active = filteredPurchases.filter((purchase) => purchase.recordStatus_c !== 'Cancelled');
    return active.reduce((result, purchase) => {
      const relatedPayments = paymentsByPurchase.get(String(purchase.Id)) ?? [];
      const totals = getPurchaseTotals(purchase, relatedPayments);
      result.totalPurchases += Number(purchase.totalPurchaseValue_c ?? 0);
      result.totalKg += Number(purchase.quantityKg_c ?? 0);
      result.totalPaid += totals.totalPaid;
      result.outstanding += totals.outstanding;
      result.cash += totals.cashPaid;
      result.online += totals.onlinePaid;
      return result;
    }, { totalPurchases: 0, totalKg: 0, totalPaid: 0, outstanding: 0, cash: 0, online: 0 });
  }, [filteredPurchases, paymentsByPurchase]);

  const reloadAll = async () => {
    await Promise.all([reloadPurchases(), reloadPayments()]);
  };

  const loading = purchasesLoading || paymentsLoading || itemsLoading;
  const error = purchasesError || paymentsError;

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
            Inventory / Procurement
          </p>
          <h1 className="font-heading text-3xl font-semibold tracking-tight">Purchase management</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Record stock purchases, track supplier balances and reconcile payments against each purchase.
          </p>
        </div>
        {access.canCreate && (
          <Button asChild className="rounded-sm">
            <Link to="/purchases/new">
              <ApperIcon name="Plus" size={16} />
              New purchase
            </Link>
          </Button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <MetricCard label="Total purchases" value={formatInr(summary.totalPurchases)} note="Selected period (excl. cancelled)" icon="ShoppingCart" />
        <MetricCard label="Stock purchased" value={kgFormat(summary.totalKg) + ' kg'} note="Excludes cancelled purchases" icon="Package" />
        <MetricCard label="Total amount paid" value={formatInr(summary.totalPaid)} note="Advance + at-purchase + later payments" icon="BadgeIndianRupee" />
        <MetricCard label="Outstanding payments" value={formatInr(summary.outstanding)} note="Amount still owed on selected purchases" icon="Clock" />
        <MetricCard label="Cash payments" value={formatInr(summary.cash)} note="Including cash advances" icon="Banknote" />
        <MetricCard label="Online payments" value={formatInr(summary.online)} note="UPI, bank transfer and other online" icon="CreditCard" />
      </div>

      <section className="space-y-4 border border-border bg-card p-4 shadow-sm md:p-5">
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
          <div>
            <h2 className="font-heading text-xl font-semibold">Purchase history</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Search the purchase reference or stock name, then filter the results.
            </p>
          </div>
          <Button variant="outline" className="rounded-sm" onClick={reloadAll} disabled={loading}>
            <ApperIcon name="RefreshCw" size={15} />
            Refresh data
          </Button>
        </div>

        {/* Period filter */}
        <PeriodFilter
          view={periodView}
          anchor={periodAnchor}
          onViewChange={setPeriodView}
          onAnchorChange={setPeriodAnchor}
        />

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="relative xl:col-span-2">
            <ApperIcon name="Search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Purchase ID or stock name"
              className="rounded-sm pl-9"
              aria-label="Search by purchase ID or stock name"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="purchases-stock-filter">Stock item</label>
            <select id="purchases-stock-filter" value={stockFilter} onChange={(event) => setStockFilter(event.target.value)} className="h-9 w-full rounded-sm border border-input bg-background px-2 text-sm">
              <option value="All">All items</option>
              {(stockItems ?? []).map((item) => <option key={item.Id} value={item.Id}>{item.Name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="purchases-status-filter">Payment status</label>
            <select id="purchases-status-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-9 w-full rounded-sm border border-input bg-background px-2 text-sm">
              <option value="All">All statuses</option>
              <option value="Unpaid">Unpaid</option>
              <option value="Partially Paid">Partially Paid</option>
              <option value="Paid">Paid</option>
            </select>
          </div>
        </div>

        <div className="flex flex-col justify-between gap-2 border-t border-border pt-4 sm:flex-row sm:items-center">
          <p className="text-xs text-muted-foreground">{filteredPurchases.length} purchase record(s) in period</p>
          <div className="flex items-center gap-2">
            <label htmlFor="purchases-sort" className="text-xs text-muted-foreground">Sort by</label>
            <select id="purchases-sort" value={sort} onChange={(event) => setSort(event.target.value)} className="h-8 rounded-sm border border-input bg-background px-2 text-sm">
              <option value="date-desc">Newest date</option>
              <option value="date-asc">Oldest date</option>
              <option value="amount-desc">Highest amount</option>
              <option value="amount-asc">Lowest amount</option>
            </select>
          </div>
        </div>


        {loading && !purchases ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : error ? (
          <div className="rounded-sm border border-destructive/20 bg-destructive/5 p-6">
            <p className="font-semibold">Purchase data could not be loaded.</p>
            <p className="mt-1 text-sm text-muted-foreground">{error.message ?? String(error)}</p>
            <Button variant="outline" className="mt-3 rounded-sm" onClick={reloadAll}>Retry</Button>
          </div>
        ) : filteredPurchases.length === 0 ? (
          <div className="py-10 text-center">
            <span className="mx-auto flex size-12 items-center justify-center rounded-sm bg-muted">
              <ApperIcon name="ShoppingCart" size={22} />
            </span>
            <p className="mt-3 font-semibold">No purchases match these filters</p>
            <p className="mt-1 text-sm text-muted-foreground">Change the date range or create a purchase to get started.</p>
            {access.canCreate && <Button asChild className="mt-4 rounded-sm"><Link to="/purchases/new">Record a purchase</Link></Button>}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] text-left text-sm">
              <thead className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-3 font-semibold">Purchase ID</th>
                  <th className="px-3 py-3 font-semibold">Date</th>
                  <th className="px-3 py-3 font-semibold">Stock item</th>
                  <th className="px-3 py-3 text-right font-semibold">Weight</th>
                  <th className="px-3 py-3 text-right font-semibold">Price/kg</th>
                  <th className="px-3 py-3 text-right font-semibold">Total</th>
                  <th className="px-3 py-3 text-right font-semibold">Paid</th>
                  <th className="px-3 py-3 text-right font-semibold">Outstanding</th>
                  <th className="px-3 py-3 font-semibold">Payment status</th>
                  <th className="px-3 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredPurchases.map((purchase) => {
                  const itemId = String(purchase.stockItem_c?.Id ?? purchase.stockItem_c ?? '');
                  const itemName = purchase.stockItem_c?.Name ?? itemMap.get(itemId)?.Name ?? 'Unknown item';
                  const totals = getPurchaseTotals(purchase, paymentsByPurchase.get(String(purchase.Id)) ?? []);
                  return (
                    <tr key={purchase.Id} className="transition-colors hover:bg-muted/30">
                      <td className="whitespace-nowrap px-3 py-3.5">
                        <Link to={'/purchases/' + purchase.Id} className="font-semibold text-primary hover:underline">{purchase.purchaseRef_c}</Link>
                        {purchase.recordStatus_c === 'Cancelled' && <span className="mt-1 block text-[10px] font-semibold uppercase text-destructive">Cancelled</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3.5">{localDate(purchase.purchaseDate_c)}</td>
                      <td className="whitespace-nowrap px-3 py-3.5">{itemName}</td>
                      <td className="whitespace-nowrap px-3 py-3.5 text-right tabular-nums">{kgFormat(purchase.quantityKg_c)} kg</td>
                      <td className="whitespace-nowrap px-3 py-3.5 text-right tabular-nums">{formatInr(purchase.pricePerKg_c)}</td>
                      <td className="whitespace-nowrap px-3 py-3.5 text-right font-semibold tabular-nums">{formatInr(purchase.totalPurchaseValue_c)}</td>
                      <td className="whitespace-nowrap px-3 py-3.5 text-right tabular-nums">{formatInr(totals.totalPaid)}</td>
                      <td className="whitespace-nowrap px-3 py-3.5 text-right tabular-nums">{formatInr(totals.outstanding)}</td>
                      <td className="whitespace-nowrap px-3 py-3.5"><StatusLabel status={totals.paymentStatus} /></td>
                      <td className="whitespace-nowrap px-3 py-3.5">
                        <Button asChild variant="outline" size="sm" className="rounded-sm">
                          <Link to={'/purchases/' + purchase.Id}>View</Link>
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Cancelled purchases remain in history. Summary cards exclude cancelled purchases; payment balances are calculated from initial payments and subsequent payment records.
        </p>
      </section>
    </div>
  );
}

export function PurchaseForm({ mode = 'create' }) {
  const editing = mode === 'edit';
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile } = useProfile();
  const isAdmin = profile === 'Admin_c';
  const purchaseAccess = getTableAccess(profile, 'purchases_c');
  const { data: stockItems, loading: itemsLoading, error: itemsError, run: reloadItems } = useFetch(
    () => getStockItems(false),
    [],
  );
  const { data: existingPurchase, loading: purchaseLoading, error: purchaseError } = useFetch(
    async () => editing ? getPurchaseById(id) : null,
    [editing, id],
  );

  const [form, setForm] = useState(() => ({
    stockItem_c: '',
    quantityKg_c: '',
    pricePerKg_c: '',
    purchaseDate_c: today(),
    supplierName_c: '',
    notes_c: '',
    advanceAmount_c: '0',
    advanceDate_c: today(),
    advanceMethod_c: 'UPI',
    cashAtPurchase_c: '0',
    onlineAtPurchase_c: '0',
  }));
  const [saving, setSaving] = useState(false);
  const [showNewItem, setShowNewItem] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [creatingItem, setCreatingItem] = useState(false);
  const [submissionKey] = useState(() => newIdempotencyKey('PURCHASE_FORM'));

  useEffect(() => {
    if (!editing || !existingPurchase) return;
    setForm({
      stockItem_c: existingPurchase.stockItem_c?.Id ?? existingPurchase.stockItem_c ?? '',
      quantityKg_c: String(existingPurchase.quantityKg_c ?? ''),
      pricePerKg_c: String(existingPurchase.pricePerKg_c ?? ''),
      purchaseDate_c: existingPurchase.purchaseDate_c ?? today(),
      supplierName_c: existingPurchase.supplierName_c ?? '',
      notes_c: existingPurchase.notes_c ?? '',
      advanceAmount_c: String(existingPurchase.advanceAmount_c ?? 0),
      advanceDate_c: existingPurchase.advanceDate_c ?? existingPurchase.purchaseDate_c ?? today(),
      advanceMethod_c: existingPurchase.advanceMethod_c ?? 'UPI',
      cashAtPurchase_c: String(existingPurchase.cashAtPurchase_c ?? 0),
      onlineAtPurchase_c: String(existingPurchase.onlineAtPurchase_c ?? 0),
    });
  }, [editing, existingPurchase]);

  const setField = (key, value) => setForm((previous) => ({ ...previous, [key]: value }));
  const quantity = Number(form.quantityKg_c || 0);
  const price = Number(form.pricePerKg_c || 0);
  const total = roundMoney(quantity * price);
  const advance = Number(form.advanceAmount_c || 0);
  const cash = Number(form.cashAtPurchase_c || 0);
  const online = Number(form.onlineAtPurchase_c || 0);
  const totalPaid = roundMoney(advance + cash + online);
  const outstanding = roundMoney(Math.max(0, total - totalPaid));
  const overpaid = totalPaid > total + 0.005;
  const status = totalPaid <= 0 ? 'Unpaid' : totalPaid >= total - 0.005 ? 'Paid' : 'Partially Paid';

  async function addNewItem() {
    if (creatingItem) return;
    setCreatingItem(true);
    try {
      const created = await createStockItem(newItemName);
      await reloadItems();
      setField('stockItem_c', created.Id);
      setNewItemName('');
      setShowNewItem(false);
      toast.success('Stock item added to the catalogue.');
    } catch (error) {
      toast.error('Could not add stock item', { description: error.message ?? String(error) });
    } finally {
      setCreatingItem(false);
    }
  }

  async function savePurchase(event) {
    event.preventDefault();
    if (saving) return;
    if (editing && !isAdmin) {
      toast.error('Only an administrator can edit a purchase.');
      return;
    }

    setSaving(true);
    try {
      if (editing) {
        const updated = await editPurchase(id, form);
        toast.success('Purchase updated and inventory adjustment recorded.');
        navigate('/purchases/' + updated.Id);
      } else {
        const created = await createPurchase(form, submissionKey);
        toast.success('Purchase saved and stock-in recorded.');
        navigate('/purchases/' + created.Id);
      }
    } catch (error) {
      if (!editing && error.purchaseId) {
        toast.warning('Purchase saved, but a related step needs attention.', {
          description: error.message || 'Open the record to retry its inventory link.',
        });
        navigate('/purchases/' + error.purchaseId);
      } else {
        toast.error('Could not save purchase', { description: error.message ?? String(error) });
      }
    } finally {
      setSaving(false);
    }
  }

  if (editing && !isAdmin) {
    return (
      <div className="space-y-3">
        <h1 className="font-heading text-2xl font-semibold">Administrator access required</h1>
        <p className="text-sm text-muted-foreground">Managers can record purchases and payments, but only an administrator can edit purchase details.</p>
        <Button asChild variant="outline"><Link to={'/purchases/' + id}>Back to purchase</Link></Button>
      </div>
    );
  }

  if (editing && purchaseLoading) {
    return <div className="space-y-3"><Skeleton className="h-8 w-1/2" /><Skeleton className="h-64 w-full" /></div>;
  }

  if (editing && (purchaseError || !existingPurchase)) {
    return (
      <div className="space-y-3">
        <h1 className="font-heading text-2xl font-semibold">Purchase not found</h1>
        <p className="text-sm text-muted-foreground">{purchaseError?.message ?? 'This purchase could not be loaded.'}</p>
        <Button asChild variant="outline"><Link to="/purchases">Back to purchase history</Link></Button>
      </div>
    );
  }

  if (!purchaseAccess.canCreate) {
    return <p className="text-sm text-destructive">You do not have permission to create purchases.</p>;
  }

  const disabled = saving || (editing && existingPurchase?.recordStatus_c === 'Cancelled');

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2 rounded-sm">
        <Link to={editing ? '/purchases/' + id : '/purchases'}>
          <ApperIcon name="ArrowLeft" size={16} />
          Back to {editing ? 'purchase' : 'purchase history'}
        </Link>
      </Button>

      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Inventory / Procurement</p>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">
          {editing ? 'Edit purchase' : 'Record a purchase'}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The purchase total and supplier balance update automatically as you enter the details.
        </p>
      </div>

      {itemsError && (
        <div className="border border-destructive/20 bg-destructive/5 p-4 text-sm">
          Could not load stock items: {itemsError.message}
        </div>
      )}

      <form onSubmit={savePurchase} className="space-y-6">
        <section className="border border-border bg-card shadow-sm">
          <div className="border-b border-border px-5 py-4">
            <div className="flex items-center gap-3">
              <span className="flex size-9 items-center justify-center rounded-sm bg-primary/10 text-primary"><ApperIcon name="Package" size={18} /></span>
              <div><h2 className="font-heading text-lg font-semibold">Stock details</h2><p className="text-xs text-muted-foreground">Reference, material, quantity and supplier.</p></div>
            </div>
          </div>
          <div className="grid gap-5 p-5 md:grid-cols-2">
            <div className="space-y-1.5 md:col-span-2">
              <label className="block text-sm font-medium">Purchase ID</label>
              <div className="flex h-10 items-center justify-between border border-border bg-muted/50 px-3">
                <span className="text-sm font-semibold">{editing ? existingPurchase?.purchaseRef_c : 'Generated automatically when saved'}</span>
                <ApperIcon name="LockKeyhole" size={15} className="text-muted-foreground" />
              </div>
              <p className="text-xs text-muted-foreground">The unique reference is generated when the purchase is saved.</p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="purchase-stock-item" className="block text-sm font-medium">Stock name <span className="text-destructive">*</span></label>
              {editing ? (
                <div className="flex h-10 items-center border border-border bg-muted/50 px-3 text-sm">
                  {existingPurchase?.stockItem_c?.Name ?? (stockItems ?? []).find((item) => String(item.Id) === String(form.stockItem_c))?.Name ?? 'Selected stock item'}
                </div>
              ) : (
                <select id="purchase-stock-item" required value={form.stockItem_c} onChange={(event) => setField('stockItem_c', event.target.value)} disabled={itemsLoading || disabled} className="h-10 w-full rounded-sm border border-input bg-background px-3 text-sm">
                  <option value="">{itemsLoading ? 'Loading stock catalogue…' : 'Select a stock item'}</option>
                  {(stockItems ?? []).map((item) => <option key={item.Id} value={item.Id}>{item.Name} · {item.itemCode_c}</option>)}
                </select>
              )}
              {!editing && (
                <button type="button" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline" onClick={() => setShowNewItem((value) => !value)}>
                  <ApperIcon name="Plus" size={13} />
                  Add a new stock item
                </button>
              )}
              {showNewItem && !editing && (
                <div className="flex gap-2 pt-1">
                  <Input value={newItemName} onChange={(event) => setNewItemName(event.target.value)} placeholder="New stock item name" aria-label="New stock item name" />
                  <Button type="button" variant="outline" disabled={creatingItem || !newItemName.trim()} onClick={addNewItem} className="shrink-0 rounded-sm">{creatingItem ? 'Adding…' : 'Add item'}</Button>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="purchase-date" className="block text-sm font-medium">Purchase date <span className="text-destructive">*</span></label>
              <Input id="purchase-date" type="date" required value={form.purchaseDate_c} onChange={(event) => setField('purchaseDate_c', event.target.value)} disabled={disabled} className="rounded-sm" />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="purchase-quantity" className="block text-sm font-medium">Quantity purchased (kg) <span className="text-destructive">*</span></label>
              <Input id="purchase-quantity" type="number" min="0.001" step="0.001" required value={form.quantityKg_c} onChange={(event) => setField('quantityKg_c', event.target.value)} placeholder="e.g. 125.500" disabled={disabled} className="rounded-sm" />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="purchase-price" className="block text-sm font-medium">Purchase price per kg (₹) <span className="text-destructive">*</span></label>
              <Input id="purchase-price" type="number" min="0" step="0.01" required value={form.pricePerKg_c} onChange={(event) => setField('pricePerKg_c', event.target.value)} placeholder="e.g. 72.50" disabled={disabled} className="rounded-sm" />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="purchase-supplier" className="block text-sm font-medium">Supplier name <span className="text-xs text-muted-foreground">(optional)</span></label>
              <Input id="purchase-supplier" value={form.supplierName_c} onChange={(event) => setField('supplierName_c', event.target.value)} placeholder="Supplier or business name" disabled={disabled} className="rounded-sm" />
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <label htmlFor="purchase-notes" className="block text-sm font-medium">Notes <span className="text-xs text-muted-foreground">(optional)</span></label>
              <Textarea id="purchase-notes" rows={3} value={form.notes_c} onChange={(event) => setField('notes_c', event.target.value)} placeholder="Invoice number, quality notes or delivery details" disabled={disabled} />
            </div>
          </div>
        </section>

        <section className="border border-border bg-card shadow-sm">
          <div className="border-b border-border px-5 py-4">
            <div className="flex items-center gap-3">
              <span className="flex size-9 items-center justify-center rounded-sm bg-highlight/10 text-highlight"><ApperIcon name="WalletCards" size={18} /></span>
              <div><h2 className="font-heading text-lg font-semibold">Payment details</h2><p className="text-xs text-muted-foreground">Record pre-purchase advance separately from cash and online payments made at purchase.</p></div>
            </div>
          </div>
          <div className="space-y-6 p-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="border border-border bg-muted/40 p-4">
                <p className="text-xs text-muted-foreground">Total purchase value</p>
                <p className="mt-2 font-heading text-2xl font-semibold tabular-nums">{formatInr(total)}</p>
                <p className="mt-1 text-xs text-muted-foreground">Quantity × rate per kg</p>
              </div>
              <div className="border border-border bg-muted/40 p-4">
                <p className="text-xs text-muted-foreground">Total paid at purchase</p>
                <p className="mt-2 font-heading text-2xl font-semibold tabular-nums">{formatInr(totalPaid)}</p>
                <p className="mt-1 text-xs text-muted-foreground">Advance + cash + online</p>
              </div>
              <div className={'border p-4 ' + (overpaid ? 'border-destructive/40 bg-destructive/5' : 'border-highlight/30 bg-highlight/5')}>
                <p className="text-xs text-muted-foreground">Outstanding balance</p>
                <p className="mt-2 font-heading text-2xl font-semibold tabular-nums">{formatInr(outstanding)}</p>
                <p className="mt-1 text-xs text-muted-foreground">{overpaid ? 'Payments exceed total' : status}</p>
              </div>
            </div>

            <div className="space-y-3">
              <div><h3 className="font-semibold">Advance payment before purchase</h3><p className="mt-1 text-xs text-muted-foreground">This amount is counted once. Keep it separate from payments made on the purchase date.</p></div>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-1.5"><label htmlFor="advance-amount" className="block text-sm font-medium">Advance amount (₹)</label><Input id="advance-amount" type="number" min="0" step="0.01" value={form.advanceAmount_c} onChange={(event) => setField('advanceAmount_c', event.target.value)} disabled={disabled} className="rounded-sm" /></div>
                <div className="space-y-1.5"><label htmlFor="advance-method" className="block text-sm font-medium">Advance payment method</label><select id="advance-method" value={form.advanceMethod_c} onChange={(event) => setField('advanceMethod_c', event.target.value)} disabled={disabled || advance <= 0} className="h-10 w-full rounded-sm border border-input bg-background px-3 text-sm">{PAYMENT_METHODS.map((method) => <option key={method} value={method}>{method}</option>)}</select></div>
                <div className="space-y-1.5"><label htmlFor="advance-date" className="block text-sm font-medium">Advance date</label><Input id="advance-date" type="date" value={form.advanceDate_c} onChange={(event) => setField('advanceDate_c', event.target.value)} disabled={disabled || advance <= 0} className="rounded-sm" /></div>
              </div>
            </div>

            <div className="space-y-3 border-t border-border pt-5">
              <div><h3 className="font-semibold">Payments made at purchase</h3><p className="mt-1 text-xs text-muted-foreground">Enter cash and online amounts separately. Any unpaid balance remains payable later.</p></div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5"><label htmlFor="cash-at-purchase" className="block text-sm font-medium">Cash payment (₹)</label><Input id="cash-at-purchase" type="number" min="0" step="0.01" value={form.cashAtPurchase_c} onChange={(event) => setField('cashAtPurchase_c', event.target.value)} disabled={disabled} className="rounded-sm" /></div>
                <div className="space-y-1.5"><label htmlFor="online-at-purchase" className="block text-sm font-medium">Online payment (₹)</label><Input id="online-at-purchase" type="number" min="0" step="0.01" value={form.onlineAtPurchase_c} onChange={(event) => setField('onlineAtPurchase_c', event.target.value)} disabled={disabled} className="rounded-sm" /></div>
              </div>
            </div>

            {overpaid && <p role="alert" className="border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">Payments cannot exceed the purchase value. Reduce the advance, cash or online amount before saving.</p>}
            <div className="flex items-center justify-between border-t border-border pt-4">
              <p className="text-xs text-muted-foreground">Payment status: <strong>{status}</strong></p>
              <p className="text-xs text-muted-foreground">Currency: INR (₹)</p>
            </div>
          </div>
        </section>

        <div className="flex flex-col-reverse justify-between gap-3 sm:flex-row">
          <Button type="button" variant="outline" asChild className="rounded-sm">
            <Link to={editing ? '/purchases/' + id : '/purchases'}>Cancel</Link>
          </Button>
          <Button type="submit" disabled={disabled || itemsLoading || overpaid || !form.stockItem_c || quantity <= 0 || price < 0} className="rounded-sm">
            {saving ? 'Saving purchase…' : editing ? 'Save purchase changes' : 'Save purchase & add stock'}
            <ApperIcon name="ArrowRight" size={15} />
          </Button>
        </div>
      </form>
    </div>
  );
}

export function PurchaseDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile } = useProfile();
  const isAdmin = profile === 'Admin_c';
  const { data: purchase, loading: purchaseLoading, error: purchaseError, run: reloadPurchase } = useFetch(
    () => getPurchaseById(id),
    [id],
  );
  const { data: payments, loading: paymentsLoading, error: paymentsError, run: reloadPayments } = useFetch(
    () => getPaymentsForPurchase(id),
    [id],
  );
  const { data: movements, loading: movementsLoading, error: movementsError, run: reloadMovements } = useFetch(
    () => getMovementsForPurchase(id),
    [id],
  );
  const { data: audit, loading: auditLoading, error: auditError, run: reloadAudit } = useFetch(
    () => getPurchaseAudit(id),
    [id],
  );

  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('UPI');
  const [paymentDate, setPaymentDate] = useState(today());
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [paymentKey, setPaymentKey] = useState(() => newIdempotencyKey('PURCHASE_PAYMENT'));
  const [savingPayment, setSavingPayment] = useState(false);
  const [repairingStock, setRepairingStock] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [editingOpen, setEditingOpen] = useState(false);

  const totals = useMemo(
    () => purchase ? getPurchaseTotals(purchase, payments ?? []) : null,
    [purchase, payments],
  );

  const hasInitialStock = Boolean(
    purchase && (movements ?? []).some((movement) => movement.movementKey_c === 'PURCHASE:' + purchase.Id),
  );

  async function refreshAll() {
    await Promise.all([reloadPurchase(), reloadPayments(), reloadMovements(), reloadAudit()]);
  }

  async function savePayment(event) {
    event.preventDefault();
    if (savingPayment || !purchase || !totals) return;
    setSavingPayment(true);

    try {
      const result = await addPurchasePayment(purchase.Id, {
        amount_c: paymentAmount,
        paymentMethod_c: paymentMethod,
        paymentDate_c: paymentDate,
        reference_c: paymentReference,
        notes_c: paymentNotes,
      }, paymentKey);

      toast.success(result.duplicate ? 'This payment was already recorded.' : 'Supplier payment recorded.');
      if (!result.summarySynced) {
        toast.warning('Payment is saved. The displayed balance is recalculated from the payment ledger.');
      }
      setPaymentAmount('');
      setPaymentReference('');
      setPaymentNotes('');
      setPaymentKey(newIdempotencyKey('PURCHASE_PAYMENT'));
      setShowPaymentForm(false);
      await Promise.all([reloadPayments(), reloadPurchase(), reloadAudit()]);
    } catch (error) {
      toast.error('Could not record payment', { description: error.message ?? String(error) });
    } finally {
      setSavingPayment(false);
    }
  }

  async function repairStockLink() {
    if (!purchase || repairingStock || purchase.recordStatus_c === 'Cancelled') return;
    setRepairingStock(true);
    try {
      const movement = await repairPurchaseStockMovement(purchase);
      toast.success(movement ? 'Inventory movement is linked to this purchase.' : 'No stock movement was needed.');
      await Promise.all([reloadMovements(), reloadAudit()]);
    } catch (error) {
      toast.error('Could not link stock movement', { description: error.message ?? String(error) });
    } finally {
      setRepairingStock(false);
    }
  }

  async function doCancel() {
    if (!purchase || !isAdmin || cancelling) return;
    setCancelling(true);
    try {
      await cancelPurchase(purchase.Id, cancelReason);
      toast.success('Purchase cancelled and stock reversal recorded.');
      setCancelReason('');
      setEditingOpen(false);
      await refreshAll();
    } catch (error) {
      toast.error('Could not cancel purchase', { description: error.message ?? String(error) });
    } finally {
      setCancelling(false);
    }
  }

  if (purchaseLoading || paymentsLoading || movementsLoading) {
    return <div className="space-y-4"><Skeleton className="h-8 w-1/2"/><Skeleton className="h-40 w-full"/><Skeleton className="h-40 w-full"/></div>;
  }

  if (purchaseError || !purchase) {
    return (
      <div className="space-y-3">
        <h1 className="font-heading text-2xl font-semibold">Purchase not found</h1>
        <p className="text-sm text-muted-foreground">{purchaseError?.message ?? 'This purchase may have been removed or you may not have access.'}</p>
        <Button variant="outline" className="rounded-sm" onClick={() => refreshAll()}>Retry</Button>
        <Button asChild variant="ghost" className="rounded-sm"><Link to="/purchases">Back to purchases</Link></Button>
      </div>
    );
  }

  const initialRows = InitialPaymentHistory({ purchase });
  const paymentHistory = [
    ...initialRows.map((row) => ({
      Id: row.id,
      title: row.title,
      paymentDate_c: row.date,
      paymentMethod_c: row.method,
      amount_c: row.amount,
      notes_c: row.note,
    })),
    ...(payments ?? []).map((row) => ({
      Id: row.Id,
      title: 'Subsequent payment · ' + row.paymentRef_c,
      paymentDate_c: row.paymentDate_c,
      paymentMethod_c: row.paymentMethod_c,
      amount_c: row.amount_c,
      notes_c: row.notes_c || row.reference_c || '',
    })),
  ].sort((a, b) => String(b.paymentDate_c).localeCompare(String(a.paymentDate_c)));

  const itemName = purchase.stockItem_c?.Name ?? 'Stock item';
  const hasPayments = paymentHistory.length > 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2 rounded-sm">
        <Link to="/purchases"><ApperIcon name="ArrowLeft" size={16}/> Back to purchase history</Link>
      </Button>

      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Purchase record / {itemName}</p>
          <h1 className="font-heading text-3xl font-semibold tracking-tight">{purchase.purchaseRef_c}</h1>
          <div className="mt-3 flex flex-wrap gap-2">
            <StatusLabel status={totals?.paymentStatus ?? purchase.paymentStatus_c} />
            <StatusLabel status={purchase.recordStatus_c} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {isAdmin && purchase.recordStatus_c === 'Active' && (
            <Button asChild variant="outline" className="rounded-sm">
              <Link to={'/purchases/' + purchase.Id + '/edit'}><ApperIcon name="Pencil" size={15}/> Edit purchase</Link>
            </Button>
          )}
          {purchase.recordStatus_c === 'Active' && totals?.outstanding > 0 && (
            <Button className="rounded-sm" onClick={() => setShowPaymentForm((value) => !value)}>
              <ApperIcon name="Plus" size={15}/> Add payment
            </Button>
          )}
          {isAdmin && purchase.recordStatus_c === 'Active' && (
            <AlertDialog open={editingOpen} onOpenChange={setEditingOpen}>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" className="rounded-sm"><ApperIcon name="Ban" size={15}/> Cancel purchase</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Cancel {purchase.purchaseRef_c}?</AlertDialogTitle>
                  <AlertDialogDescription>The app will preserve the purchase record and add a stock reversal to the movement history. Cancellation is blocked if the available item balance is too low to reverse safely.</AlertDialogDescription>
                </AlertDialogHeader>
                <div className="space-y-1.5">
                  <label htmlFor="cancel-reason" className="block text-sm font-medium">Reason for cancellation</label>
                  <Textarea id="cancel-reason" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="Enter the reason; this is retained in the audit trail." rows={3}/>
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={cancelling}>Keep purchase</AlertDialogCancel>
                  <AlertDialogAction disabled={cancelling || !cancelReason.trim()} onClick={(event) => { event.preventDefault(); doCancel(); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    {cancelling ? 'Cancelling…' : 'Confirm cancellation'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Purchase total" value={formatInr(purchase.totalPurchaseValue_c)} note={kgFormat(purchase.quantityKg_c) + ' kg purchased'} icon="ShoppingCart"/>
        <MetricCard label="Total paid" value={formatInr(totals?.totalPaid)} note="Initial payments plus later payments" icon="BadgeIndianRupee"/>
        <MetricCard label="Outstanding" value={formatInr(totals?.outstanding)} note="Remaining supplier balance" icon="Clock"/>
        <MetricCard label="Price per kg" value={formatInr(purchase.pricePerKg_c)} note={localDate(purchase.purchaseDate_c)} icon="Scale"/>
      </div>

      {!hasInitialStock && purchase.recordStatus_c === 'Active' && (
        <div className="flex flex-col justify-between gap-3 border border-warning-border bg-warning-muted p-4 sm:flex-row sm:items-center">
          <div><p className="font-semibold text-warning-foreground">Inventory link needs attention</p><p className="mt-1 text-sm text-warning-foreground/90">The purchase exists, but no matching purchase stock-in movement was found. Retry to reconcile it without creating a second matching movement.</p></div>
          <Button variant="outline" onClick={repairStockLink} disabled={repairingStock} className="rounded-sm">{repairingStock ? 'Checking…' : 'Repair stock link'}</Button>
        </div>
      )}

      <section className="grid gap-5 xl:grid-cols-[1fr_0.8fr]">
        <div className="border border-border bg-card shadow-sm">
          <div className="border-b border-border px-5 py-4"><h2 className="font-heading text-xl font-semibold">Stock details</h2></div>
          <dl className="grid sm:grid-cols-2">
            <DetailField label="Purchase ID" value={purchase.purchaseRef_c}/>
            <DetailField label="Stock item" value={itemName}/>
            <DetailField label="Quantity" value={kgFormat(purchase.quantityKg_c) + ' kg'}/>
            <DetailField label="Price per kg" value={formatInr(purchase.pricePerKg_c)}/>
            <DetailField label="Purchase date" value={localDate(purchase.purchaseDate_c)}/>
            <DetailField label="Supplier" value={purchase.supplierName_c || '—'}/>
            <DetailField label="Notes" value={purchase.notes_c || '—'} wide/>
          </dl>
        </div>
        <div className="border border-border bg-card shadow-sm">
          <div className="border-b border-border px-5 py-4"><h2 className="font-heading text-xl font-semibold">Payment breakdown</h2></div>
          <div className="space-y-4 p-5">
            <Breakdown label="Advance before purchase" amount={purchase.advanceAmount_c} detail={(purchase.advanceMethod_c || '—') + ' · ' + localDate(purchase.advanceDate_c || purchase.purchaseDate_c)}/>
            <Breakdown label="Cash at purchase" amount={purchase.cashAtPurchase_c} detail={localDate(purchase.purchaseDate_c)}/>
            <Breakdown label="Online at purchase" amount={purchase.onlineAtPurchase_c} detail={localDate(purchase.purchaseDate_c)}/>
            <Breakdown label="Subsequent payments" amount={totals?.laterPayments} detail={(payments ?? []).length + ' separate payment record(s)'}/>
            {purchase.recordStatus_c === 'Cancelled' && <div className="border-t border-border pt-3"><p className="text-xs font-semibold uppercase text-destructive">Cancellation reason</p><p className="mt-1 text-sm">{purchase.cancellationReason_c || '—'}</p><p className="mt-1 text-xs text-muted-foreground">{purchase.cancelledAt_c ? localDate(String(purchase.cancelledAt_c).slice(0,10)) : ''}</p></div>}
          </div>
        </div>
      </section>

      {showPaymentForm && purchase.recordStatus_c === 'Active' && totals?.outstanding > 0 && (
        <section className="border border-highlight/30 bg-highlight/5 p-5">
          <div className="mb-4"><p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-highlight">Supplier settlement</p><h2 className="mt-2 font-heading text-xl font-semibold">Add a payment</h2><p className="mt-1 text-sm text-muted-foreground">Outstanding balance: <strong>{formatInr(totals.outstanding)}</strong></p></div>
          <form className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" onSubmit={savePayment}>
            <div className="space-y-1.5"><label htmlFor="payment-amount" className="block text-sm font-medium">Payment amount (₹) *</label><Input id="payment-amount" type="number" min="0.01" step="0.01" max={totals.outstanding} required value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} placeholder="0.00" disabled={savingPayment}/></div>
            <div className="space-y-1.5"><label htmlFor="payment-method" className="block text-sm font-medium">Method *</label><select id="payment-method" required value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} disabled={savingPayment} className="h-9 w-full rounded-sm border border-input bg-background px-3 text-sm">{PAYMENT_METHODS.map((method) => <option key={method} value={method}>{method}</option>)}</select></div>
            <div className="space-y-1.5"><label htmlFor="payment-date" className="block text-sm font-medium">Payment date *</label><Input id="payment-date" type="date" required value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} disabled={savingPayment} className="rounded-sm"/></div>
            <div className="space-y-1.5"><label htmlFor="payment-reference" className="block text-sm font-medium">Reference number</label><Input id="payment-reference" value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} placeholder="UPI reference / receipt" disabled={savingPayment}/></div>
            <div className="space-y-1.5 md:col-span-2 xl:col-span-3"><label htmlFor="payment-notes" className="block text-sm font-medium">Notes</label><Input id="payment-notes" value={paymentNotes} onChange={(event) => setPaymentNotes(event.target.value)} placeholder="Optional note about this payment" disabled={savingPayment}/></div>
            <div className="flex items-end gap-2"><Button type="submit" disabled={savingPayment || Number(paymentAmount) <= 0 || Number(paymentAmount) > totals.outstanding + 0.005} className="rounded-sm">{savingPayment ? 'Saving…' : 'Save payment'}</Button><Button type="button" variant="outline" onClick={() => setShowPaymentForm(false)} disabled={savingPayment} className="rounded-sm">Close</Button></div>
          </form>
        </section>
      )}

      <section className="border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-4"><div><h2 className="font-heading text-xl font-semibold">Payment history</h2><p className="mt-1 text-xs text-muted-foreground">Advance and purchase-date payments are distinguished from later instalments.</p></div><span className="text-xs text-muted-foreground">{paymentHistory.length} entries</span></div>
        {paymentsError ? <div className="p-5 text-sm text-destructive">{paymentsError.message}</div> : !hasPayments ? <div className="p-8 text-center"><ApperIcon name="CreditCard" size={26} className="mx-auto text-muted-foreground"/><p className="mt-2 font-semibold">No payments recorded</p><p className="mt-1 text-sm text-muted-foreground">This purchase is currently on credit.</p></div> : <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><thead className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-4 py-3">Payment</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Method</th><th className="px-4 py-3">Notes / reference</th><th className="px-4 py-3 text-right">Amount</th></tr></thead><tbody className="divide-y divide-border">{paymentHistory.map((payment) => <tr key={payment.Id}><td className="px-4 py-3 font-medium">{payment.title}</td><td className="px-4 py-3">{localDate(payment.paymentDate_c)}</td><td className="px-4 py-3">{payment.paymentMethod_c}</td><td className="px-4 py-3 text-muted-foreground">{payment.notes_c || '—'}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{formatInr(payment.amount_c)}</td></tr>)}</tbody></table></div>}
      </section>

      <section className="border border-border bg-card shadow-sm">
        <div className="border-b border-border px-5 py-4"><h2 className="font-heading text-xl font-semibold">Inventory movement & audit trail</h2><p className="mt-1 text-xs text-muted-foreground">Reversals and quantity changes are represented as new adjustments instead of deleting the original movement.</p></div>
        {movementsError || auditError ? <div className="p-5 text-sm text-destructive">{movementsError?.message ?? auditError?.message}</div> : (
          <div className="grid gap-0 md:grid-cols-2">
            <div className="border-b border-border p-5 md:border-b-0 md:border-r">
              <h3 className="text-sm font-semibold">Linked stock movements</h3>
              {movements?.length ? <div className="mt-3 space-y-3">{movements.map((movement) => <div key={movement.Id} className="flex items-start justify-between gap-3 border-b border-border pb-3 last:border-0"><div><p className="text-sm font-medium">{movement.Name}</p><p className="mt-1 text-xs text-muted-foreground">{movement.movementType_c} · {localDate(movement.movementDate_c)}</p><p className="mt-1 text-xs text-muted-foreground">Key: {movement.movementKey_c || 'Legacy movement'}</p></div><p className="whitespace-nowrap text-sm font-semibold">{kgFormat(movement.weightKg_c)} kg</p></div>)}</div> : <p className="mt-3 text-sm text-muted-foreground">No stock movement is linked to this purchase yet.</p>}
              {purchase.recordStatus_c === 'Active' && !hasInitialStock && <Button onClick={repairStockLink} disabled={repairingStock} variant="outline" className="mt-3 rounded-sm">{repairingStock ? 'Checking…' : 'Repair stock-in link'}</Button>}
            </div>
            <div className="p-5">
              <h3 className="text-sm font-semibold">Audit events</h3>
              {auditLoading ? <Skeleton className="mt-3 h-16 w-full"/> : audit?.length ? <div className="mt-3 space-y-3">{audit.map((event) => <div key={event.Id} className="flex gap-3 border-b border-border pb-3 last:border-0"><span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted"><ApperIcon name="ClipboardList" size={14}/></span><div><p className="text-sm font-medium">{event.action_c}</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{event.summary_c}</p><p className="mt-1 text-[10px] text-muted-foreground">{localDate(String(event.eventAt_c ?? '').slice(0,10))}</p></div></div>)}</div> : <p className="mt-3 text-sm text-muted-foreground">No audit events have been recorded.</p>}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function DetailField({ label, value, wide = false }) {
  return <div className={'border-b border-border/70 px-5 py-4 ' + (wide ? 'sm:col-span-2' : '')}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-words text-sm font-medium">{value}</dd></div>;
}

function Breakdown({ label, amount, detail }) {
  return <div className="flex items-start justify-between gap-4 border-b border-border pb-3 last:border-0 last:pb-0"><div><p className="text-sm font-medium">{label}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div><p className="whitespace-nowrap text-sm font-semibold tabular-nums">{formatInr(amount)}</p></div>;
}
