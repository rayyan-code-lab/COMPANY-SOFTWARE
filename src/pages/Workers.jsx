import WorkerManagement from '@/components/WorkerManagement';

export const route = { path: '/workers', layout: 'owner', access: 'authenticated' };
export const nav = { icon: 'Users', label: 'Workers', section: 'People', order: 30 };

export default function WorkersPage() {
  return <WorkerManagement />;
}