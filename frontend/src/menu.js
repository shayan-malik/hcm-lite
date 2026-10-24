const menus = {
  admin: [
    { path: '/', label: 'Dashboard' },
    { path: '/employees', label: 'Employees' },
    { path: '/attendance', label: 'Attendance' },
    { path: '/leave', label: 'Leave' },
    { path: '/payroll', label: 'Payroll' },
    { path: '/organization', label: 'Organization' },
    { path: '/users', label: 'Users' },
    { path: '/announcements', label: 'Announcements' },
    { path: '/notifications', label: 'Notifications' },
    { path: '/audit', label: 'Audit Log' },
  ],
  hr: [
    { path: '/', label: 'Dashboard' },
    { path: '/employees', label: 'Employees' },
    { path: '/attendance', label: 'Attendance' },
    { path: '/leave', label: 'Leave Requests' },
    { path: '/payroll', label: 'Payroll' },
    { path: '/announcements', label: 'Announcements' },
    { path: '/notifications', label: 'Notifications' },
  ],
  employee: [
    { path: '/', label: 'Dashboard' },
    { path: '/attendance', label: 'My Attendance' },
    { path: '/leave', label: 'My Leave' },
    { path: '/payslips', label: 'Payslips' },
    { path: '/profile', label: 'Profile' },
    { path: '/announcements', label: 'Announcements' },
    { path: '/notifications', label: 'Notifications' },
  ],
};

export default menus;