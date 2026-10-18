/**
 * wageWorkflow.js
 *
 * Centralized business logic for daily attendance, helper onboarding,
 * immutable wage snapshots, and attendance-driven payroll reconciliation.
 */
import { sdk } from '@/services/sdk';

const { eq } = window.ApperSDK.CoreSDK;

/**
 * Attendance status to unit conversion.
 * - Full day = 1.0 unit
 * - Half day = 0.5 unit
 * - Absent = 0.0 unit
 * - Leave = 0.0 unit
 * - Unmarked = 0.0 unit (pending confirmation)
 */
export const STATUS_UNITS = {
  'Full Day': 1.0,
  Present: 1.0, // legacy backward compatibility
  'Half Day': 0.5,
  Absent: 0.0,
  Leave: 0.0,
  Unmarked: 0.0,
};

export function calculateUnits(status) {
  if (!status || status === 'Unmarked') return 0;
  return STATUS_UNITS[status] ?? 0;
}

/**
 * Calculate earned daily wage from attendance status, daily rate snapshot,
 * and optional overtime.
 */
export function calculateEarnedWage(status, dailyRate, overtimeHours = 0, hourlyOvertimeRate = null) {
  const units = calculateUnits(status);
  const rate = Number(dailyRate || 0);
  const baseEarnings = units * rate;

  const otHours = Math.max(0, Number(overtimeHours || 0));
  let otEarnings = 0;
  if (otHours > 0) {
    const otRate = Number(hourlyOvertimeRate != null ? hourlyOvertimeRate : (rate > 0 ? rate / 8 : 0));
    otEarnings = otHours * otRate;
  }

  return Math.round((baseEarnings + otEarnings) * 100) / 100;
}

export function formatINR(val) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(Number(val ?? 0));
}

/**
 * Generate collision-resistant unique reference ID.
 */
export function generateReference(prefix = 'REF') {
  const d = new Date();
  const ymd =
    d.getFullYear() +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0');
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `${prefix}-${ymd}-${rand}`;
}

/**
 * Find existing worker by ID or case-insensitive name match.
 */
export function matchWorker(workerRef, workers) {
  if (!workerRef || !workers?.length) return null;
  const refId = typeof workerRef === 'object' ? workerRef.Id : workerRef;
  const refName = (typeof workerRef === 'object' ? workerRef.Name : '').trim().toLowerCase();

  return (
    workers.find((w) => w.Id === refId) ||
    workers.find((w) => refName && w.Name?.trim().toLowerCase() === refName) ||
    null
  );
}

/**
 * Register or reuse a helper worker.
 */
export async function createOrReuseHelper({ name, dailyWage, saveAsWorker = false, date }) {
  const cleanName = name.trim();
  if (!cleanName) throw new Error('Helper name is required');
  const wage = Number(dailyWage);
  if (isNaN(wage) || wage < 0) throw new Error('Valid daily wage is required');

  // Check if a worker with this name already exists
  const workersRes = await sdk
    .table('workers_c')
    .select(['Id', 'Name', 'role_c', 'dailyRate_c', 'workerType_c', 'status_c'])
    .page(1, 200)
    .fetch();

  const allWorkers = workersRes.data ?? [];
  const existing = allWorkers.find(
    (w) => w.Name?.trim().toLowerCase() === cleanName.toLowerCase()
  );

  if (existing) {
    // If worker exists and was Inactive, reactivate
    if (existing.status_c !== 'Active') {
      await sdk.table('workers_c').update(existing.Id, {
        status_c: 'Active',
      });
      existing.status_c = 'Active';
    }
    return { worker: existing, isNew: false };
  }

  // Create temporary helper worker
  const payload = {
    Name: cleanName,
    role_c: 'Helper',
    phone_c: '',
    dailyRate_c: wage,
    workerType_c: 'Temporary',
    status_c: 'Active',
    joinedOn_c: date,
    notes_c: saveAsWorker ? 'Registered helper saved for future use' : 'Temporary daily helper',
  };

  const createRes = await sdk.table('workers_c').create(payload);
  if (!createRes.success || !createRes.data?.[0]) {
    throw new Error(createRes.message || 'Failed to create helper record');
  }

  return { worker: createRes.data[0], isNew: true };
}

/**
 * Save / Update attendance entries for a given date with duplicate prevention.
 */
export async function saveAttendanceEntries({ date, entries, workers }) {
  if (!date) throw new Error('Attendance date is required');
  if (!entries || !entries.length) return { savedCount: 0 };

  // Fetch all existing attendance records for this date
  const attRes = await sdk
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
    .where(eq('attendanceDate_c', date))
    .page(1, 200)
    .fetch();

  const existingRecords = attRes.data ?? [];

  let savedCount = 0;

  for (const entry of entries) {
    const { workerId, workerName, status, dailyRate, overtimeHours, notes } = entry;
    if (!status || status === 'Unmarked') {
      // If unmarked, do not persist or leave unrecorded
      continue;
    }

    const workerObj = workers.find((w) => w.Id === workerId) || { Id: workerId, Name: workerName };
    const units = calculateUnits(status);
    const rateSnapshot = Number(dailyRate ?? workerObj.dailyRate_c ?? 0);
    const earnedWage = calculateEarnedWage(status, rateSnapshot, overtimeHours);

    // Check if an attendance record already exists for this worker on this date
    const existing = existingRecords.find((r) => {
      const match = matchWorker(r.worker_c, [workerObj]);
      return match != null || r.worker_c?.Id === workerId;
    });

    const payload = {
      Name: `${workerObj.Name || workerName} · ${date}`,
      worker_c: {
        Id: workerObj.Id,
        Name: workerObj.Name || workerName,
      },
      attendanceDate_c: date,
      status_c: status,
      attendanceUnits_c: units,
      dailyRateSnapshot_c: rateSnapshot,
      earnedWage_c: earnedWage,
      hoursWorked_c: units === 1.0 ? 8 : units === 0.5 ? 4 : 0,
      overtimeHours_c: Number(overtimeHours || 0),
      notes_c: notes || '',
    };

    if (existing) {
      // Update existing record
      await sdk.table('attendance_c').update(existing.Id, payload);
      savedCount++;
    } else {
      // Create new record
      await sdk.table('attendance_c').create(payload);
      savedCount++;
    }
  }

  return { savedCount };
}

