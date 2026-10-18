/**
 * period.js — shared date-period utilities for the Foundry app.
 *
 * All public functions work in local calendar dates (YYYY-MM-DD strings)
 * so that backend string comparisons (`purchaseDate_c >= "2026-10-01"`)
 * are not affected by UTC offset.
 *
 * Views: 'monthly' | 'weekly' | 'daily'
 *
 * "anchor" is always a YYYY-MM-DD string representing any date inside the
 * target period.  Period start/end are derived from it.
 */

/** Return today as a local YYYY-MM-DD string (no UTC shift). */
export function todayLocal() {
  const d = new Date();
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

/** Parse a YYYY-MM-DD string to { year, month (0-based), day }. */
function parseLocal(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return { year: y, month: m - 1, day: d };
}

/** Format a Date object to a local YYYY-MM-DD string. */
function localStr(date) {
  return (
    date.getFullYear() +
    '-' +
    String(date.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(date.getDate()).padStart(2, '0')
  );
}

/**
 * Given a view and an anchor date string, return { start, end } as local
 * YYYY-MM-DD strings (both inclusive).
 */
export function getPeriodBounds(view, anchor) {
  const { year, month, day } = parseLocal(anchor);

  if (view === 'monthly') {
    const start = new Date(year, month, 1);
    const end = new Date(year, month + 1, 0); // last day of month
    return { start: localStr(start), end: localStr(end) };
  }

  if (view === 'weekly') {
    // ISO week: Monday = 0 offset, Sunday = 6 offset
    const anchor_d = new Date(year, month, day);
    const dow = anchor_d.getDay(); // 0=Sun … 6=Sat
    const mondayOffset = dow === 0 ? -6 : 1 - dow;
    const monday = new Date(year, month, day + mondayOffset);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { start: localStr(monday), end: localStr(sunday) };
  }

  // daily
  return { start: anchor, end: anchor };
}

/**
 * Navigate a period by +1 or -1 steps. Returns the new anchor date string.
 * - monthly: move to same day of next/prev month (clamped to valid days)
 * - weekly:  move 7 days forward/back
 * - daily:   move 1 day forward/back
 */
export function stepPeriod(view, anchor, direction) {
  const { year, month, day } = parseLocal(anchor);

  if (view === 'monthly') {
    let newMonth = month + direction;
    let newYear = year;
    if (newMonth < 0) { newMonth = 11; newYear -= 1; }
    if (newMonth > 11) { newMonth = 0; newYear += 1; }
    // Clamp day to new month's last day
    const lastDay = new Date(newYear, newMonth + 1, 0).getDate();
    const clampedDay = Math.min(day, lastDay);
    return localStr(new Date(newYear, newMonth, clampedDay));
  }

  const anchor_d = new Date(year, month, day);
  const days = view === 'weekly' ? 7 : 1;
  anchor_d.setDate(anchor_d.getDate() + direction * days);
  return localStr(anchor_d);
}

/**
 * Human-readable label for the current period.
 */
export function formatPeriodLabel(view, anchor) {
  const { start, end } = getPeriodBounds(view, anchor);
  const fmt = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  if (view === 'monthly') {
    const [y, m] = start.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('en-IN', {
      month: 'long',
      year: 'numeric',
    });
  }
  if (view === 'weekly') {
    return fmt(start) + ' – ' + fmt(end);
  }
  return fmt(start);
}

/**
 * Filter an array of records by a date field within [start, end].
 * Works via string comparison on YYYY-MM-DD values.
 */
export function filterByPeriod(records, dateField, start, end) {
  return records.filter((r) => {
    const v = String(r[dateField] ?? '').slice(0, 10);
    return v >= start && v <= end;
  });
}

/**
 * For payroll: payPeriod_c is a text like "2026-10-01 to 2026-10-15".
 * We match payroll records whose pay period *overlaps* the selected period [periodStart, periodEnd].
 * Two closed intervals [A, B] and [C, D] overlap iff A <= D and B >= C.
 * If only one date is found, B defaults to A.
 * If no ISO date is parseable, the record is conservatively included.
 */
export function filterPayrollByPeriod(records, periodStart, periodEnd) {
  return records.filter((r) => {
    const raw = String(r.payPeriod_c ?? '');
    const matches = raw.match(/(\d{4}-\d{2}-\d{2})/g);
    if (!matches || matches.length === 0) return true;
    const payStart = matches[0];
    const payEnd = matches[1] || payStart;
    return payStart <= periodEnd && payEnd >= periodStart;
  });
}

