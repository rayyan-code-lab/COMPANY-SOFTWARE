import { PurchaseForm } from '@/components/PurchaseManagement';

export const route = { path: '/purchases/new', layout: 'owner', access: 'authenticated' };

export default function PurchaseNewPage() {
  return <PurchaseForm mode="create" />;
}
