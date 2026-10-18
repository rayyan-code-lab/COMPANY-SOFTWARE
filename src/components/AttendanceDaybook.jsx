/**
 * AttendanceDaybook.jsx
 *
 * Daily attendance daybook & register for Foundry Company Manager.
 * Features:
 * - Direct daily daybook with live wage & metric recalculations
 * - Tap controls: Full Day (1 unit), Half Day (0.5 unit), Absent (0 unit), Unmark (pending)
 * - Quick-add temporary helper workflow with auto-deduplication
 * - Duplicate-prevention batch attendance persistence
 * - Immutable daily wage snapshots
 * - Secondary tab for historical attendance register with PeriodFilter and entry correction
 */
import { useEffect, useMemo, useState } from 'react';
import { sdk } from '@/services/sdk';
import { useFetch } from '@/hooks/useFetch';
import { useProfile } from '@/hooks/useProfile';
import { getTableAccess } from '@/services/userPermissions';
import { todayLocal, getPeriodBounds, stepPeriod, formatPeriodLabel, filterByPeriod } from '@/utils/period';
import {
  calculateUnits,
  calculateEarnedWage,
  formatINR,
  createOrReuseHelper,
  saveAttendanceEntries,
  matchWorker,
} from '@/services/wageWorkflow';
import PeriodFilter from '@/components/PeriodFilter';
import ApperIcon from '@/components/ApperIcon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

