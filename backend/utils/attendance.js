import pool from '../db.js';

export const TZ = process.env.OFFICE_TZ || 'Asia/Karachi';
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const getToday = async () => {
  const result = await pool.query(`SELECT (NOW() AT TIME ZONE $1)::date::text AS d`, [TZ]);
  return result.rows[0].d;
};

const eachDate = (from, to) => {
  const dates = [];
  const current = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
};

// Returns one row per employee per date (up to today), with a final status
export const getStatuses = async (employeeIds, from, to) => {
  if (employeeIds.length === 0) return [];

  const today = await getToday();
  const lastDate = to > today ? today : to;
  if (from > lastDate) return [];

  const settings = (await pool.query('SELECT weekend_days FROM settings WHERE id = 1')).rows[0];
  const weekend = (settings?.weekend_days || 'Sat,Sun').split(',').map((d) => d.trim());

  const holidays = new Set(
    (await pool.query('SELECT date::text AS d FROM holidays WHERE date BETWEEN $1 AND $2', [from, lastDate]))
      .rows.map((r) => r.d)
  );

  const employees = (
    await pool.query(
      'SELECT id, join_date::text AS join_date, exit_date::text AS exit_date FROM employees WHERE id = ANY($1)',
      [employeeIds]
    )
  ).rows;

  const records = (
    await pool.query(
      `SELECT employee_id, date::text AS date, check_in, check_out, status, source
       FROM attendance WHERE employee_id = ANY($1) AND date BETWEEN $2 AND $3`,
      [employeeIds, from, lastDate]
    )
  ).rows;
  const recordMap = new Map(records.map((r) => [`${r.employee_id}|${r.date}`, r]));

  const leaves = (
    await pool.query(
      `SELECT employee_id, start_date::text AS s, end_date::text AS e
       FROM leave_requests
       WHERE status = 'approved' AND employee_id = ANY($1)
         AND start_date <= $3 AND end_date >= $2`,
      [employeeIds, from, lastDate]
    )
  ).rows;

  const dates = eachDate(from, lastDate);
  const output = [];

  for (const emp of employees) {
    for (const date of dates) {
      if (date < emp.join_date) continue;
      if (emp.exit_date && date > emp.exit_date) continue;

      const record = recordMap.get(`${emp.id}|${date}`);
      let status;
      let checkIn = null;
      let checkOut = null;
      let source = null;

      if (record) {
        checkIn = record.check_in;
        checkOut = record.check_out;
        source = record.source;
        status = !record.check_out && date < today ? 'missing_checkout' : record.status;
      } else if (weekend.includes(DAY_NAMES[new Date(`${date}T00:00:00Z`).getUTCDay()])) {
        status = 'weekend';
      } else if (holidays.has(date)) {
        status = 'holiday';
      } else if (leaves.some((l) => l.employee_id === emp.id && date >= l.s && date <= l.e)) {
        status = 'on_leave';
      } else {
        status = 'absent';
      }

      output.push({ employee_id: emp.id, date, status, check_in: checkIn, check_out: checkOut, source });
    }
  }

  return output;
};