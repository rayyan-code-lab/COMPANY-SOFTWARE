import { SimpleFinanceList } from '@/components/SimpleFinanceModule';

export const route = { path: '/sales', layout: 'owner', access: 'authenticated' };
export const nav = { icon: 'TrendingUp', label: 'Sales', section: 'Finance', order: 41 };

export default function SalesPage() {
  return <SimpleFinanceList kind="sales" />;
}
