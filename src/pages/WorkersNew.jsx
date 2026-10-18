import { BasicForm } from '@/components/BasicModule';

export const route = { path: '/workers/new', layout: 'owner', access: 'authenticated' };

export default function WorkersNewPage() {
  return <BasicForm moduleKey="workers" />;
}