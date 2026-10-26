import pool from '../db.js';
import { getStatuses, getToday } from './attendance.js';
import { getBalance } from './leave.js';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 10000) / 100 : 0);

// Reads from, to and department_id from the query string
export const resolveFilters = async (query) => {
  const today = await getToday();
  const to = query.to || today;
  const from = query.from || `${to.slice(0, 7)}-01`;

  if (!DATE_REGEX.test(from) || !DATE_REGEX.test(to) || from > to) {
    const err = new Error('from and to must be valid YYYY-MM-DD dates and from <= to');
    err.status = 400;
    throw err;
  }
  return { from, to, today, departmentId: query.department_id ? Number(query.department_id) : null };
};

const getEmployeesInRange = async ({ from, to, departmentId }) => {
  const values = [from, to];
  let dept = '';
  if (departmentId) {
    values.push(departmentId);
    dept = 'AND e.department_id = $3';
  }
  const result = await pool.query(
    `SELECT e.id, e.full_name, COALESCE(d.name, 'Unassigned') AS department
     FROM employees e LEFT JOIN departments d ON d.id = e.department_id
     WHERE e.join_date <= $2 AND (e.exit_date IS NULL OR e.exit_date >= $1) ${dept}`,
    values
  );
  return result.rows;
};

export const headcountAt = async (date, departmentId) => {
  const values = [date];
  let dept = '';
  if (departmentId) {
    values.push(departmentId);
    dept = 'AND department_id = $2';
  }
  const result = await pool.query(
    `SELECT COUNT(*)::int AS n FROM employees
     WHERE join_date <= $1::date AND (exit_date IS NULL OR exit_date > $1::date) ${dept}`,
    values
  );
  return result.rows[0].n;
};

const blank = () => ({ present: 0, late: 0, half_day: 0, missing_checkout: 0, absent: 0, on_leave: 0 });

const computeRates = (c) => {
  const worked = c.present + c.late + c.half_day + c.missing_checkout;
  const workingRecords = worked + c.absent + c.on_leave;
  return {
    ...c,
    attendanceRate: pct(c.present + c.late + c.missing_checkout + 0.5 * c.half_day, workingRecords - c.on_leave),
    latePercent: pct(c.late, c.present + c.late),
    absenteeismPercent: pct(c.absent, workingRecords),
  };
};

// Attendance rate, late %, absenteeism, trend and late-comers for a date range
export const getAttendanceAnalytics = async (filters) => {
  const emps = await getEmployeesInRange(filters);
  const empMap = new Map(emps.map((e) => [e.id, e]));
  const rows = await getStatuses(emps.map((e) => e.id), filters.from, filters.to);

  const total = blank();
  const byDept = {};
  const byDate = {};
  const lateByEmp = {};

  for (const r of rows) {
    if (!(r.status in total)) continue; // skips weekend and holiday rows
    const emp = empMap.get(r.employee_id);

    total[r.status]++;
    byDept[emp.department] = byDept[emp.department] || blank();
    byDept[emp.department][r.status]++;
    byDate[r.date] = byDate[r.date] || blank();
    byDate[r.date][r.status]++;

    if (r.status === 'late') {
      lateByEmp[r.employee_id] = (lateByEmp[r.employee_id] || 0) + 1;
    }
  }

  return {
    summary: computeRates(total),
    byDepartment: Object.entries(byDept).map(([department, c]) => ({ department, ...computeRates(c) })),
    trend: Object.entries(byDate)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, c]) => ({ date, attendanceRate: computeRates(c).attendanceRate })),
    topLateComers: Object.entries(lateByEmp)
      .map(([id, lates]) => ({
        employee_id: Number(id),
        full_name: empMap.get(Number(id)).full_name,
        department: empMap.get(Number(id)).department,
        lates,
      }))
      .sort((a, b) => b.lates - a.lates)
      .slice(0, 5),
  };
};

