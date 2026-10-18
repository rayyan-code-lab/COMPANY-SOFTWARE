import { PurchaseForm } from '@/components/PurchaseManagement';

export const route = { path: '/purchases/:id/edit', layout: 'owner', access: "profile === 'Admin_c'" };

export default function PurchaseEditPage() {
  return <PurchaseForm mode="edit" />;
}
