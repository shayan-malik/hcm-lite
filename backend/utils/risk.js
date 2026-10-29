import pool from '../db.js';
import { getStatuses, getToday } from './attendance.js';

const addDays = (date, n) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export const getAttritionRisk = async (departmentId = null) => {
  const today = await getToday();
  const from30 = addDays(today, -30);
  const from90 = addDays(today, -90);

  const values = [];
  let dept = '';
  if (departmentId) {
    values.push(departmentId);
    dept = 'AND e.department_id = $1';
  }

  const emps = (
    await pool.query(
      `SELECT e.id, e.full_name, e.join_date::text AS join_date, COALESCE(d.name, 'Unassigned') AS department
       FROM employees e LEFT JOIN departments d ON d.id = e.department_id
       WHERE e.status IN ('active','probation') ${dept}`,
      values
    )
  ).rows;
  if (emps.length === 0) return [];

  const ids = emps.map((e) => e.id);
  const statuses = await getStatuses(ids, from30, today);

  const leaves = (
    await pool.query(
      `SELECT r.employee_id, r.status, t.is_paid
       FROM leave_requests r JOIN leave_types t ON t.id = r.leave_type_id
       WHERE r.employee_id = ANY($1) AND r.start_date >= $2`,
      [ids, from90]
    )
  ).rows;

  const corrections = (
    await pool.query(
      `SELECT employee_id, COUNT(*)::int AS n FROM attendance_corrections
       WHERE employee_id = ANY($1) AND date >= $2 GROUP BY employee_id`,
      [ids, from30]
    )
  ).rows;
  const correctionMap = new Map(corrections.map((c) => [c.employee_id, c.n]));

  const sixMonthsAgo = addDays(today, -183);

  return emps
    .map((e) => {
      const own = statuses.filter((s) => s.employee_id === e.id);
      const absent = own.filter((s) => s.status === 'absent').length;
      const late = own.filter((s) => s.status === 'late').length;
      const ownLeaves = leaves.filter((l) => l.employee_id === e.id);
      const refused = ownLeaves.filter((l) => ['rejected', 'cancelled'].includes(l.status)).length;
      const unpaid = ownLeaves.filter((l) => !l.is_paid && l.status === 'approved').length;
      const fixes = correctionMap.get(e.id) || 0;

      let score = 0;
      const reasons = [];
      if (absent >= 3) { score += 30; reasons.push(`${absent} absent days (30 days)`); }
      if (late >= 5) { score += 25; reasons.push(`${late} late days (30 days)`); }
      if (refused >= 3) { score += 15; reasons.push(`${refused} rejected/cancelled leaves (90 days)`); }
      if (unpaid > 0) { score += 10; reasons.push('Took unpaid leave (90 days)'); }
      if (e.join_date > sixMonthsAgo) { score += 10; reasons.push('Tenure under 6 months'); }
      if (fixes >= 2) { score += 10; reasons.push(`${fixes} attendance corrections (30 days)`); }

      return {
        employee_id: e.id,
        full_name: e.full_name,
        department: e.department,
        score,
        level: score >= 60 ? 'High' : score >= 30 ? 'Medium' : 'Low',
        reasons: reasons.join(', ') || 'No risk signals',
      };
    })
    .sort((a, b) => b.score - a.score);
};