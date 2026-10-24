import pool from '../db.js';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Counts working days between two dates (skips weekends and holidays)
export const countWorkingDays = async (start, end) => {
  const settings = (await pool.query('SELECT weekend_days FROM settings WHERE id = 1')).rows[0];
  const weekend = (settings?.weekend_days || 'Sat,Sun').split(',').map((d) => d.trim());

  const holidays = new Set(
    (await pool.query('SELECT date::text AS d FROM holidays WHERE date BETWEEN $1 AND $2', [start, end]))
      .rows.map((r) => r.d)
  );

  let days = 0;
  const current = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);

  while (current <= last) {
    const iso = current.toISOString().slice(0, 10);
    if (!weekend.includes(DAY_NAMES[current.getUTCDay()]) && !holidays.has(iso)) {
      days++;
    }
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return days;
};

// Balance per leave type for one employee and year
export const getBalance = async (employeeId, year) => {
  const result = await pool.query(
    `SELECT t.id AS leave_type_id, t.name, t.yearly_quota,
       COALESCE(SUM(r.days) FILTER (WHERE r.status = 'approved'), 0)::int AS used,
       COALESCE(SUM(r.days) FILTER (WHERE r.status = 'pending'), 0)::int AS pending
     FROM leave_types t
     LEFT JOIN leave_requests r
       ON r.leave_type_id = t.id
      AND r.employee_id = $1
      AND EXTRACT(YEAR FROM r.start_date) = $2
     GROUP BY t.id ORDER BY t.id`,
    [employeeId, year]
  );

  return result.rows.map((r) => ({
    ...r,
    // null means unlimited (unpaid)
    remaining: r.yearly_quota === null ? null : r.yearly_quota - r.used,
    available: r.yearly_quota === null ? null : r.yearly_quota - r.used - r.pending,
  }));
};