// Approved leave days vs quota, per leave type and department (calendar year of "to")
export const getLeaveAnalytics = async ({ to, departmentId }) => {
  const year = Number(to.slice(0, 4));
  const values = [year];
  let dept = '';
  if (departmentId) {
    values.push(departmentId);
    dept = 'AND e.department_id = $2';
  }

  const used = await pool.query(
    `SELECT t.name AS leave_type, t.yearly_quota, COALESCE(d.name, 'Unassigned') AS department,
            SUM(r.days)::int AS approved_days
     FROM leave_requests r
     JOIN leave_types t ON t.id = r.leave_type_id
     JOIN employees e ON e.id = r.employee_id
     LEFT JOIN departments d ON d.id = e.department_id
     WHERE r.status = 'approved' AND EXTRACT(YEAR FROM r.start_date) = $1 ${dept}
     GROUP BY t.name, t.yearly_quota, d.name`,
    values
  );

  const heads = await pool.query(
  `SELECT COALESCE(d.name, 'Unassigned') AS department, COUNT(*)::int AS n
   FROM employees e LEFT JOIN departments d ON d.id = e.department_id
   WHERE e.status IN ('active','probation') ${departmentId ? 'AND e.department_id = $1' : ''}
   GROUP BY d.name`,
  departmentId ? [departmentId] : []
);
  const headMap = new Map(heads.rows.map((h) => [h.department, h.n]));

  const byType = {};
  const byTypeAndDept = used.rows.map((r) => {
    byType[r.leave_type] = (byType[r.leave_type] || 0) + r.approved_days;
    const capacity = r.yearly_quota === null ? null : r.yearly_quota * (headMap.get(r.department) || 0);
    return {
      ...r,
      utilizationPercent: capacity ? pct(r.approved_days, capacity) : null,
    };
  });

  return {
    year,
    byType: Object.entries(byType).map(([leave_type, approved_days]) => ({ leave_type, approved_days })),
    byTypeAndDepartment: byTypeAndDept,
  };
};

export const getHrDashboard = async (filters) => {
  const { today, departmentId } = filters;

  const todayEmps = await getEmployeesInRange({ from: today, to: today, departmentId });
  const todayRows = await getStatuses(todayEmps.map((e) => e.id), today, today);
  const countToday = (statuses) => todayRows.filter((r) => statuses.includes(r.status)).length;

  const pending = await pool.query(
    `SELECT (SELECT COUNT(*) FROM leave_requests WHERE status = 'pending')::int AS leave,
            (SELECT COUNT(*) FROM attendance_corrections WHERE status = 'pending')::int AS corrections`
  );

  return {
    filters,
    kpis: {
      headcount: await headcountAt(today, departmentId),
      presentToday: countToday(['present', 'late', 'half_day', 'missing_checkout']),
      onLeaveToday: countToday(['on_leave']),
      lateToday: countToday(['late']),
      pendingApprovals: pending.rows[0].leave + pending.rows[0].corrections,
      pendingLeave: pending.rows[0].leave,
      pendingCorrections: pending.rows[0].corrections,
    },
    attendance: await getAttendanceAnalytics(filters),
    leave: await getLeaveAnalytics(filters),
  };
};

