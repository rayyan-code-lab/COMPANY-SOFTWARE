import { Link } from 'react-router-dom';
import { useProfile } from '@/hooks/useProfile';
import { Button } from '@/components/ui/button';
import ApperIcon from '@/components/ApperIcon';

export const route = { path: '/admin', layout: 'owner', access: "profile === 'Admin_c'" };
export const nav = { icon: 'Settings2', label: 'Admin panel', section: 'Administration', profiles: ['Admin_c'], order: 90 };

const modules = [
  ['Package', 'Inventory', 'Stock quantities, movement history and price per kg.', '/inventory'],
  ['ShoppingCart', 'Purchase management', 'Purchases, supplier balances, payment history and stock-in links.', '/purchases'],
  ['TrendingUp', 'Sales', 'Record customer sales and review sales totals.', '/sales'],
  ['ReceiptIndianRupee', 'Expenses', 'Log operating expenses and review spending totals.', '/expenses'],
  ['Users', 'Workers', 'Worker details, role and individual daily rate.', '/workers'],
  ['CalendarCheck', 'Attendance', 'Daily presence, hours worked and overtime.', '/attendance'],
  ['WalletCards', 'Payroll', 'Individual gross pay, advances, deductions and net pay.', '/payroll'],
];

export default function AdminPage() {
  const { profile } = useProfile();

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Workspace controls</p>
        <h1 className="font-heading text-3xl font-semibold">Admin panel</h1>
        <p className="mt-2 text-sm text-muted-foreground">Quick access to company records and access policies.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {modules.map(([icon, title, description, to]) => (
          <Link key={to} to={to} className="flex gap-4 border border-border bg-card p-5 shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-sm bg-muted">
              <ApperIcon name={icon} size={20} />
            </span>
            <span className="flex-1">
              <span className="block font-heading text-lg font-semibold">{title}</span>
              <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">{description}</span>
              <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary">
                Open module <ApperIcon name="ArrowRight" size={13} />
              </span>
            </span>
          </Link>
        ))}
      </div>

      <section className="border border-border bg-card p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center bg-success-muted text-success">
            <ApperIcon name="ShieldCheck" size={20} />
          </span>
          <div>
            <h2 className="font-heading text-lg font-semibold">Current access profile</h2>
            <p className="text-sm text-muted-foreground">
              {profile === 'Admin_c' ? 'Administrator · full module access' : 'Manager · operations access'}
            </p>
          </div>
        </div>
        <div className="mt-4 border-t border-border pt-4 text-sm leading-relaxed text-muted-foreground">
          Managers can record stock, worker and attendance changes, purchases, supplier payments, sales and expenses.
          Purchase detail changes and cancellation are restricted to administrators in the interface.
          Permanent database connection and server-enforced permissions are still required before entering live records.
        </div>
      </section>

      <div className="border-l-2 border-highlight bg-highlight/5 p-4">
        <p className="text-sm font-semibold">Backend status: demo data</p>
        <p className="mt-1 text-sm text-muted-foreground">
          The current preview runs on seeded sample records. Connect the permanent database before using this app for live company recordkeeping.
        </p>
        <Button asChild variant="outline" className="mt-3 rounded-sm">
          <Link to="/purchases">Open Purchase Management <ApperIcon name="ArrowUpRight" size={15} /></Link>
        </Button>
      </div>
    </div>
  );
}
