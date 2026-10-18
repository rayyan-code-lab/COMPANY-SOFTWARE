import { PayrollList } from '@/components/PayrollModule';

export const route = { path: '/payroll', layout: 'owner', access: 'authenticated' };
export const nav = { icon: 'WalletCards', label: 'Payroll', section: 'Finance', order: 40 };

export default function PayrollPage() {
  return <PayrollList />;
}