export const getAdminDashboard = async (filters) => {
  const { today, departmentId } = filters;
  const year = today.slice(0, 4);

  const headcount = await headcountAt(today, departmentId);
  const startHeadcount = await headcountAt(`${year}-01-01`, departmentId);
  const averageHeadcount = (headcount + startHeadcount) / 2;

  const deptValues = departmentId ? [departmentId] : [];
  const deptAnd = departmentId ? 'AND e.department_id = $1' : '';

  const exits = await pool.query(
    `SELECT COUNT(*)::int AS n FROM employees e
     WHERE exit_date IS NOT NULL AND exit_date >= '${year}-01-01' AND exit_date <= CURRENT_DATE ${deptAnd}`,
    deptValues
  );

  const payrollByMonth = await pool.query(
    `SELECT r.month, COALESCE(d.name, 'Unassigned') AS department,
            SUM(p.gross)::float AS gross, SUM(p.net)::float AS net
     FROM payslips p
     JOIN payroll_runs r ON r.id = p.run_id
     JOIN employees e ON e.id = p.employee_id
     LEFT JOIN departments d ON d.id = e.department_id
     WHERE TRUE ${deptAnd}
     GROUP BY r.month, d.name ORDER BY r.month`,
    deptValues
  );

  const latestMonth = payrollByMonth.rows.length
    ? payrollByMonth.rows[payrollByMonth.rows.length - 1].month
    : null;
  const latest = payrollByMonth.rows.filter((r) => r.month === latestMonth);

  const activeAnd = `WHERE e.status IN ('active','probation') ${deptAnd}`;

  const headcountByDept = await pool.query(
    `SELECT COALESCE(d.name, 'Unassigned') AS department, COUNT(*)::int AS headcount
     FROM employees e LEFT JOIN departments d ON d.id = e.department_id
     ${activeAnd} GROUP BY d.name ORDER BY headcount DESC`,
    deptValues
  );

  const avgByDept = await pool.query(
    `SELECT COALESCE(d.name, 'Unassigned') AS department, ROUND(AVG(e.basic_salary * 1.5), 2)::float AS avg_gross
     FROM employees e LEFT JOIN departments d ON d.id = e.department_id
     ${activeAnd} GROUP BY d.name`,
    deptValues
  );

  const avgByDesignation = await pool.query(
    `SELECT COALESCE(g.name, 'Unassigned') AS designation, ROUND(AVG(e.basic_salary * 1.5), 2)::float AS avg_gross
     FROM employees e LEFT JOIN designations g ON g.id = e.designation_id
     ${activeAnd} GROUP BY g.name`,
    deptValues
  );

  const avgAll = await pool.query(
    `SELECT COALESCE(ROUND(AVG(e.basic_salary * 1.5), 2), 0)::float AS avg_gross
     FROM employees e ${activeAnd}`,
    deptValues
  );

  const gender = await pool.query(
    `SELECT COALESCE(e.gender, 'Unspecified') AS gender, COUNT(*)::int AS n
     FROM employees e ${activeAnd} GROUP BY 1`,
    deptValues
  );

  const tenure = await pool.query(
    `SELECT CASE WHEN CURRENT_DATE - e.join_date < 365 THEN 'Under 1 year'
                 WHEN CURRENT_DATE - e.join_date < 1095 THEN '1 to 3 years'
                 ELSE '3+ years' END AS bucket, COUNT(*)::int AS n
     FROM employees e ${activeAnd} GROUP BY 1`,
    deptValues
  );

  const audit = await pool.query(
    `SELECT a.id, a.action, a.entity, a.entity_id, a.created_at, u.email AS actor
     FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
     ORDER BY a.id DESC LIMIT 10`
  );

  return {
    filters,
    kpis: {
      headcount,
      attritionYtdPercent: pct(exits.rows[0].n, averageHeadcount),
      exitsYtd: exits.rows[0].n,
      payrollCost: {
        month: latestMonth,
        gross: latest.reduce((s, r) => s + r.gross, 0),
        net: latest.reduce((s, r) => s + r.net, 0),
      },
      averageGrossSalary: avgAll.rows[0].avg_gross,
    },
    headcountByDepartment: headcountByDept.rows,
    payrollCostByMonthAndDepartment: payrollByMonth.rows,
    averageGrossByDepartment: avgByDept.rows,
    averageGrossByDesignation: avgByDesignation.rows,
    genderSplit: gender.rows,
    tenureSplit: tenure.rows,
    auditFeed: audit.rows,
  };
};

export const getEmployeeDashboard = async (employeeId) => {
  const today = await getToday();
  const month = today.slice(0, 7);

  const hours = await pool.query(
    `SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (
              COALESCE(check_out, CASE WHEN date = $2::date THEN NOW() ELSE check_in END) - check_in)) / 3600), 0)::float AS hours
     FROM attendance
     WHERE employee_id = $1 AND check_in IS NOT NULL
       AND date >= date_trunc('week', $2::date)::date`,
    [employeeId, today]
  );

  const lates = await pool.query(
    `SELECT COUNT(*)::int AS n FROM attendance
     WHERE employee_id = $1 AND status = 'late' AND to_char(date, 'YYYY-MM') = $2`,
    [employeeId, month]
  );

  const slip = await pool.query(
    `SELECT p.id, r.month, p.gross, p.net
     FROM payslips p JOIN payroll_runs r ON r.id = p.run_id
     WHERE p.employee_id = $1 AND r.status = 'finalized'
     ORDER BY r.month DESC LIMIT 1`,
    [employeeId]
  );

  const announcements = await pool.query(
    'SELECT id, title, body, created_at FROM announcements ORDER BY id DESC LIMIT 5'
  );

  return {
    hoursThisWeek: Math.round(hours.rows[0].hours * 100) / 100,
    weeklyTarget: 40,
    lateCountThisMonth: lates.rows[0].n,
    leaveBalance: await getBalance(employeeId, Number(today.slice(0, 4))),
    lastPayslip: slip.rows[0] || null,
    announcements: announcements.rows,
  };
};