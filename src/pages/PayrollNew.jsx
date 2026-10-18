import { BasicForm } from '@/components/BasicModule';

export const route = { path: '/payroll/new', layout: 'owner', access: 'authenticated' };

export default function PayrollNewPage() {
  return <BasicForm moduleKey="payroll" />;
}