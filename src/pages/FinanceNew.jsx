import { Navigate } from 'react-router-dom';

export const route = { path: '/finance/new', layout: 'owner', access: 'authenticated' };

export default function FinanceNewPage() {
  return <Navigate to="/sales/new" replace />;
}
