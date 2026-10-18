/**
 * PeriodFilter.jsx
 *
 * Reusable period-selection toolbar used by Sales, Expenses, Purchases and
 * Payroll list pages.
 *
 * Props:
 *   view          'monthly' | 'weekly' | 'daily'
 *   anchor        YYYY-MM-DD string (any date inside the current period)
 *   onViewChange  (view: string) => void
 *   onAnchorChange(anchor: string) => void
 *
 * The component renders:
 *   - Three view tabs (Monthly / Weekly / Daily)
 *   - ← / → navigation buttons
 *   - A human-readable label for the selected period
 *   - A native date input for jumping to any date
 */
import { stepPeriod, formatPeriodLabel } from '@/utils/period';
import ApperIcon from '@/components/ApperIcon';
import { Button } from '@/components/ui/button';

const VIEWS = [
  { key: 'monthly', label: 'Monthly' },
  { key: 'weekly',  label: 'Weekly'  },
  { key: 'daily',   label: 'Daily'   },
];

export default function PeriodFilter({ view, anchor, onViewChange, onAnchorChange }) {
  const label = formatPeriodLabel(view, anchor);

  function handleViewChange(newView) {
    // Preserve anchor so the displayed period stays close when switching views.
    onViewChange(newView);
  }

  function handlePrev() {
    onAnchorChange(stepPeriod(view, anchor, -1));
  }

  function handleNext() {
    onAnchorChange(stepPeriod(view, anchor, 1));
  }

  function handleDateInput(e) {
    const val = e.target.value; // YYYY-MM-DD
    if (val) onAnchorChange(val);
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:flex-wrap">
      {/* View tabs */}
      <div className="flex items-center rounded-sm border border-border bg-muted/50 p-0.5">
        {VIEWS.map(({ key, label: vLabel }) => (
          <button
            key={key}
            type="button"
            onClick={() => handleViewChange(key)}
            className={
              'px-3 py-1 text-xs font-semibold rounded-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
              (view === key
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground')
            }
          >
            {vLabel}
          </button>
        ))}
      </div>

      {/* Navigation */}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 w-8 rounded-sm p-0"
          onClick={handlePrev}
          aria-label="Previous period"
        >
          <ApperIcon name="ChevronLeft" size={15} />
        </Button>

        <span className="min-w-[160px] text-center text-sm font-medium">{label}</span>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 w-8 rounded-sm p-0"
          onClick={handleNext}
          aria-label="Next period"
        >
          <ApperIcon name="ChevronRight" size={15} />
        </Button>
      </div>

      {/* Jump to date */}
      <div className="flex items-center gap-1.5">
        <label className="text-xs text-muted-foreground whitespace-nowrap">Jump to</label>
        <input
          type="date"
          value={anchor}
          onChange={handleDateInput}
          className="h-8 rounded-sm border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Jump to date"
        />
      </div>
    </div>
  );
}
