import { Navigate } from 'react-router-dom';

export const route = { path: '/finance', layout: 'owner', access: 'authenticated' };

export default function FinancePage() {
  return <Navigate to="/sales" replace />;
}