/**
 * Record a payment or advance against a worker.
 */
export async function recordWorkerPayment({
  worker,
  paymentType,
  amount,
  paymentDate,
  paymentMethod,
  periodStart = null,
  periodEnd = null,
  notes = '',
}) {
  if (!worker || !worker.Id) throw new Error('Worker is required');
  const amt = Number(amount);
  if (isNaN(amt) || amt <= 0) throw new Error('Valid payment amount is required');
  if (!paymentDate) throw new Error('Payment date is required');
  if (!['Wage Payment', 'Advance'].includes(paymentType)) throw new Error('Valid payment type required');

  const refName = `${generateReference('PAY')} · ${worker.Name}`;

  const payload = {
    Name: refName,
    worker_c: {
      Id: worker.Id,
      Name: worker.Name,
    },
    paymentType_c: paymentType,
    amount_c: amt,
    paymentDate_c: paymentDate,
    paymentMethod_c: paymentMethod || 'Cash',
    periodStart_c: periodStart || null,
    periodEnd_c: periodEnd || null,
    notes_c: notes || '',
  };

  const res = await sdk.table('worker_payments_c').create(payload);
  if (!res.success || !res.data?.[0]) {
    throw new Error(res.message || 'Failed to record payment');
  }

  return res.data[0];
}

/**
 * Compute worker-level payroll roll-up for a given period.
 */
export function computeWorkerPeriodRollup(worker, attendanceRecords, paymentRecords, periodStart, periodEnd) {
  // Filter attendance for this worker in the period
  const workerAttendance = (attendanceRecords ?? []).filter((r) => {
    const isSameWorker =
      r.worker_c?.Id === worker.Id ||
      r.worker_c?.Name?.trim().toLowerCase() === worker.Name?.trim().toLowerCase();
    if (!isSameWorker) return false;
    const attDate = String(r.attendanceDate_c ?? '').slice(0, 10);
    return attDate >= periodStart && attDate <= periodEnd;
  });

  // Filter payments for this worker in the period
  const workerPayments = (paymentRecords ?? []).filter((p) => {
    const isSameWorker =
      p.worker_c?.Id === worker.Id ||
      p.worker_c?.Name?.trim().toLowerCase() === worker.Name?.trim().toLowerCase();
    if (!isSameWorker) return false;
    const pDate = String(p.paymentDate_c ?? '').slice(0, 10);
    return pDate >= periodStart && pDate <= periodEnd;
  });

  let fullDays = 0;
  let halfDays = 0;
  let absentDays = 0;
  let totalUnits = 0;
  let totalEarned = 0;

  for (const a of workerAttendance) {
    const status = a.status_c;
    if (status === 'Full Day' || status === 'Present') fullDays++;
    else if (status === 'Half Day') halfDays++;
    else if (status === 'Absent') absentDays++;

    const units = a.attendanceUnits_c != null ? Number(a.attendanceUnits_c) : calculateUnits(status);
    totalUnits += units;

    const rate = Number(a.dailyRateSnapshot_c ?? worker.dailyRate_c ?? 0);
    const earned = a.earnedWage_c != null ? Number(a.earnedWage_c) : calculateEarnedWage(status, rate, a.overtimeHours_c);
    totalEarned += earned;
  }

  let totalWagePayments = 0;
  let totalAdvances = 0;

  for (const p of workerPayments) {
    const amt = Number(p.amount_c || 0);
    if (p.paymentType_c === 'Advance') {
      totalAdvances += amt;
    } else {
      totalWagePayments += amt;
    }
  }

  const totalDisbursed = totalWagePayments + totalAdvances;
  const balance = totalEarned - totalDisbursed;

  // If totalDisbursed > totalEarned, worker has taken more advance than earned
  const advanceBalanceCarriedForward = totalDisbursed > totalEarned ? totalDisbursed - totalEarned : 0;
  const outstandingWagesDue = totalEarned > totalDisbursed ? totalEarned - totalDisbursed : 0;

  let paymentStatus = 'Unpaid';
  if (totalEarned === 0 && totalDisbursed === 0) {
    paymentStatus = 'No Attendance';
  } else if (advanceBalanceCarriedForward > 0) {
    paymentStatus = 'Advance Carried';
  } else if (outstandingWagesDue === 0) {
    paymentStatus = 'Settled';
  } else if (totalDisbursed > 0) {
    paymentStatus = 'Partially Paid';
  }

  return {
    worker,
    periodStart,
    periodEnd,
    fullDays,
    halfDays,
    absentDays,
    totalUnits: Math.round(totalUnits * 10) / 10,
    totalEarned: Math.round(totalEarned * 100) / 100,
    totalWagePayments: Math.round(totalWagePayments * 100) / 100,
    totalAdvances: Math.round(totalAdvances * 100) / 100,
    totalDisbursed: Math.round(totalDisbursed * 100) / 100,
    outstandingWagesDue: Math.round(outstandingWagesDue * 100) / 100,
    advanceBalanceCarriedForward: Math.round(advanceBalanceCarriedForward * 100) / 100,
    paymentStatus,
    attendanceRecords: workerAttendance,
    paymentRecords: workerPayments,
  };
}
