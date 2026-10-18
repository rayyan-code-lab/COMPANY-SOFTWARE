import { PurchaseDetail as PurchaseDetailView } from '@/components/PurchaseManagement';

export const route = { path: '/purchases/:id', layout: 'owner', access: 'authenticated' };

export default function PurchaseDetailPage() {
  return <PurchaseDetailView />;
}
