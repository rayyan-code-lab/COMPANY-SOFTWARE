import { Link } from 'react-router-dom';
import { useFetch } from '@/hooks/useFetch';
import { sdk } from '@/services/sdk';
import ApperIcon from '@/components/ApperIcon';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

export const route = { path: '/', layout: 'owner', access: 'authenticated' };
export const nav = { icon: 'LayoutDashboard', label: 'Dashboard', section: 'Overview', order: 1 };

const read = async (table, fields) => {
  const r = await sdk.table(table).select(fields).page(1, 100).fetch();
  if (!r.success) throw new Error(r.message || 'Could not load overview');
  return r.data ?? [];
};
const inr = v => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(v ?? 0));

function Metric({label,value,note,icon}) {
  return <div className="border border-border bg-card p-5 shadow-sm"><div className="flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p><span className="flex size-9 items-center justify-center rounded-sm bg-primary/10 text-primary"><ApperIcon name={icon} size={18}/></span></div><p className="mt-4 font-heading text-3xl font-semibold tabular-nums">{value}</p><p className="mt-1 text-xs text-muted-foreground">{note}</p></div>;
}
export default function Home() {
  const stock=useFetch(()=>read('stock_movements_c',['Name','movementType_c','weightKg_c']),[]);
  const workers=useFetch(()=>read('workers_c',['Name','status_c']),[]);
  const attendance=useFetch(()=>read('attendance_c',['Name','attendanceDate_c','status_c']),[]);
  const payroll=useFetch(()=>read('payroll_c',['Name','netPay_c','status_c']),[]);
  const finance=useFetch(()=>read('transactions_c',['Name','entryType_c','amount_c']),[]);
  const busy=[stock,workers,attendance,payroll,finance].some(x=>x.data===undefined);
  const kg=(stock.data??[]).reduce((s,r)=>s+(r.movementType_c==='Stock Out'?-Math.abs(Number(r.weightKg_c||0)):Number(r.weightKg_c||0)),0);
  const active=(workers.data??[]).filter(r=>r.status_c==='Active').length;
  const today=new Date().toISOString().slice(0,10);
  const present=(attendance.data??[]).filter(r=>r.attendanceDate_c===today&&['Present','Full Day'].includes(r.status_c)).length;
  const entries=finance.data??[];
  const sales=entries.filter(r=>['Sale','Other Income'].includes(r.entryType_c)).reduce((s,r)=>s+Number(r.amount_c||0),0);
  const spending=entries.filter(r=>['Expense','Purchase'].includes(r.entryType_c)).reduce((s,r)=>s+Number(r.amount_c||0),0);
  const due=(payroll.data??[]).filter(r=>r.status_c!=='Paid').reduce((s,r)=>s+Number(r.netPay_c||0),0);
  const actions=[['PackagePlus','Record stock movement','Stock in, stock out and weight adjustments','/inventory/new'],['UserRoundPlus','Add worker','Worker details, roles and daily rates','/workers/new'],['CalendarCheck','Mark attendance','Presence, hours and overtime','/attendance/new'],['ReceiptIndianRupee','Log sale or expense','Amount, payment method and photo proof','/finance/new']];
  return <div className="space-y-7">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Company overview · 15 October 2026</p><h1 className="font-heading text-3xl font-semibold md:text-4xl">Good evening.</h1><p className="mt-2 text-sm text-muted-foreground">Your inventory, people and company money in one operations workspace.</p></div><div className="flex gap-2"><Button asChild variant="outline" className="rounded-sm"><Link to="/finance/new">Log expense</Link></Button><Button asChild className="rounded-sm"><Link to="/inventory/new"><ApperIcon name="Plus" size={16}/> Record stock</Link></Button></div></div>
    {busy?<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Skeleton className="h-36"/><Skeleton className="h-36"/><Skeleton className="h-36"/><Skeleton className="h-36"/></div>:<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Inventory on hand" value={kg.toLocaleString('en-IN',{maximumFractionDigits:2})+' kg'} note="Net stock after movements" icon="Package"/><Metric label="Active workers" value={active} note={present+' present today'} icon="Users"/><Metric label="Sales & income" value={inr(sales)} note="Recorded finance entries" icon="TrendingUp"/><Metric label="Payroll outstanding" value={inr(due)} note="Draft and approved pay" icon="WalletCards"/></div>}
    <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]"><section className="border border-border bg-card shadow-sm"><div className="border-b border-border px-5 py-4"><h2 className="font-heading text-xl font-semibold">Daily operations</h2><p className="mt-1 text-xs text-muted-foreground">Jump straight into common jobs.</p></div><div className="grid md:grid-cols-2">{actions.map(([icon,title,desc,to])=><Link key={to} to={to} className="group flex gap-4 border-b border-border p-5 transition-colors hover:bg-accent md:odd:border-r"><span className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-muted"><ApperIcon name={icon} size={19}/></span><span><span className="block text-sm font-semibold">{title}</span><span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{desc}</span><span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary">Open <ApperIcon name="ArrowRight" size={13}/></span></span></Link>)}</div></section>
    <section className="border border-border bg-card p-5 shadow-sm"><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-highlight">Finance snapshot</p><h2 className="mt-2 font-heading text-xl font-semibold">Recorded money flow</h2><div className="mt-6 space-y-5"><div><div className="flex justify-between text-sm"><span className="text-muted-foreground">Sales & income</span><b>{inr(sales)}</b></div><div className="mt-2 h-2 bg-muted"><div className="h-2 bg-highlight" style={{width:sales+spending?(sales/(sales+spending)*100)+'%':'0%'}}/></div></div><div><div className="flex justify-between text-sm"><span className="text-muted-foreground">Expenses & purchases</span><b>{inr(spending)}</b></div><div className="mt-2 h-2 bg-muted"><div className="h-2 bg-primary" style={{width:sales+spending?(spending/(sales+spending)*100)+'%':'0%'}}/></div></div><div className="border-t border-border pt-4"><p className="text-xs text-muted-foreground">Difference on recorded entries</p><p className="mt-1 font-heading text-2xl font-semibold">{inr(sales-spending)}</p></div></div><Button asChild variant="outline" className="mt-5 w-full rounded-sm"><Link to="/finance">View sales & expenses</Link></Button></section></div>
    <div className="flex flex-col gap-2 border-l-2 border-highlight bg-highlight/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold">Demo data is loaded</p><p className="mt-1 text-xs text-muted-foreground">Test the workflow first. Connect a permanent database before entering real company records.</p></div><Button asChild variant="ghost" className="self-start rounded-sm"><Link to="/admin">Admin panel <ApperIcon name="ArrowUpRight" size={15}/></Link></Button></div>
  </div>;
}