import { SimpleFinanceForm } from '@/components/SimpleFinanceModule';

export const route = { path: '/sales/new', layout: 'owner', access: 'authenticated' };

export default function SalesNewPage() {
  return <SimpleFinanceForm kind="sales" />;
}