export default function AttendanceDaybook() {
  const { profile } = useProfile();
  const permission = getTableAccess(profile, 'attendance_c');

  // Active view tab: 'daybook' | 'register'
  const [activeTab, setActiveTab] = useState('daybook');

  // Selected date for daily daybook, defaulting to business today
  const [selectedDate, setSelectedDate] = useState(todayLocal);

  // Search & filter state
  const [search, setSearch] = useState('');
  const [workerTypeFilter, setWorkerTypeFilter] = useState('all'); // 'all' | 'Regular' | 'Temporary'

  // Local draft state for attendance entries: { [workerId]: { status, dailyRate, overtimeHours, notes, isDirty } }
  const [daybookDrafts, setDaybookDrafts] = useState({});
  const [isSaving, setIsSaving] = useState(false);

  // Temporary helper modal state
  const [showHelperModal, setShowHelperModal] = useState(false);
  const [helperForm, setHelperForm] = useState({
    name: '',
    dailyWage: '',
    status: 'Full Day',
    notes: '',
    saveAsWorker: false,
  });
  const [helperSaving, setHelperSaving] = useState(false);

  // Correction modal state (for historical register)
  const [editingRecord, setEditingRecord] = useState(null);
  const [editForm, setEditForm] = useState({
    status: 'Full Day',
    dailyRateSnapshot: '',
    overtimeHours: '',
    notes: '',
  });
  const [editSaving, setEditSaving] = useState(false);

  // Historical register period filter state
  const [regView, setRegView] = useState('monthly');
  const [regAnchor, setRegAnchor] = useState(todayLocal);
  const [regSearch, setRegSearch] = useState('');

  // 1. Fetch all workers
  const {
    data: workersData,
    loading: workersLoading,
    run: reloadWorkers,
  } = useFetch(async () => {
    const res = await sdk
      .table('workers_c')
      .select(['Id', 'Name', 'role_c', 'dailyRate_c', 'workerType_c', 'status_c'])
      .orderBy('Name')
      .page(1, 200)
      .fetch();
    if (!res.success) throw new Error(res.message || 'Failed to load workers');
    return res.data ?? [];
  }, []);

  const workers = workersData ?? [];

  // 2. Fetch attendance entries for selected date
  const {
    data: dayAttendanceData,
    loading: dayAttendanceLoading,
    run: reloadDayAttendance,
  } = useFetch(
    async () => {
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
          'hoursWorked_c',
          'overtimeHours_c',
          'notes_c',
        ])
        .where(window.ApperSDK.CoreSDK.eq('attendanceDate_c', selectedDate))
        .page(1, 200)
        .fetch();
      if (!res.success) throw new Error(res.message || 'Failed to load daily attendance');
      return res.data ?? [];
    },
    [selectedDate]
  );

  const dayAttendance = dayAttendanceData ?? [];

  // 3. Fetch historical attendance records for the register tab
  const {
    data: allAttendanceData,
    loading: allAttendanceLoading,
    run: reloadAllAttendance,
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
        'hoursWorked_c',
        'overtimeHours_c',
        'notes_c',
      ])
      .orderByDesc('attendanceDate_c')
      .page(1, 500)
      .fetch();
    if (!res.success) throw new Error(res.message || 'Failed to load attendance register');
    return res.data ?? [];
  }, []);

  const allAttendance = allAttendanceData ?? [];

  // Initialize/sync local draft state whenever dayAttendance or workers change
  useEffect(() => {
    if (!workers.length) return;

    const initialDrafts = {};
    // Active workers + any workers who have attendance recorded for this date
    const relevantWorkers = workers.filter((w) => {
      const hasRecord = dayAttendance.some(
        (a) => a.worker_c?.Id === w.Id || a.worker_c?.Name?.toLowerCase() === w.Name?.toLowerCase()
      );
      return w.status_c === 'Active' || hasRecord;
    });

    for (const w of relevantWorkers) {
      const existing = dayAttendance.find((a) => {
        return (
          a.worker_c?.Id === w.Id ||
          a.worker_c?.Name?.trim().toLowerCase() === w.Name?.trim().toLowerCase()
        );
      });

      if (existing) {
        let status = existing.status_c;
        if (status === 'Present') status = 'Full Day';
        initialDrafts[w.Id] = {
          recordId: existing.Id,
          status: status || 'Unmarked',
          dailyRate: Number(existing.dailyRateSnapshot_c ?? w.dailyRate_c ?? 0),
          overtimeHours: Number(existing.overtimeHours_c || 0),
          notes: existing.notes_c || '',
          isDirty: false,
        };
      } else {
        initialDrafts[w.Id] = {
          recordId: null,
          status: 'Unmarked',
          dailyRate: Number(w.dailyRate_c ?? 0),
          overtimeHours: 0,
          notes: '',
          isDirty: false,
        };
      }
    }

    setDaybookDrafts(initialDrafts);
  }, [selectedDate, dayAttendanceData, workersData]);

  // Update draft for a worker on tap
  const handleStatusChange = (workerId, newStatus) => {
    setDaybookDrafts((prev) => {
      const current = prev[workerId] || {};
      const toggledStatus = current.status === newStatus ? 'Unmarked' : newStatus;
      return {
        ...prev,
        [workerId]: {
          ...current,
          status: toggledStatus,
          isDirty: true,
        },
      };
    });
  };

  const handleNotesChange = (workerId, notes) => {
    setDaybookDrafts((prev) => ({
      ...prev,
      [workerId]: {
        ...(prev[workerId] || {}),
        notes,
        isDirty: true,
      },
    }));
  };

  // Check how many changes are unsaved
  const dirtyCount = useMemo(() => {
    return Object.values(daybookDrafts).filter((d) => d.isDirty).length;
  }, [daybookDrafts]);

  // Workers to display in Daybook
  const displayedWorkers = useMemo(() => {
    return workers
      .filter((w) => {
        // Active workers or workers who have draft/record today
        const hasDraft = daybookDrafts[w.Id] != null;
        return w.status_c === 'Active' || hasDraft;
      })
      .filter((w) => {
        if (workerTypeFilter === 'all') return true;
        if (workerTypeFilter === 'Regular') return (w.workerType_c || 'Regular') === 'Regular';
        if (workerTypeFilter === 'Temporary') return w.workerType_c === 'Temporary';
        return true;
      })
      .filter((w) => {
        if (!search.trim()) return true;
        const q = search.toLowerCase();
        return (
          w.Name.toLowerCase().includes(q) ||
          (w.role_c && w.role_c.toLowerCase().includes(q))
        );
      });
  }, [workers, daybookDrafts, workerTypeFilter, search]);

  // Calculate live summary metrics for the selected date
  const daySummary = useMemo(() => {
    let fullDay = 0;
    let halfDay = 0;
    let absent = 0;
    let unmarked = 0;
    let totalWages = 0;

    // Use all relevant active workers' current draft values
    for (const w of workers) {
      if (w.status_c !== 'Active' && !daybookDrafts[w.Id]) continue;
      const draft = daybookDrafts[w.Id];
      const status = draft?.status || 'Unmarked';
      const rate = draft?.dailyRate ?? w.dailyRate_c ?? 0;
      const ot = draft?.overtimeHours || 0;

      if (status === 'Full Day' || status === 'Present') {
        fullDay++;
        totalWages += calculateEarnedWage('Full Day', rate, ot);
      } else if (status === 'Half Day') {
        halfDay++;
        totalWages += calculateEarnedWage('Half Day', rate, ot);
      } else if (status === 'Absent' || status === 'Leave') {
        absent++;
      } else {
        unmarked++;
      }
    }

    return { fullDay, halfDay, absent, unmarked, totalWages };
  }, [workers, daybookDrafts]);

  // Save all changes in Daybook
  const handleSaveAttendance = async () => {
    if (!permission.canUpdate && !permission.canCreate) {
      toast.error('You do not have permission to record attendance.');
      return;
    }

    setIsSaving(true);
    try {
      const entriesToSave = [];
      for (const [wId, draft] of Object.entries(daybookDrafts)) {
        if (!draft) continue;
        const worker = workers.find((w) => w.Id === wId);
        if (!worker) continue;

        entriesToSave.push({
          workerId: worker.Id,
          workerName: worker.Name,
          status: draft.status,
          dailyRate: draft.dailyRate,
          overtimeHours: draft.overtimeHours,
          notes: draft.notes,
        });
      }

      const res = await saveAttendanceEntries({
        date: selectedDate,
        entries: entriesToSave,
        workers,
      });

      toast.success('Attendance saved successfully', {
        description: `Updated records for ${selectedDate}.`,
      });

      // Reload attendance and refresh drafts
      await reloadDayAttendance();
      await reloadAllAttendance();
    } catch (err) {
      toast.error('Failed to save attendance', {
        description: err.message || String(err),
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Add temporary helper
  const handleAddHelper = async (e) => {
    e.preventDefault();
    if (!helperForm.name.trim()) {
      toast.error('Enter helper name');
      return;
    }
    const wage = Number(helperForm.dailyWage);
    if (isNaN(wage) || wage < 0) {
      toast.error('Enter a valid daily wage rate');
      return;
    }

    setHelperSaving(true);
    try {
      const { worker, isNew } = await createOrReuseHelper({
        name: helperForm.name,
        dailyWage: wage,
        saveAsWorker: helperForm.saveAsWorker,
        date: selectedDate,
      });

      // Reload workers list
      await reloadWorkers();

      // Immediately add to daybook draft with selected status
      setDaybookDrafts((prev) => ({
        ...prev,
        [worker.Id]: {
          recordId: null,
          status: helperForm.status,
          dailyRate: wage,
          overtimeHours: 0,
          notes: helperForm.notes,
          isDirty: true,
        },
      }));

      toast.success(
        isNew
          ? `Added helper ${worker.Name} to daybook.`
          : `Reused existing profile for ${worker.Name}.`
      );

      // Reset modal
      setHelperForm({
        name: '',
        dailyWage: '',
        status: 'Full Day',
        notes: '',
        saveAsWorker: false,
      });
      setShowHelperModal(false);
    } catch (err) {
      toast.error('Could not add helper', {
        description: err.message || String(err),
      });
    } finally {
      setHelperSaving(false);
    }
  };

  // Open entry correction modal
  const handleOpenEditModal = (record) => {
    setEditingRecord(record);
    let st = record.status_c;
    if (st === 'Present') st = 'Full Day';
    setEditForm({
      status: st || 'Full Day',
      dailyRateSnapshot: String(record.dailyRateSnapshot_c ?? ''),
      overtimeHours: String(record.overtimeHours_c ?? 0),
      notes: record.notes_c || '',
    });
  };

  // Save correction in historical register
  const handleSaveCorrection = async (e) => {
    e.preventDefault();
    if (!editingRecord) return;
    setEditSaving(true);
    try {
      const units = calculateUnits(editForm.status);
      const rate = Number(editForm.dailyRateSnapshot || 0);
      const ot = Number(editForm.overtimeHours || 0);
      const earned = calculateEarnedWage(editForm.status, rate, ot);

      await sdk.table('attendance_c').update(editingRecord.Id, {
        status_c: editForm.status,
        attendanceUnits_c: units,
        dailyRateSnapshot_c: rate,
        earnedWage_c: earned,
        overtimeHours_c: ot,
        notes_c: editForm.notes,
      });

      toast.success('Attendance entry updated.');
      setEditingRecord(null);
      await reloadAllAttendance();
      if (editingRecord.attendanceDate_c === selectedDate) {
        await reloadDayAttendance();
      }
    } catch (err) {
      toast.error('Failed to update entry', {
        description: err.message || String(err),
      });
    } finally {
      setEditSaving(false);
    }
  };

  // Format nice day heading
  const dateFormattedHeading = useMemo(() => {
    const [y, m, d] = selectedDate.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d);
    return dateObj.toLocaleDateString('en-IN', {
      weekday: 'long',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }, [selectedDate]);

  // Historical register filtered records
  const { start: regStart, end: regEnd } = useMemo(
    () => getPeriodBounds(regView, regAnchor),
    [regView, regAnchor]
  );

  const filteredRegisterRows = useMemo(() => {
    const inPeriod = filterByPeriod(allAttendance, 'attendanceDate_c', regStart, regEnd);
    if (!regSearch.trim()) return inPeriod;
    const q = regSearch.toLowerCase();
    return inPeriod.filter((r) => {
      const wName = r.worker_c?.Name || '';
      return wName.toLowerCase().includes(q) || (r.notes_c && r.notes_c.toLowerCase().includes(q));
    });
  }, [allAttendance, regStart, regEnd, regSearch]);

  const isBusy = workersLoading || dayAttendanceLoading;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
            People / Operations
          </p>
          <h1 className="font-heading text-3xl font-semibold">Attendance</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Digitized daily attendance cards, temporary helper tracking, and wage calculation.
          </p>
        </div>

        {/* View switcher tabs */}
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-sm border border-border bg-muted p-1 text-xs font-medium">
            <button
              type="button"
              onClick={() => setActiveTab('daybook')}
              className={`flex items-center gap-1.5 rounded-sm px-3 py-1.5 transition-colors ${
                activeTab === 'daybook'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <ApperIcon name="CalendarCheck" size={14} />
              Daily Daybook
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('register')}
              className={`flex items-center gap-1.5 rounded-sm px-3 py-1.5 transition-colors ${
                activeTab === 'register'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <ApperIcon name="History" size={14} />
              Historical Register
            </button>
          </div>
        </div>
      </div>

      {/* TAB 1: DAILY DAYBOOK VIEW */}
      {activeTab === 'daybook' && (
        <div className="space-y-6">
          {/* Day Selector & Navigation Toolbar */}
          <div className="flex flex-col gap-4 border border-border bg-card p-4 shadow-sm md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-9 px-2.5 rounded-sm"
                onClick={() => setSelectedDate(stepPeriod('daily', selectedDate, -1))}
                aria-label="Previous Day"
              >
                <ApperIcon name="ChevronLeft" size={16} />
              </Button>
              <Input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="h-9 w-40 rounded-sm text-xs font-semibold"
                aria-label="Select Date"
              />
              <Button
                variant="outline"
                size="sm"
                className="h-9 px-2.5 rounded-sm"
                onClick={() => setSelectedDate(stepPeriod('daily', selectedDate, 1))}
                aria-label="Next Day"
              >
                <ApperIcon name="ChevronRight" size={16} />
              </Button>
              {selectedDate !== todayLocal() && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 text-xs rounded-sm"
                  onClick={() => setSelectedDate(todayLocal())}
                >
                  Jump to Today
                </Button>
              )}
            </div>

            <div className="text-left md:text-right">
              <p className="font-heading text-lg font-semibold">{dateFormattedHeading}</p>
              <p className="text-xs text-muted-foreground">
                {selectedDate === todayLocal() ? 'Today’s Attendance Sheet' : 'Historical Date Sheet'}
              </p>
            </div>
          </div>

          {/* Live Summary KPI Cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <section className="border border-border bg-card p-4 shadow-sm">
              <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Full day (1.0)</p>
              {isBusy ? (
                <Skeleton className="mt-2 h-7 w-12" />
              ) : (
                <p className="mt-1 font-heading text-2xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                  {daySummary.fullDay}
                </p>
              )}
            </section>

            <section className="border border-border bg-card p-4 shadow-sm">
              <p className="text-xs font-medium text-amber-700 dark:text-amber-400">Half day (0.5)</p>
              {isBusy ? (
                <Skeleton className="mt-2 h-7 w-12" />
              ) : (
                <p className="mt-1 font-heading text-2xl font-semibold tabular-nums text-amber-700 dark:text-amber-400">
                  {daySummary.halfDay}
                </p>
              )}
            </section>

            <section className="border border-border bg-card p-4 shadow-sm">
              <p className="text-xs font-medium text-rose-700 dark:text-rose-400">Absent (0.0)</p>
              {isBusy ? (
                <Skeleton className="mt-2 h-7 w-12" />
              ) : (
                <p className="mt-1 font-heading text-2xl font-semibold tabular-nums text-rose-700 dark:text-rose-400">
                  {daySummary.absent}
                </p>
              )}
            </section>

            <section className="border border-border bg-card p-4 shadow-sm">
              <p className="text-xs font-medium text-muted-foreground">Pending / Unmarked</p>
              {isBusy ? (
                <Skeleton className="mt-2 h-7 w-12" />
              ) : (
                <p className="mt-1 font-heading text-2xl font-semibold tabular-nums text-muted-foreground">
                  {daySummary.unmarked}
                </p>
              )}
            </section>

            <section className="border border-border bg-card p-4 shadow-sm col-span-2 sm:col-span-1">
              <p className="text-xs font-medium text-primary">Earned wages today</p>
              {isBusy ? (
                <Skeleton className="mt-2 h-7 w-24" />
              ) : (
                <p className="mt-1 font-heading text-2xl font-semibold tabular-nums text-primary">
                  {formatINR(daySummary.totalWages)}
                </p>
              )}
            </section>
          </div>

          {/* Action & Filter Toolbar */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              {/* Search */}
              <div className="relative w-full sm:w-64">
                <ApperIcon
                  name="Search"
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter workers…"
                  className="h-9 rounded-sm pl-8 text-xs"
                />
              </div>

              {/* Worker type filter */}
              <div className="inline-flex rounded-sm border border-border bg-muted p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setWorkerTypeFilter('all')}
                  className={`rounded-sm px-2.5 py-1 ${
                    workerTypeFilter === 'all' ? 'bg-background shadow-xs font-semibold' : 'text-muted-foreground'
                  }`}
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => setWorkerTypeFilter('Regular')}
                  className={`rounded-sm px-2.5 py-1 ${
                    workerTypeFilter === 'Regular' ? 'bg-background shadow-xs font-semibold' : 'text-muted-foreground'
                  }`}
                >
                  Regular
                </button>
                <button
                  type="button"
                  onClick={() => setWorkerTypeFilter('Temporary')}
                  className={`rounded-sm px-2.5 py-1 ${
                    workerTypeFilter === 'Temporary' ? 'bg-background shadow-xs font-semibold' : 'text-muted-foreground'
                  }`}
                >
                  Helpers
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Quick Add Helper Action */}
              <Button
                variant="outline"
                size="sm"
                className="rounded-sm"
                onClick={() => setShowHelperModal(true)}
              >
                <ApperIcon name="UserPlus" size={15} /> Add Helper
              </Button>

              {/* Save Attendance Button */}
              {permission.canUpdate && (
                <Button
                  onClick={handleSaveAttendance}
                  disabled={isSaving || isBusy}
                  className="rounded-sm font-semibold"
                >
                  <ApperIcon name="Save" size={15} />
                  {isSaving ? 'Saving…' : dirtyCount > 0 ? `Save Attendance (${dirtyCount})` : 'Save Attendance'}
                </Button>
              )}
            </div>
          </div>

          {/* Workers Attendance Daybook Table */}
          <section className="overflow-hidden border border-border bg-card shadow-sm">
            <div className="flex justify-between border-b border-border px-4 py-3">
              <b className="text-sm font-medium">Daily Attendance Daybook</b>
              <span className="text-xs text-muted-foreground">
                {displayedWorkers.length} worker{displayedWorkers.length !== 1 ? 's' : ''} listed
              </span>
            </div>

            {isBusy && !displayedWorkers.length ? (
              <div className="space-y-3 p-5">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : displayedWorkers.length === 0 ? (
              <div className="p-10 text-center">
                <ApperIcon name="Users" size={28} className="mx-auto text-muted-foreground" />
                <p className="mt-3 font-semibold">No workers found</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {search ? 'Try adjusting your search query.' : 'Add workers or helpers to start recording attendance.'}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] text-left text-sm">
                  <thead className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Worker</th>
                      <th className="px-4 py-3 font-semibold">Base Daily Wage</th>
                      <th className="px-4 py-3 font-semibold">Attendance Status</th>
                      <th className="px-4 py-3 font-semibold text-right">Earned Wage</th>
                      <th className="px-4 py-3 font-semibold">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {displayedWorkers.map((w) => {
                      const draft = daybookDrafts[w.Id] || {};
                      const currentStatus = draft.status || 'Unmarked';
                      const dailyRate = draft.dailyRate ?? w.dailyRate_c ?? 0;
                      const earned = calculateEarnedWage(currentStatus, dailyRate, draft.overtimeHours);

                      const isFullDay = currentStatus === 'Full Day' || currentStatus === 'Present';
                      const isHalfDay = currentStatus === 'Half Day';
                      const isAbsent = currentStatus === 'Absent';
                      const isUnmarked = currentStatus === 'Unmarked';

                      return (
                        <tr
                          key={w.Id}
                          className={`transition-colors hover:bg-muted/40 ${
                            draft.isDirty ? 'bg-primary/5' : ''
                          }`}
                        >
                          {/* Worker Name & Role & Badges */}
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-foreground">{w.Name}</span>
                              <Badge variant="outline" className="text-[10px] py-0 px-1.5 font-normal">
                                {w.role_c || 'Worker'}
                              </Badge>
                              {w.workerType_c === 'Temporary' && (
                                <Badge className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-700 text-[10px] py-0 px-1.5 font-normal">
                                  Helper
                                </Badge>
                              )}
                            </div>
                            {draft.isDirty && (
                              <span className="text-[10px] text-amber-600 font-medium">● Unsaved change</span>
                            )}
                          </td>

                          {/* Base Daily Wage */}
                          <td className="px-4 py-3 tabular-nums text-muted-foreground">
                            {formatINR(dailyRate)}/day
                          </td>

                          {/* Easy-to-tap Attendance Controls */}
                          <td className="px-4 py-3">
                            <div className="inline-flex items-center rounded-sm border border-border p-0.5 bg-muted/40 text-xs">
                              {/* Full Day Button */}
                              <button
                                type="button"
                                onClick={() => handleStatusChange(w.Id, 'Full Day')}
                                className={`flex items-center gap-1 rounded-sm px-3 py-1.5 font-medium transition-all ${
                                  isFullDay
                                    ? 'bg-emerald-600 text-white shadow-xs font-semibold'
                                    : 'text-muted-foreground hover:text-foreground'
                                }`}
                              >
                                Full day
                              </button>

                              {/* Half Day Button */}
                              <button
                                type="button"
                                onClick={() => handleStatusChange(w.Id, 'Half Day')}
                                className={`flex items-center gap-1 rounded-sm px-3 py-1.5 font-medium transition-all ${
                                  isHalfDay
                                    ? 'bg-amber-600 text-white shadow-xs font-semibold'
                                    : 'text-muted-foreground hover:text-foreground'
                                }`}
                              >
                                Half day
                              </button>

                              {/* Absent Button */}
                              <button
                                type="button"
                                onClick={() => handleStatusChange(w.Id, 'Absent')}
                                className={`flex items-center gap-1 rounded-sm px-3 py-1.5 font-medium transition-all ${
                                  isAbsent
                                    ? 'bg-rose-600 text-white shadow-xs font-semibold'
                                    : 'text-muted-foreground hover:text-foreground'
                                }`}
                              >
                                Absent
                              </button>

                              {/* Clear / Unmark Button */}
                              {!isUnmarked && (
                                <button
                                  type="button"
                                  onClick={() => handleStatusChange(w.Id, 'Unmarked')}
                                  title="Clear / Unmark"
                                  className="rounded-sm px-2 py-1.5 text-muted-foreground hover:text-foreground hover:bg-muted"
                                >
                                  <ApperIcon name="X" size={13} />
                                </button>
                              )}
                            </div>
                          </td>

                          {/* Live Calculated Daily Wage */}
                          <td className="px-4 py-3 text-right font-semibold tabular-nums">
                            {isUnmarked ? (
                              <span className="text-xs text-muted-foreground">Pending</span>
                            ) : (
                              <span className={earned > 0 ? 'text-primary' : 'text-muted-foreground'}>
                                {formatINR(earned)}
                              </span>
                            )}
                          </td>

                          {/* Notes */}
                          <td className="px-4 py-3">
                            <Input
                              value={draft.notes || ''}
                              onChange={(e) => handleNotesChange(w.Id, e.target.value)}
                              placeholder="Notes (optional)"
                              className="h-8 max-w-[200px] text-xs rounded-sm"
                            />
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

      {/* TAB 2: HISTORICAL ATTENDANCE REGISTER */}
      {activeTab === 'register' && (
        <div className="space-y-6">
          {/* Period Filter for Register */}
          <PeriodFilter
            view={regView}
            anchor={regAnchor}
            onViewChange={setRegView}
            onAnchorChange={setRegAnchor}
          />

          {/* Search bar */}
          <div className="relative max-w-md">
            <ApperIcon
              name="Search"
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={regSearch}
              onChange={(e) => setRegSearch(e.target.value)}
              placeholder="Search historical records by worker or note…"
              className="rounded-sm pl-9"
            />
          </div>

          {/* Historical Register Table */}
          <section className="overflow-hidden border border-border bg-card shadow-sm">
            <div className="flex justify-between border-b border-border px-4 py-3">
              <b className="text-sm font-medium">Historical Attendance Register</b>
              <span className="text-xs text-muted-foreground">
                {filteredRegisterRows.length} entry
                {filteredRegisterRows.length !== 1 ? 'ies' : ''} in period
              </span>
            </div>

            {allAttendanceLoading && !allAttendanceData ? (
              <div className="space-y-3 p-5">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : filteredRegisterRows.length === 0 ? (
              <div className="p-10 text-center">
                <ApperIcon name="CalendarCheck" size={28} className="mx-auto text-muted-foreground" />
                <p className="mt-3 font-semibold">No attendance records in this period</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Try selecting a different date range or marking attendance in the Daybook.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] text-left text-sm">
                  <thead className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Worker</th>
                      <th className="px-4 py-3 font-semibold">Date</th>
                      <th className="px-4 py-3 font-semibold">Attendance</th>
                      <th className="px-4 py-3 font-semibold">Units</th>
                      <th className="px-4 py-3 font-semibold">Wage Snapshot</th>
                      <th className="px-4 py-3 font-semibold text-right">Earned Wage</th>
                      <th className="px-4 py-3 font-semibold">Notes</th>
                      <th className="px-4 py-3 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredRegisterRows.map((r) => {
                      const units =
                        r.attendanceUnits_c != null
                          ? Number(r.attendanceUnits_c)
                          : calculateUnits(r.status_c);
                      const rate = Number(r.dailyRateSnapshot_c || 0);
                      const earned =
                        r.earnedWage_c != null
                          ? Number(r.earnedWage_c)
                          : calculateEarnedWage(r.status_c, rate, r.overtimeHours_c);

                      return (
                        <tr key={r.Id} className="hover:bg-muted/40">
                          <td className="px-4 py-3 font-medium text-foreground">
                            {r.worker_c?.Name || '—'}
                          </td>
                          <td className="px-4 py-3 tabular-nums">{r.attendanceDate_c}</td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-medium border ${
                                r.status_c === 'Full Day' || r.status_c === 'Present'
                                  ? 'bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                                  : r.status_c === 'Half Day'
                                  ? 'bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'
                                  : 'bg-rose-50 text-rose-800 border-rose-300 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800'
                              }`}
                            >
                              {r.status_c}
                            </span>
                          </td>
                          <td className="px-4 py-3 tabular-nums">{units}</td>
                          <td className="px-4 py-3 tabular-nums text-muted-foreground">
                            {rate > 0 ? formatINR(rate) : '—'}
                          </td>
                          <td className="px-4 py-3 text-right font-semibold tabular-nums text-primary">
                            {formatINR(earned)}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground max-w-[180px] truncate">
                            {r.notes_c || '—'}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {permission.canUpdate && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs rounded-sm"
                                onClick={() => handleOpenEditModal(r)}
                              >
                                <ApperIcon name="Edit" size={13} /> Edit
                              </Button>
                            )}
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

      {/* QUICK ADD HELPER MODAL */}
      {showHelperModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md border border-border bg-card p-6 shadow-xl rounded-sm">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h3 className="font-heading text-lg font-semibold">Quick Add Helper</h3>
                <p className="text-xs text-muted-foreground">
                  Record a temporary worker for {selectedDate}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowHelperModal(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <ApperIcon name="X" size={18} />
              </button>
            </div>

            <form onSubmit={handleAddHelper} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold mb-1">Helper Name *</label>
                <Input
                  required
                  placeholder="e.g. Ramesh Pal"
                  value={helperForm.name}
                  onChange={(e) => setHelperForm({ ...helperForm, name: e.target.value })}
                  className="rounded-sm text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Daily Wage for Today (₹) *</label>
                <Input
                  type="number"
                  step="1"
                  required
                  placeholder="e.g. 700"
                  value={helperForm.dailyWage}
                  onChange={(e) => setHelperForm({ ...helperForm, dailyWage: e.target.value })}
                  className="rounded-sm text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Attendance Status *</label>
                <select
                  value={helperForm.status}
                  onChange={(e) => setHelperForm({ ...helperForm, status: e.target.value })}
                  className="h-9 w-full rounded-sm border border-input bg-background px-3 text-sm"
                >
                  <option value="Full Day">Full Day (1.0 unit)</option>
                  <option value="Half Day">Half Day (0.5 unit)</option>
                  <option value="Absent">Absent (0.0 unit)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Notes (Optional)</label>
                <Input
                  placeholder="e.g. Assigned to furnace unloading"
                  value={helperForm.notes}
                  onChange={(e) => setHelperForm({ ...helperForm, notes: e.target.value })}
                  className="rounded-sm text-sm"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="saveAsWorker"
                  checked={helperForm.saveAsWorker}
                  onChange={(e) => setHelperForm({ ...helperForm, saveAsWorker: e.target.checked })}
                  className="size-4 rounded-sm border border-border"
                />
                <label htmlFor="saveAsWorker" className="text-xs cursor-pointer select-none">
                  Save helper in Workers list for future use
                </label>
              </div>

              <div className="flex justify-end gap-2 border-t border-border pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowHelperModal(false)}
                  className="rounded-sm text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={helperSaving}
                  className="rounded-sm text-xs font-semibold"
                >
                  {helperSaving ? 'Adding…' : 'Add to Daybook'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ENTRY CORRECTION MODAL */}
      {editingRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md border border-border bg-card p-6 shadow-xl rounded-sm">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h3 className="font-heading text-lg font-semibold">Correct Attendance Entry</h3>
                <p className="text-xs text-muted-foreground">
                  {editingRecord.worker_c?.Name} · {editingRecord.attendanceDate_c}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingRecord(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <ApperIcon name="X" size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveCorrection} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold mb-1">Attendance Status</label>
                <select
                  value={editForm.status}
                  onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                  className="h-9 w-full rounded-sm border border-input bg-background px-3 text-sm"
                >
                  <option value="Full Day">Full Day (1.0 unit)</option>
                  <option value="Half Day">Half Day (0.5 unit)</option>
                  <option value="Absent">Absent (0.0 unit)</option>
                  <option value="Leave">Leave (0.0 unit)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Daily Wage Snapshot (₹)</label>
                <Input
                  type="number"
                  step="0.01"
                  value={editForm.dailyRateSnapshot}
                  onChange={(e) => setEditForm({ ...editForm, dailyRateSnapshot: e.target.value })}
                  className="rounded-sm text-sm"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Updating this snapshot only affects this entry, not other days.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Overtime Hours (Optional)</label>
                <Input
                  type="number"
                  step="0.5"
                  value={editForm.overtimeHours}
                  onChange={(e) => setEditForm({ ...editForm, overtimeHours: e.target.value })}
                  className="rounded-sm text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Correction Reason / Notes</label>
                <Input
                  value={editForm.notes}
                  onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                  className="rounded-sm text-sm"
                  placeholder="e.g. Corrected half day to full day"
                />
              </div>

              <div className="flex justify-end gap-2 border-t border-border pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditingRecord(null)}
                  className="rounded-sm text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={editSaving}
                  className="rounded-sm text-xs font-semibold"
                >
                  {editSaving ? 'Updating…' : 'Save Correction'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
