import { SimpleFinanceList } from '@/components/SimpleFinanceModule';

export const route = { path: '/expenses', layout: 'owner', access: 'authenticated' };
export const nav = { icon: 'ReceiptIndianRupee', label: 'Expenses', section: 'Finance', order: 42 };

export default function ExpensesPage() {
  return <SimpleFinanceList kind="expenses" />;
}
