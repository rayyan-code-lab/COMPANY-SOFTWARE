import AttendanceDaybook from '@/components/AttendanceDaybook';

export const route = { path: '/attendance', layout: 'owner', access: 'authenticated' };
export const nav = { icon: 'CalendarCheck', label: 'Attendance', section: 'People', order: 31 };

export default function AttendancePage() {
  return <AttendanceDaybook />;
}