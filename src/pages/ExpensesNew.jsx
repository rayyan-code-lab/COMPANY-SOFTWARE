import { SimpleFinanceForm } from '@/components/SimpleFinanceModule';

export const route = { path: '/expenses/new', layout: 'owner', access: 'authenticated' };

export default function ExpensesNewPage() {
  return <SimpleFinanceForm kind="expenses" />;
}
