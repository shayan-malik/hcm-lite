import pool from '../db.js';
import { getStatuses, getToday } from './attendance.js';
import { getBalance } from './leave.js';
import {
  resolveFilters,
  getAttendanceAnalytics,
  getLeaveAnalytics,
  headcountAt,
} from './analytics.js';

const fn = (name, description, properties = {}, required = []) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } },
});

const from = { type: 'string', description: 'Start date YYYY-MM-DD (optional, default start of current month)' };
const to = { type: 'string', description: 'End date YYYY-MM-DD (optional, default today)' };
const department = { type: 'string', description: 'Department name (optional)' };

export const toolDefinitions = [
  fn('get_headcount', 'Number of active employees today, optionally for one department', { department }),
  fn('get_attendance_summary', 'Attendance rate, late percent, absenteeism and day counts for a date range', { from, to, department }),
  fn('get_late_comers', 'Top 5 employees with the most late days in a date range', { from, to, department }),
  fn('get_leave_summary', 'Approved leave days by leave type and department for the current year', { department }),
  fn('get_my_leave_balance', 'Leave quota, used, pending and remaining of the signed-in user', {
    year: { type: 'number', description: 'Year (optional, default current year)' },
  }),
  fn('get_payroll_summary', 'Payroll totals per month (Admin/HR) or the signed-in user\'s own payslips'),
  fn('search_employees', 'Search employees by name, email or code', {
    q: { type: 'string', description: 'Search text' },
  }, ['q']),
];

const isStaff = (user) => ['admin', 'hr'].includes(user.role);
const denied = { error: 'You are not allowed to access this information.' };

const findDepartmentId = async (name) => {
  if (!name) return null;
  const result = await pool.query('SELECT id FROM departments WHERE name ILIKE $1 LIMIT 1', [name.trim()]);
  if (result.rowCount === 0) throw new Error(`Unknown department: ${name}`);
  return result.rows[0].id;
};

export const executeTool = async (name, args, user) => {
  try {
    const today = await getToday();

    switch (name) {
      case 'get_headcount': {
        if (!isStaff(user)) return denied;
        const departmentId = await findDepartmentId(args.department);
        return { date: today, department: args.department || 'All', headcount: await headcountAt(today, departmentId) };
      }

      case 'get_attendance_summary': {
        const filters = await resolveFilters({ from: args.from, to: args.to });
        if (!isStaff(user)) {
          // Employee: own records only
          const rows = await getStatuses([user.employeeId], filters.from, filters.to);
          const counts = {};
          rows.forEach((r) => { counts[r.status] = (counts[r.status] || 0) + 1; });
          return { from: filters.from, to: filters.to, own_day_counts: counts };
        }
        filters.departmentId = await findDepartmentId(args.department);
        const data = await getAttendanceAnalytics(filters);
        return { from: filters.from, to: filters.to, ...data.summary };
      }

      case 'get_late_comers': {
        if (!isStaff(user)) return denied;
        const filters = await resolveFilters({ from: args.from, to: args.to });
        filters.departmentId = await findDepartmentId(args.department);
        const data = await getAttendanceAnalytics(filters);
        return { from: filters.from, to: filters.to, top_late_comers: data.topLateComers };
      }

      case 'get_leave_summary': {
        if (!isStaff(user)) {
          const own = await pool.query(
            `SELECT t.name AS leave_type, SUM(r.days)::int AS approved_days
             FROM leave_requests r JOIN leave_types t ON t.id = r.leave_type_id
             WHERE r.employee_id = $1 AND r.status = 'approved'
               AND EXTRACT(YEAR FROM r.start_date) = $2
             GROUP BY t.name`,
            [user.employeeId, Number(today.slice(0, 4))]
          );
          return { own_approved_leave: own.rows };
        }
        const filters = await resolveFilters({});
        filters.departmentId = await findDepartmentId(args.department);
        return getLeaveAnalytics(filters);
      }

      case 'get_my_leave_balance': {
        if (!user.employeeId) return { error: 'This account has no employee record.' };
        const year = Number(args.year) || Number(today.slice(0, 4));
        const balance = await getBalance(user.employeeId, year);
        return {
          year,
          balance: balance.map((b) => ({
            type: b.name,
            quota: b.yearly_quota ?? 'unlimited',
            used: b.used,
            pending: b.pending,
            remaining: b.remaining ?? 'unlimited',
          })),
        };
      }

      case 'get_payroll_summary': {
        if (isStaff(user)) {
          const runs = await pool.query(
            `SELECT r.month, r.status, COUNT(p.id)::int AS payslips,
                    COALESCE(SUM(p.gross), 0)::float AS total_gross,
                    COALESCE(SUM(p.net), 0)::float AS total_net
             FROM payroll_runs r LEFT JOIN payslips p ON p.run_id = r.id
             GROUP BY r.id ORDER BY r.month DESC LIMIT 6`
          );
          return { runs: runs.rows };
        }
        const own = await pool.query(
          `SELECT r.month, p.gross, p.deductions, p.tax, p.net
           FROM payslips p JOIN payroll_runs r ON r.id = p.run_id
           WHERE p.employee_id = $1 AND r.status = 'finalized'
           ORDER BY r.month DESC LIMIT 6`,
          [user.employeeId]
        );
        return { own_payslips: own.rows };
      }

      case 'search_employees': {
        if (!isStaff(user)) return denied;
        const result = await pool.query(
          `SELECT e.code, e.full_name, e.email, e.status, d.name AS department, g.name AS designation
           FROM employees e
           LEFT JOIN departments d ON d.id = e.department_id
           LEFT JOIN designations g ON g.id = e.designation_id
           WHERE e.full_name ILIKE $1 OR e.email ILIKE $1 OR e.code ILIKE $1
           ORDER BY e.full_name LIMIT 10`,
          [`%${args.q || ''}%`]
        );
        return { employees: result.rows };
      }

      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    return { error: err.message };
  }
};