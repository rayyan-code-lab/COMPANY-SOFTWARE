/**
 * PayrollModule.jsx
 *
 * Attendance-driven payroll reconciliation system for Foundry Company Manager.
 *
 * Features:
 * - Direct connection between daily attendance entries and earned wages
 * - Dynamic rollups for any period (Monthly, Weekly, Daily) via PeriodFilter
 * - Full tracking of wage payments and advances against wages
 * - Accurate net outstanding vs advance balance carried forward
 * - Worker-level itemized wage statement modal
 * - Inline Record Payment / Advance modal with duplicate prevention
 * - Secondary tab preserving legacy payroll_c records
 */
import { useMemo, useState } from 'react';
import { sdk } from '@/services/sdk';
import { useFetch } from '@/hooks/useFetch';
import { useProfile } from '@/hooks/useProfile';
import { getTableAccess } from '@/services/userPermissions';
import {
  todayLocal,
  getPeriodBounds,
  formatPeriodLabel,
  filterPayrollByPeriod,
} from '@/utils/period';
import {
  formatINR,
  computeWorkerPeriodRollup,
  recordWorkerPayment,
} from '@/services/wageWorkflow';
import PeriodFilter from '@/components/PeriodFilter';
import ApperIcon from '@/components/ApperIcon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

export function PayrollList() {
  const { profile } = useProfile();
  const payrollPermission = getTableAccess(profile, 'payroll_c');
  const paymentPermission = getTableAccess(profile, 'worker_payments_c');

  // Active view tab: 'ledger' (dynamic attendance-based) | 'legacy' (historical payroll_c records)
  const [activeTab, setActiveTab] = useState('ledger');

  // Search filter
  const [search, setSearch] = useState('');

  // Period state — default: current month
  const [view, setView] = useState('monthly');
  const [anchor, setAnchor] = useState(todayLocal);

  // Period bounds
  const { start, end } = useMemo(() => getPeriodBounds(view, anchor), [view, anchor]);

  // Modal states
  const [statementWorker, setStatementWorker] = useState(null);
  const [paymentWorker, setPaymentWorker] = useState(null);

  // Payment dialog form state
  const [paymentForm, setPaymentForm] = useState({
    paymentType: 'Wage Payment', // 'Wage Payment' | 'Advance'
    amount: '',
    paymentDate: todayLocal(),
    paymentMethod: 'Cash',
    notes: '',
  });
  const [paymentSaving, setPaymentSaving] = useState(false);

  // 1. Fetch Workers
  const {
    data: workersData,
    loading: workersLoading,
  } = useFetch(async () => {
    const res = await sdk
      .table('workers_c')
      .select(['Id', 'Name', 'role_c', 'dailyRate_c', 'workerType_c', 'status_c'])
      .orderBy('Name')
      .page(1, 200)
      .fetch();
    if (!res.success) throw new Error(res.message || 'Unable to load workers');
    return res.data ?? [];
  }, []);

  const workers = workersData ?? [];

  // 2. Fetch Attendance records
  const {
    data: attendanceData,
    loading: attendanceLoading,
    run: reloadAttendance,
  } = useFetch(async () => {
    const res = await sdk
      .table('attendance_c')
      .select([
        'Id',
        'Name',
        'worker_c',
        'attendanceDate_c',
        'status_c',
        'attendanceUnits_c',
        'dailyRateSnapshot_c',
        'earnedWage_c',
        'overtimeHours_c',
        'notes_c',
      ])
      .page(1, 1000)
      .fetch();
    if (!res.success) throw new Error(res.message || 'Unable to load attendance records');
    return res.data ?? [];
  }, []);

  const attendance = attendanceData ?? [];

  // 3. Fetch Worker Payments & Advances
  const {
    data: paymentsData,
    loading: paymentsLoading,
    run: reloadPayments,
  } = useFetch(async () => {
    const res = await sdk
      .table('worker_payments_c')
      .select([
        'Id',
        'Name',
        'worker_c',
        'paymentType_c',
        'amount_c',
        'paymentDate_c',
        'paymentMethod_c',
        'periodStart_c',
        'periodEnd_c',
        'notes_c',
      ])
      .page(1, 1000)
      .fetch();
    if (!res.success) throw new Error(res.message || 'Unable to load worker payments');
    return res.data ?? [];
  }, []);

  const payments = paymentsData ?? [];

  // 4. Fetch Legacy Payroll records (for the secondary tab)
  const {
    data: legacyPayrollData,
    loading: legacyPayrollLoading,
    run: reloadLegacy,
  } = useFetch(async () => {
    const res = await sdk
      .table('payroll_c')
      .select([
        'Id',
        'Name',
        'worker_c',
        'payPeriod_c',
        'daysPresent_c',
        'grossPay_c',
        'advance_c',
        'deductions_c',
        'netPay_c',
        'status_c',
        'paidOn_c',
        'notes_c',
      ])
      .orderByDesc('CreatedOn')
      .page(1, 200)
      .fetch();
    if (!res.success) throw new Error(res.message || 'Unable to load payroll history');
    return res.data ?? [];
  }, []);

  const legacyRecords = legacyPayrollData ?? [];
  const filteredLegacyRecords = useMemo(
    () => filterPayrollByPeriod(legacyRecords, start, end),
    [legacyRecords, start, end]
  );

  // Compute rollups for all workers for the selected period
  const workerRollups = useMemo(() => {
    return workers.map((w) =>
      computeWorkerPeriodRollup(w, attendance, payments, start, end)
    );
  }, [workers, attendance, payments, start, end]);

  // Filter rollups by search query and exclude inactive workers with zero activity in this period
  const filteredRollups = useMemo(() => {
    return workerRollups
      .filter((r) => {
        // Exclude completely inactive workers who have no attendance and no payments in this period
        if (
          r.worker.status_c === 'Inactive' &&
          r.totalEarned === 0 &&
          r.totalDisbursed === 0
        ) {
          return false;
        }
        return true;
      })
      .filter((r) => {
        if (!search.trim()) return true;
        const q = search.toLowerCase();
        return (
          r.worker.Name.toLowerCase().includes(q) ||
          (r.worker.role_c && r.worker.role_c.toLowerCase().includes(q))
        );
      });
  }, [workerRollups, search]);

  // Aggregate period summary
  const periodTotals = useMemo(() => {
    let earned = 0;
    let advances = 0;
    let wagePayments = 0;
    let outstanding = 0;
    let advanceCarried = 0;

    for (const r of workerRollups) {
      earned += r.totalEarned;
      advances += r.totalAdvances;
      wagePayments += r.totalWagePayments;
      outstanding += r.outstandingWagesDue;
      advanceCarried += r.advanceBalanceCarriedForward;
    }

    return {
      earned,
      advances,
      wagePayments,
      totalDisbursed: advances + wagePayments,
      outstanding,
      advanceCarried,
    };
  }, [workerRollups]);

  // Open Record Payment modal with preselected worker
  const handleOpenPaymentModal = (worker, suggestedAmount = null) => {
    setPaymentWorker(worker);
    setPaymentForm({
      paymentType: 'Wage Payment',
      amount: suggestedAmount != null && suggestedAmount > 0 ? String(suggestedAmount) : '',
      paymentDate: todayLocal(),
      paymentMethod: 'Cash',
      notes: '',
    });
  };

  // Submit payment / advance
  const handleSubmitPayment = async (e) => {
    e.preventDefault();
    if (!paymentWorker) return;
    const amt = Number(paymentForm.amount);
    if (isNaN(amt) || amt <= 0) {
      toast.error('Enter a valid payment amount');
      return;
    }

    // Check for potential duplicate payment in this period
    if (paymentForm.paymentType === 'Wage Payment') {
      const existingPay = payments.find((p) => {
        const isSameWorker =
          p.worker_c?.Id === paymentWorker.Id ||
          p.worker_c?.Name?.toLowerCase() === paymentWorker.Name?.toLowerCase();
        return isSameWorker && p.paymentType_c === 'Wage Payment' && p.paymentDate_c === paymentForm.paymentDate;
      });

      if (existingPay) {
        const confirmed = window.confirm(
          `A wage payment of ${formatINR(existingPay.amount_c)} has already been recorded for ${paymentWorker.Name} on ${paymentForm.paymentDate}. Do you want to record an additional payment?`
        );
        if (!confirmed) return;
      }
    }

    setPaymentSaving(true);
    try {
      await recordWorkerPayment({
        worker: paymentWorker,
        paymentType: paymentForm.paymentType,
        amount: amt,
        paymentDate: paymentForm.paymentDate,
        paymentMethod: paymentForm.paymentMethod,
        periodStart: start,
        periodEnd: end,
        notes: paymentForm.notes,
      });

      toast.success(
        `Recorded ${paymentForm.paymentType.toLowerCase()} of ${formatINR(amt)} for ${paymentWorker.Name}.`
      );

      setPaymentWorker(null);
      await reloadPayments();
    } catch (err) {
      toast.error('Could not record payment', {
        description: err.message || String(err),
      });
    } finally {
      setPaymentSaving(false);
    }
  };

  // Compute selected worker statement details
  const currentStatement = useMemo(() => {
    if (!statementWorker) return null;
    return computeWorkerPeriodRollup(statementWorker, attendance, payments, start, end);
  }, [statementWorker, attendance, payments, start, end]);

  const isLoading = workersLoading || attendanceLoading || paymentsLoading;

  return (
    <div className="space-y-6">
      {/* Page Title & View Switcher */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
            Finance / People
          </p>
          <h1 className="font-heading text-3xl font-semibold">Payroll & Wages</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Attendance-calculated daily wages, advance deductions, and payout reconciliation.
          </p>
        </div>

        {/* View switcher tabs */}
        <div className="inline-flex rounded-sm border border-border bg-muted p-1 text-xs font-medium">
          <button
            type="button"
            onClick={() => setActiveTab('ledger')}
            className={`flex items-center gap-1.5 rounded-sm px-3 py-1.5 transition-colors ${
              activeTab === 'ledger'
                ? 'bg-background text-foreground shadow-sm font-semibold'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <ApperIcon name="WalletCards" size={14} />
            Period Wage Ledger
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('legacy')}
            className={`flex items-center gap-1.5 rounded-sm px-3 py-1.5 transition-colors ${
              activeTab === 'legacy'
                ? 'bg-background text-foreground shadow-sm font-semibold'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <ApperIcon name="History" size={14} />
            Historical Cycles
          </button>
        </div>
      </div>

      {/* Period Filter */}
      <PeriodFilter
        view={view}
        anchor={anchor}
        onViewChange={setView}
        onAnchorChange={setAnchor}
      />

      {/* TAB 1: ATTENDANCE-DRIVEN WAGE LEDGER */}
      {activeTab === 'ledger' && (
        <div className="space-y-6">
          {/* Period Summary KPI Cards */}
          <div className="grid gap-3 sm:grid-cols-4">
            <section className="border border-border bg-card p-4 shadow-sm">
              <p className="text-xs font-medium text-muted-foreground">Period Earned Wages</p>
              {isLoading ? (
                <Skeleton className="mt-2 h-7 w-28" />
              ) : (
                <p className="mt-1 font-heading text-2xl font-semibold tabular-nums text-foreground">
                  {formatINR(periodTotals.earned)}
                </p>
              )}
              <p className="mt-1 text-[11px] text-muted-foreground">Calculated from attendance</p>
            </section>

            <section className="border border-border bg-card p-4 shadow-sm">
              <p className="text-xs font-medium text-amber-700 dark:text-amber-400">Advances Paid</p>
              {isLoading ? (
                <Skeleton className="mt-2 h-7 w-28" />
              ) : (
                <p className="mt-1 font-heading text-2xl font-semibold tabular-nums text-amber-700 dark:text-amber-400">
                  {formatINR(periodTotals.advances)}
                </p>
              )}
              <p className="mt-1 text-[11px] text-muted-foreground">Deducted against earned pay</p>
            </section>

            <section className="border border-border bg-card p-4 shadow-sm">
              <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Wages Disbursed</p>
              {isLoading ? (
                <Skeleton className="mt-2 h-7 w-28" />
              ) : (
                <p className="mt-1 font-heading text-2xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                  {formatINR(periodTotals.wagePayments)}
                </p>
              )}
              <p className="mt-1 text-[11px] text-muted-foreground">Settled payments in period</p>
            </section>

            <section className="border border-border bg-card p-4 shadow-sm">
              <p className="text-xs font-medium text-primary">Outstanding Wages Due</p>
              {isLoading ? (
                <Skeleton className="mt-2 h-7 w-28" />
              ) : (
                <p className="mt-1 font-heading text-2xl font-semibold tabular-nums text-primary">
                  {formatINR(periodTotals.outstanding)}
                </p>
              )}
              {periodTotals.advanceCarried > 0 && (
                <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                  +{formatINR(periodTotals.advanceCarried)} advances carried forward
                </p>
              )}
            </section>
          </div>

          {/* Search bar and Quick Pay Action */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative max-w-md w-full">
              <ApperIcon
                name="Search"
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search workers in payroll ledger…"
                className="rounded-sm pl-9 text-xs"
              />
            </div>

            {paymentPermission.canCreate && (
              <Button
                variant="outline"
                size="sm"
                className="rounded-sm"
                onClick={() => handleOpenPaymentModal(workers[0] || null)}
                disabled={workers.length === 0}
              >
                <ApperIcon name="IndianRupee" size={15} /> Record Payment / Advance
              </Button>
            )}
          </div>

          {/* Worker Wage Reconciliation Table */}
          <section className="overflow-hidden border border-border bg-card shadow-sm">
            <div className="flex justify-between border-b border-border px-4 py-3">
              <b className="text-sm font-medium">Worker Wage Reconciliation Ledger</b>
              <span className="text-xs text-muted-foreground">
                Period: {formatPeriodLabel(view, anchor)}
              </span>
            </div>

            {isLoading && !filteredRollups.length ? (
              <div className="space-y-3 p-5">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : filteredRollups.length === 0 ? (
              <div className="p-10 text-center">
                <ApperIcon name="Users" size={28} className="mx-auto text-muted-foreground" />
                <p className="mt-3 font-semibold">No workers matching search</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[850px] text-left text-sm">
                  <thead className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Worker</th>
                      <th className="px-4 py-3 font-semibold">Attendance (Days)</th>
                      <th className="px-4 py-3 font-semibold text-right">Earned Wages</th>
                      <th className="px-4 py-3 font-semibold text-right">Advances Taken</th>
                      <th className="px-4 py-3 font-semibold text-right">Wages Paid</th>
                      <th className="px-4 py-3 font-semibold text-right">Net Balance Due</th>
                      <th className="px-4 py-3 font-semibold">Status</th>
                      <th className="px-4 py-3 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredRollups.map((r) => {
                      const hasAdvanceCarried = r.advanceBalanceCarriedForward > 0;
                      return (
                        <tr key={r.worker.Id} className="hover:bg-muted/40">
                          {/* Worker */}
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-foreground">{r.worker.Name}</span>
                              <Badge variant="outline" className="text-[10px] py-0 px-1.5 font-normal">
                                {r.worker.role_c || 'Worker'}
                              </Badge>
                              {r.worker.workerType_c === 'Temporary' && (
                                <Badge className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-700 text-[10px] py-0 px-1.5 font-normal">
                                  Helper
                                </Badge>
                              )}
                            </div>
                            <span className="text-[11px] text-muted-foreground">
                              Rate: {formatINR(r.worker.dailyRate_c)}/day
                            </span>
                          </td>

                          {/* Attendance Days */}
                          <td className="px-4 py-3 tabular-nums">
                            {r.totalUnits > 0 ? (
                              <div>
                                <span className="font-semibold">{r.totalUnits} day{r.totalUnits !== 1 ? 's' : ''}</span>
                                <span className="block text-[11px] text-muted-foreground">
                                  {r.fullDays}F · {r.halfDays}H {r.absentDays > 0 ? `· ${r.absentDays}A` : ''}
                                </span>
                              </div>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>

                          {/* Earned Wages */}
                          <td className="px-4 py-3 text-right font-medium tabular-nums text-foreground">
                            {formatINR(r.totalEarned)}
                          </td>

                          {/* Advances */}
                          <td className="px-4 py-3 text-right tabular-nums text-amber-700 dark:text-amber-400">
                            {r.totalAdvances > 0 ? `-${formatINR(r.totalAdvances)}` : '—'}
                          </td>

                          {/* Wages Paid */}
                          <td className="px-4 py-3 text-right tabular-nums text-emerald-700 dark:text-emerald-400">
                            {r.totalWagePayments > 0 ? `-${formatINR(r.totalWagePayments)}` : '—'}
                          </td>

                          {/* Net Outstanding Balance */}
                          <td className="px-4 py-3 text-right font-semibold tabular-nums">
                            {hasAdvanceCarried ? (
                              <span className="text-amber-600 dark:text-amber-400">
                                +{formatINR(r.advanceBalanceCarriedForward)} (Adv)
                              </span>
                            ) : (
                              <span className={r.outstandingWagesDue > 0 ? 'text-primary font-bold' : 'text-muted-foreground'}>
                                {formatINR(r.outstandingWagesDue)}
                              </span>
                            )}
                          </td>

                          {/* Status Badge */}
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-medium border ${
                                r.paymentStatus === 'Settled'
                                  ? 'bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                                  : r.paymentStatus === 'Advance Carried'
                                  ? 'bg-purple-50 text-purple-800 border-purple-300 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800'
                                  : r.paymentStatus === 'Partially Paid'
                                  ? 'bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'
                                  : r.paymentStatus === 'No Attendance'
                                  ? 'bg-muted text-muted-foreground border-border'
                                  : 'bg-rose-50 text-rose-800 border-rose-300 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800'
                              }`}
                            >
                              {r.paymentStatus}
                            </span>
                          </td>

                          {/* Actions */}
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs rounded-sm"
                                onClick={() => setStatementWorker(r.worker)}
                              >
                                Statement
                              </Button>
                              {paymentPermission.canCreate && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 px-2 text-xs rounded-sm"
                                  onClick={() => handleOpenPaymentModal(r.worker, r.outstandingWagesDue)}
                                >
                                  Pay
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {/* TAB 2: HISTORICAL CYCLES (LEGACY PAYROLL_C) */}
      {activeTab === 'legacy' && (
        <section className="overflow-hidden border border-border bg-card shadow-sm">
          <div className="flex justify-between border-b border-border px-4 py-3">
            <b className="text-sm font-medium">Historical Payroll Cycle Records</b>
            <span className="text-xs text-muted-foreground">
              {filteredLegacyRecords.length} record{filteredLegacyRecords.length !== 1 ? 's' : ''} in period
            </span>
          </div>

          {legacyPayrollLoading && !legacyPayrollData ? (
            <div className="space-y-3 p-5">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : filteredLegacyRecords.length === 0 ? (
            <div className="p-10 text-center">
              <ApperIcon name="WalletCards" size={28} className="mx-auto text-muted-foreground" />
              <p className="mt-3 font-semibold">No historical cycle records in this period</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[650px] text-left text-sm">
                <thead className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Worker</th>
                    <th className="px-4 py-3 font-semibold">Pay Period</th>
                    <th className="px-4 py-3 font-semibold">Days</th>
                    <th className="px-4 py-3 font-semibold text-right">Gross Pay</th>
                    <th className="px-4 py-3 font-semibold text-right">Advance</th>
                    <th className="px-4 py-3 font-semibold text-right">Net Pay</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredLegacyRecords.map((row) => (
                    <tr key={row.Id} className="hover:bg-muted/40">
                      <td className="px-4 py-3 font-medium">{row.worker_c?.Name || '—'}</td>
                      <td className="px-4 py-3 tabular-nums">{row.payPeriod_c || '—'}</td>
                      <td className="px-4 py-3 tabular-nums">{row.daysPresent_c ?? '—'}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatINR(row.grossPay_c)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatINR(row.advance_c)}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-primary">{formatINR(row.netPay_c)}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex border border-border bg-muted px-2 py-0.5 text-xs rounded-sm">
                          {row.status_c}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* WORKER WAGE STATEMENT MODAL */}
      {currentStatement && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto border border-border bg-card p-6 shadow-2xl rounded-sm">
            <div className="flex items-center justify-between border-b border-border pb-4">
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">
                  Worker Wage Statement
                </span>
                <h3 className="font-heading text-xl font-semibold">
                  {currentStatement.worker.Name}
                </h3>
                <p className="text-xs text-muted-foreground">
                  Role: {currentStatement.worker.role_c} · Base Rate: {formatINR(currentStatement.worker.dailyRate_c)}/day
                  · Period: {formatPeriodLabel(view, anchor)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setStatementWorker(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <ApperIcon name="X" size={20} />
              </button>
            </div>

            {/* Reconciliation Math Summary Box */}
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 bg-muted/30 p-4 border border-border rounded-sm">
              <div>
                <p className="text-[11px] text-muted-foreground">Total Units</p>
                <p className="font-heading text-lg font-semibold">{currentStatement.totalUnits} days</p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">Earned Wages</p>
                <p className="font-heading text-lg font-semibold text-foreground">
                  {formatINR(currentStatement.totalEarned)}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">Advances & Payments</p>
                <p className="font-heading text-lg font-semibold text-amber-600 dark:text-amber-400">
                  -{formatINR(currentStatement.totalDisbursed)}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">Net Balance</p>
                {currentStatement.advanceBalanceCarriedForward > 0 ? (
                  <p className="font-heading text-lg font-semibold text-purple-600 dark:text-purple-400">
                    +{formatINR(currentStatement.advanceBalanceCarriedForward)} (Adv Carried)
                  </p>
                ) : (
                  <p className="font-heading text-lg font-semibold text-primary">
                    {formatINR(currentStatement.outstandingWagesDue)}
                  </p>
                )}
              </div>
            </div>

            {/* Itemized Daily Attendance Section */}
            <div className="mt-6">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Daily Attendance Breakdown ({currentStatement.attendanceRecords.length} recorded dates)
              </h4>
              {currentStatement.attendanceRecords.length === 0 ? (
                <p className="text-xs text-muted-foreground italic p-3 border border-dashed border-border rounded-sm text-center">
                  No attendance entries recorded in this period.
                </p>
              ) : (
                <div className="overflow-x-auto border border-border rounded-sm">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-muted text-[10px] uppercase text-muted-foreground font-semibold">
                      <tr>
                        <th className="px-3 py-2">Date</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">Units</th>
                        <th className="px-3 py-2">Rate Snapshot</th>
                        <th className="px-3 py-2 text-right">Earned</th>
                        <th className="px-3 py-2">Notes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {currentStatement.attendanceRecords.map((a) => (
                        <tr key={a.Id} className="hover:bg-muted/30">
                          <td className="px-3 py-2 tabular-nums">{a.attendanceDate_c}</td>
                          <td className="px-3 py-2 font-medium">{a.status_c}</td>
                          <td className="px-3 py-2 tabular-nums">{a.attendanceUnits_c ?? '—'}</td>
                          <td className="px-3 py-2 tabular-nums text-muted-foreground">{formatINR(a.dailyRateSnapshot_c)}</td>
                          <td className="px-3 py-2 text-right font-semibold tabular-nums text-primary">{formatINR(a.earnedWage_c)}</td>
                          <td className="px-3 py-2 text-muted-foreground truncate max-w-[140px]">{a.notes_c || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Itemized Payments & Advances Section */}
            <div className="mt-6">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Payments & Advances ({currentStatement.paymentRecords.length} transactions)
              </h4>
              {currentStatement.paymentRecords.length === 0 ? (
                <p className="text-xs text-muted-foreground italic p-3 border border-dashed border-border rounded-sm text-center">
                  No payments or advances recorded in this period.
                </p>
              ) : (
                <div className="overflow-x-auto border border-border rounded-sm">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-muted text-[10px] uppercase text-muted-foreground font-semibold">
                      <tr>
                        <th className="px-3 py-2">Payment Date</th>
                        <th className="px-3 py-2">Type</th>
                        <th className="px-3 py-2">Method</th>
                        <th className="px-3 py-2 text-right">Amount</th>
                        <th className="px-3 py-2">Notes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {currentStatement.paymentRecords.map((p) => (
                        <tr key={p.Id} className="hover:bg-muted/30">
                          <td className="px-3 py-2 tabular-nums">{p.paymentDate_c}</td>
                          <td className="px-3 py-2 font-medium">
                            <span
                              className={`px-1.5 py-0.5 rounded-xs text-[10px] border ${
                                p.paymentType_c === 'Advance'
                                  ? 'bg-amber-50 text-amber-800 border-amber-300'
                                  : 'bg-emerald-50 text-emerald-800 border-emerald-300'
                              }`}
                            >
                              {p.paymentType_c}
                            </span>
                          </td>
                          <td className="px-3 py-2">{p.paymentMethod_c}</td>
                          <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatINR(p.amount_c)}</td>
                          <td className="px-3 py-2 text-muted-foreground truncate max-w-[140px]">{p.notes_c || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="flex justify-between items-center border-t border-border mt-6 pt-4">
              <Button
                variant="outline"
                size="sm"
                className="rounded-sm text-xs"
                onClick={() => setStatementWorker(null)}
              >
                Close
              </Button>
              {paymentPermission.canCreate && currentStatement.outstandingWagesDue > 0 && (
                <Button
                  size="sm"
                  className="rounded-sm text-xs font-semibold"
                  onClick={() => {
                    const w = currentStatement.worker;
                    const due = currentStatement.outstandingWagesDue;
                    setStatementWorker(null);
                    handleOpenPaymentModal(w, due);
                  }}
                >
                  Pay Full Balance ({formatINR(currentStatement.outstandingWagesDue)})
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* RECORD PAYMENT / ADVANCE MODAL */}
      {paymentWorker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md border border-border bg-card p-6 shadow-xl rounded-sm">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h3 className="font-heading text-lg font-semibold">Record Payment / Advance</h3>
                <p className="text-xs text-muted-foreground">
                  Disburse money for {paymentWorker.Name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPaymentWorker(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <ApperIcon name="X" size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmitPayment} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold mb-1">Worker</label>
                <select
                  value={paymentWorker.Id}
                  onChange={(e) => {
                    const selected = workers.find((w) => w.Id === e.target.value);
                    if (selected) setPaymentWorker(selected);
                  }}
                  className="h-9 w-full rounded-sm border border-input bg-background px-3 text-sm"
                >
                  {workers.map((w) => (
                    <option key={w.Id} value={w.Id}>
                      {w.Name} ({w.role_c})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Transaction Type *</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPaymentForm({ ...paymentForm, paymentType: 'Wage Payment' })}
                    className={`rounded-sm py-2 px-3 text-xs font-semibold border transition-all ${
                      paymentForm.paymentType === 'Wage Payment'
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-card text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Wage Payment
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentForm({ ...paymentForm, paymentType: 'Advance' })}
                    className={`rounded-sm py-2 px-3 text-xs font-semibold border transition-all ${
                      paymentForm.paymentType === 'Advance'
                        ? 'border-amber-600 bg-amber-600 text-white'
                        : 'border-border bg-card text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Advance
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Amount (₹) *</label>
                <Input
                  type="number"
                  step="0.01"
                  required
                  placeholder="e.g. 5000"
                  value={paymentForm.amount}
                  onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                  className="rounded-sm text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1">Payment Date *</label>
                  <Input
                    type="date"
                    required
                    value={paymentForm.paymentDate}
                    onChange={(e) => setPaymentForm({ ...paymentForm, paymentDate: e.target.value })}
                    className="rounded-sm text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Payment Method</label>
                  <select
                    value={paymentForm.paymentMethod}
                    onChange={(e) => setPaymentForm({ ...paymentForm, paymentMethod: e.target.value })}
                    className="h-9 w-full rounded-sm border border-input bg-background px-3 text-sm"
                  >
                    <option value="Cash">Cash</option>
                    <option value="UPI">UPI</option>
                    <option value="Bank Transfer">Bank Transfer</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Notes (Optional)</label>
                <Input
                  placeholder="e.g. Weekly wage clearance"
                  value={paymentForm.notes}
                  onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })}
                  className="rounded-sm text-sm"
                />
              </div>

              <div className="flex justify-end gap-2 border-t border-border pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPaymentWorker(null)}
                  className="rounded-sm text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={paymentSaving}
                  className="rounded-sm text-xs font-semibold"
                >
                  {paymentSaving ? 'Saving…' : 'Record Transaction'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
