import { BasicForm } from '@/components/BasicModule';

export const route = { path: '/inventory/new', layout: 'owner', access: 'authenticated' };

export default function InventoryNewPage() {
  return <BasicForm moduleKey="inventory" />;
}