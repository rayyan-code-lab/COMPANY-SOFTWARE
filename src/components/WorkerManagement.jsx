/**
 * WorkerManagement.jsx
 *
 * Enhanced Worker register and management view for Foundry Company Manager.
 * Features:
 * - View and filter workers: All, Regular, Temporary Helpers, Inactive
 * - Add new regular worker or temporary helper
 * - Edit worker profile and update default daily wage rate (preserving past attendance snapshots)
 * - Quick jump to Attendance Daybook and Payroll Wage Statements
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { sdk } from '@/services/sdk';
import { useFetch } from '@/hooks/useFetch';
import { useProfile } from '@/hooks/useProfile';
import { getTableAccess } from '@/services/userPermissions';
import { todayLocal } from '@/utils/period';
import { formatINR } from '@/services/wageWorkflow';
import ApperIcon from '@/components/ApperIcon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

const ROLES = [
  'Operator',
  'Machine Operator',
  'Supervisor',
  'Loader',
  'Driver',
  'Helper',
  'Storekeeper',
  'Other',
];

export default function WorkerManagement() {
  const navigate = useNavigate();
  const { profile } = useProfile();
  const permission = getTableAccess(profile, 'workers_c');

  // Filter tabs: 'all' | 'regular' | 'temporary' | 'inactive'
  const [tabFilter, setTabFilter] = useState('all');
  const [search, setSearch] = useState('');

  // Add / Edit Modal state
  const [modalMode, setModalMode] = useState(null); // 'create' | 'edit' | null
  const [selectedWorker, setSelectedWorker] = useState(null);
  const [workerForm, setWorkerForm] = useState({
    Name: '',
    role_c: 'Operator',
    phone_c: '',
    dailyRate_c: '',
    workerType_c: 'Regular',
    status_c: 'Active',
    joinedOn_c: todayLocal(),
    notes_c: '',
  });
  const [isSaving, setIsSaving] = useState(false);

  // Fetch workers
  const {
    data: workersData,
    loading,
    error,
    run: reloadWorkers,
  } = useFetch(async () => {
    const res = await sdk
      .table('workers_c')
      .select([
        'Id',
        'Name',
        'role_c',
        'phone_c',
        'dailyRate_c',
        'workerType_c',
        'status_c',
        'joinedOn_c',
        'notes_c',
      ])
      .orderBy('Name')
      .page(1, 200)
      .fetch();
    if (!res.success) throw new Error(res.message || 'Failed to load workers');
    return res.data ?? [];
  }, []);

  const workers = workersData ?? [];

  // Filter workers based on tab and search
  const filteredWorkers = useMemo(() => {
    return workers
      .filter((w) => {
        if (tabFilter === 'regular') return (w.workerType_c || 'Regular') === 'Regular' && w.status_c === 'Active';
        if (tabFilter === 'temporary') return w.workerType_c === 'Temporary' && w.status_c === 'Active';
        if (tabFilter === 'inactive') return w.status_c === 'Inactive';
        return true;
      })
      .filter((w) => {
        if (!search.trim()) return true;
        const q = search.toLowerCase();
        return (
          w.Name.toLowerCase().includes(q) ||
          (w.role_c && w.role_c.toLowerCase().includes(q)) ||
          (w.phone_c && w.phone_c.includes(q))
        );
      });
  }, [workers, tabFilter, search]);

  // Open Create Modal
  const handleOpenCreate = () => {
    setSelectedWorker(null);
    setWorkerForm({
      Name: '',
      role_c: 'Operator',
      phone_c: '',
      dailyRate_c: '',
      workerType_c: 'Regular',
      status_c: 'Active',
      joinedOn_c: todayLocal(),
      notes_c: '',
    });
    setModalMode('create');
  };

  // Open Edit Modal
  const handleOpenEdit = (w) => {
    setSelectedWorker(w);
    setWorkerForm({
      Name: w.Name || '',
      role_c: w.role_c || 'Operator',
      phone_c: w.phone_c || '',
      dailyRate_c: String(w.dailyRate_c ?? ''),
      workerType_c: w.workerType_c || 'Regular',
      status_c: w.status_c || 'Active',
      joinedOn_c: w.joinedOn_c || todayLocal(),
      notes_c: w.notes_c || '',
    });
    setModalMode('edit');
  };

  // Submit Create or Edit
  const handleSubmitWorker = async (e) => {
    e.preventDefault();
    if (!workerForm.Name.trim()) {
      toast.error('Enter worker name');
      return;
    }
    const rate = Number(workerForm.dailyRate_c);
    if (isNaN(rate) || rate < 0) {
      toast.error('Enter a valid daily wage rate');
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        Name: workerForm.Name.trim(),
        role_c: workerForm.role_c,
        phone_c: workerForm.phone_c.trim(),
        dailyRate_c: rate,
        workerType_c: workerForm.workerType_c,
        status_c: workerForm.status_c,
        joinedOn_c: workerForm.joinedOn_c,
        notes_c: workerForm.notes_c.trim(),
      };

      if (modalMode === 'create') {
        const res = await sdk.table('workers_c').create(payload);
        if (!res.success) throw new Error(res.message || 'Failed to create worker');
        toast.success(`Worker ${payload.Name} registered successfully.`);
      } else if (modalMode === 'edit' && selectedWorker) {
        const res = await sdk.table('workers_c').update(selectedWorker.Id, payload);
        if (!res.success) throw new Error(res.message || 'Failed to update worker');
        toast.success(
          `Updated ${payload.Name}. New daily rate of ${formatINR(rate)} will apply to new attendance entries.`
        );
      }

      setModalMode(null);
      await reloadWorkers();
    } catch (err) {
      toast.error('Operation failed', {
        description: err.message || String(err),
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
            People / Team
          </p>
          <h1 className="font-heading text-3xl font-semibold">Workers & Staff</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Manage regular factory workers, temporary helpers, default daily wage rates, and records.
          </p>
        </div>

        {permission.canCreate && (
          <Button onClick={handleOpenCreate} className="rounded-sm font-semibold">
            <ApperIcon name="UserPlus" size={16} /> Add Worker
          </Button>
        )}
      </div>

      {/* Filter Tabs & Search Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Filter tabs */}
        <div className="inline-flex rounded-sm border border-border bg-muted p-1 text-xs font-medium">
          <button
            type="button"
            onClick={() => setTabFilter('all')}
            className={`rounded-sm px-3 py-1.5 transition-colors ${
              tabFilter === 'all'
                ? 'bg-background text-foreground shadow-xs font-semibold'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            All ({workers.length})
          </button>
          <button
            type="button"
            onClick={() => setTabFilter('regular')}
            className={`rounded-sm px-3 py-1.5 transition-colors ${
              tabFilter === 'regular'
                ? 'bg-background text-foreground shadow-xs font-semibold'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Regular ({workers.filter((w) => (w.workerType_c || 'Regular') === 'Regular' && w.status_c === 'Active').length})
          </button>
          <button
            type="button"
            onClick={() => setTabFilter('temporary')}
            className={`rounded-sm px-3 py-1.5 transition-colors ${
              tabFilter === 'temporary'
                ? 'bg-background text-foreground shadow-xs font-semibold'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Helpers ({workers.filter((w) => w.workerType_c === 'Temporary' && w.status_c === 'Active').length})
          </button>
          <button
            type="button"
            onClick={() => setTabFilter('inactive')}
            className={`rounded-sm px-3 py-1.5 transition-colors ${
              tabFilter === 'inactive'
                ? 'bg-background text-foreground shadow-xs font-semibold'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Inactive ({workers.filter((w) => w.status_c === 'Inactive').length})
          </button>
        </div>

        {/* Search */}
        <div className="relative max-w-xs w-full">
          <ApperIcon
            name="Search"
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search workers by name, role, phone…"
            className="rounded-sm pl-9 text-xs"
          />
        </div>
      </div>

      {/* Workers Register Table */}
      <section className="overflow-hidden border border-border bg-card shadow-sm">
        <div className="flex justify-between border-b border-border px-4 py-3">
          <b className="text-sm font-medium">Workers Register</b>
          <span className="text-xs text-muted-foreground">
            {filteredWorkers.length} worker{filteredWorkers.length !== 1 ? 's' : ''} listed
          </span>
        </div>

        {loading && !workersData ? (
          <div className="space-y-3 p-5">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : error ? (
          <div className="p-8 text-center">
            <p className="font-medium text-destructive">Could not load worker records</p>
            <p className="mt-1 text-sm text-muted-foreground">{error.message}</p>
            <Button variant="outline" className="mt-3 rounded-sm" onClick={() => reloadWorkers()}>
              Retry
            </Button>
          </div>
        ) : filteredWorkers.length === 0 ? (
          <div className="p-10 text-center">
            <ApperIcon name="Users" size={28} className="mx-auto text-muted-foreground" />
            <p className="mt-3 font-semibold">No workers found</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {search ? 'Try adjusting your search criteria.' : 'Add your first worker to get started.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[750px] text-left text-sm">
              <thead className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-semibold">Worker</th>
                  <th className="px-4 py-3 font-semibold">Role</th>
                  <th className="px-4 py-3 font-semibold">Type</th>
                  <th className="px-4 py-3 font-semibold">Default Daily Wage</th>
                  <th className="px-4 py-3 font-semibold">Phone</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Joined On</th>
                  <th className="px-4 py-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredWorkers.map((w) => {
                  const isTemporary = w.workerType_c === 'Temporary';
                  const isActive = w.status_c === 'Active';

                  return (
                    <tr key={w.Id} className="hover:bg-muted/40">
                      {/* Name */}
                      <td className="px-4 py-3 font-semibold text-foreground">
                        {w.Name}
                      </td>

                      {/* Role */}
                      <td className="px-4 py-3">
                        <Badge variant="outline" className="font-normal text-xs">
                          {w.role_c || 'Worker'}
                        </Badge>
                      </td>

                      {/* Type Badge */}
                      <td className="px-4 py-3">
                        {isTemporary ? (
                          <Badge className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-700 font-normal text-xs">
                            Temporary Helper
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="font-normal text-xs">
                            Regular
                          </Badge>
                        )}
                      </td>

                      {/* Daily Wage */}
                      <td className="px-4 py-3 font-semibold tabular-nums text-primary">
                        {formatINR(w.dailyRate_c)}/day
                      </td>

                      {/* Phone */}
                      <td className="px-4 py-3 text-xs text-muted-foreground tabular-nums">
                        {w.phone_c || '—'}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-medium border ${
                            isActive
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                              : 'bg-muted text-muted-foreground border-border'
                          }`}
                        >
                          {w.status_c}
                        </span>
                      </td>

                      {/* Joined Date */}
                      <td className="px-4 py-3 text-xs text-muted-foreground tabular-nums">
                        {w.joinedOn_c || '—'}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs rounded-sm"
                            title="View payroll & wage statement"
                            onClick={() => navigate('/payroll')}
                          >
                            <ApperIcon name="WalletCards" size={13} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs rounded-sm"
                            title="Mark attendance in daybook"
                            onClick={() => navigate('/attendance')}
                          >
                            <ApperIcon name="CalendarCheck" size={13} />
                          </Button>
                          {permission.canUpdate && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-xs rounded-sm"
                              onClick={() => handleOpenEdit(w)}
                            >
                              <ApperIcon name="Edit" size={13} /> Edit
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

      {/* CREATE / EDIT WORKER MODAL */}
      {modalMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg border border-border bg-card p-6 shadow-2xl rounded-sm">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h3 className="font-heading text-lg font-semibold">
                  {modalMode === 'create' ? 'Add Worker Profile' : `Edit Worker: ${selectedWorker?.Name}`}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {modalMode === 'create'
                    ? 'Register a new worker or temporary helper.'
                    : 'Update worker details and default daily wage.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalMode(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <ApperIcon name="X" size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmitWorker} className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-semibold mb-1">Full Name *</label>
                  <Input
                    required
                    placeholder="e.g. Ramesh Kumar"
                    value={workerForm.Name}
                    onChange={(e) => setWorkerForm({ ...workerForm, Name: e.target.value })}
                    className="rounded-sm text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-1">Worker Type</label>
                  <select
                    value={workerForm.workerType_c}
                    onChange={(e) => setWorkerForm({ ...workerForm, workerType_c: e.target.value })}
                    className="h-9 w-full rounded-sm border border-input bg-background px-3 text-sm"
                  >
                    <option value="Regular">Regular Worker</option>
                    <option value="Temporary">Temporary Helper</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-1">Job Role *</label>
                  <select
                    value={workerForm.role_c}
                    onChange={(e) => setWorkerForm({ ...workerForm, role_c: e.target.value })}
                    className="h-9 w-full rounded-sm border border-input bg-background px-3 text-sm"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-1">Default Daily Wage (₹) *</label>
                  <Input
                    type="number"
                    step="1"
                    required
                    placeholder="e.g. 850"
                    value={workerForm.dailyRate_c}
                    onChange={(e) => setWorkerForm({ ...workerForm, dailyRate_c: e.target.value })}
                    className="rounded-sm text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-1">Phone Number</label>
                  <Input
                    placeholder="+91 90000 00000"
                    value={workerForm.phone_c}
                    onChange={(e) => setWorkerForm({ ...workerForm, phone_c: e.target.value })}
                    className="rounded-sm text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-1">Employment Status</label>
                  <select
                    value={workerForm.status_c}
                    onChange={(e) => setWorkerForm({ ...workerForm, status_c: e.target.value })}
                    className="h-9 w-full rounded-sm border border-input bg-background px-3 text-sm"
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-1">Joining Date *</label>
                  <Input
                    type="date"
                    required
                    value={workerForm.joinedOn_c}
                    onChange={(e) => setWorkerForm({ ...workerForm, joinedOn_c: e.target.value })}
                    className="rounded-sm text-sm"
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-xs font-semibold mb-1">Notes (Optional)</label>
                  <Input
                    placeholder="e.g. Furnace specialist, certified crane operator"
                    value={workerForm.notes_c}
                    onChange={(e) => setWorkerForm({ ...workerForm, notes_c: e.target.value })}
                    className="rounded-sm text-sm"
                  />
                </div>
              </div>

              {modalMode === 'edit' && (
                <div className="bg-muted/50 p-3 rounded-sm border border-border text-[11px] text-muted-foreground">
                  <span className="font-semibold text-foreground">Note on Wage Rates:</span> Updating
                  the default daily wage here sets the rate for new attendance entries. Past attendance records
                  retain their immutable daily wage snapshot and are never altered.
                </div>
              )}

              <div className="flex justify-end gap-2 border-t border-border pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setModalMode(null)}
                  className="rounded-sm text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isSaving}
                  className="rounded-sm text-xs font-semibold"
                >
                  {isSaving ? 'Saving…' : modalMode === 'create' ? 'Create Worker' : 'Save Changes'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
