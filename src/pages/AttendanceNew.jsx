import { Navigate } from 'react-router-dom';

export const route = { path: '/attendance/new', layout: 'owner', access: 'authenticated' };

export default function AttendanceNewPage() {
  return <Navigate to="/attendance" replace />;
}