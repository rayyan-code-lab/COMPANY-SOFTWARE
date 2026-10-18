import { BasicList } from '@/components/BasicModule';

export const route = { path: '/inventory', layout: 'owner', access: 'authenticated' };
export const nav = { icon: 'Package', label: 'Inventory', section: 'Operations', order: 20 };

export default function InventoryPage() {
  return <BasicList moduleKey="inventory" />;
}