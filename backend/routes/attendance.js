import { Router } from 'express';
import pool from '../db.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { logAudit } from '../utils/audit.js';
import { TZ, getToday, getStatuses } from '../utils/attendance.js';

const router = Router();
router.use(authenticate);

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TIME_REGEX = /^\d{2}:\d{2}$/;

const requireEmployeeId = (req, res, next) => {
  if (!req.user.employeeId) {
    return res.status(400).json({ error: 'This account is not linked to an employee record' });
  }
  next();
};

// ---------- Check in (server stamps the time) ----------
router.post('/check-in', authorize('employee', 'hr'), requireEmployeeId, async (req, res) => {
  try {
    const result = await pool.query(
      `INSERT INTO attendance (employee_id, date, check_in, status, source)
       SELECT $1, (NOW() AT TIME ZONE $2)::date, NOW(),
         CASE WHEN (NOW() AT TIME ZONE $2)::time > s.office_start + (s.grace_minutes * INTERVAL '1 minute')
              THEN 'late' ELSE 'present' END,
         'web'
       FROM settings s WHERE s.id = 1
       RETURNING *`,
      [req.user.employeeId, TZ]
    );

    if (result.rowCount === 0) {
      return res.status(400).json({ error: 'Company setup is not complete' });
    }
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'You have already checked in today' });
    }
    res.status(500).json({ error: err.message });
  }
});

// ---------- Check out ----------
router.post('/check-out', authorize('employee', 'hr'), requireEmployeeId, async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE attendance a SET
         check_out = NOW(),
         status = CASE WHEN EXTRACT(EPOCH FROM (NOW() - a.check_in)) / 3600 < s.half_day_hours
                       THEN 'half_day' ELSE a.status END
       FROM settings s
       WHERE a.employee_id = $1
         AND a.date = (NOW() AT TIME ZONE $2)::date
         AND a.check_out IS NULL
         AND s.id = 1
       RETURNING a.*`,
      [req.user.employeeId, TZ]
    );

    if (result.rowCount === 0) {
      return res.status(400).json({ error: 'No open check-in found for today' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Today's record (for the check-in widget) ----------
router.get('/today', authorize('employee', 'hr'), requireEmployeeId, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM attendance
       WHERE employee_id = $1 AND date = (NOW() AT TIME ZONE $2)::date`,
      [req.user.employeeId, TZ]
    );
    res.json(result.rows[0] || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Own calendar: ?month=YYYY-MM ----------
router.get('/my', authorize('employee', 'hr'), requireEmployeeId, async (req, res) => {
  try {
    const today = await getToday();
    const month = req.query.month || today.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'month must be in YYYY-MM format' });
    }

    const [y, m] = month.split('-').map(Number);
    const from = `${month}-01`;
    const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

    const rows = await getStatuses([req.user.employeeId], from, to);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Daily board (Admin + HR): ?date=YYYY-MM-DD&department_id= ----------
router.get('/board', authorize('admin', 'hr'), async (req, res) => {
  try {
    const date = req.query.date || (await getToday());
    if (!DATE_REGEX.test(date)) {
      return res.status(400).json({ error: 'date must be in YYYY-MM-DD format' });
    }

    const values = [];
    let where = `WHERE e.status IN ('active','probation')`;
    if (req.query.department_id) {
      values.push(req.query.department_id);
      where += ` AND e.department_id = $${values.length}`;
    }

    const employees = (
      await pool.query(
        `SELECT e.id, e.code, e.full_name, d.name AS department
         FROM employees e LEFT JOIN departments d ON d.id = e.department_id
         ${where} ORDER BY e.full_name`,
        values
      )
    ).rows;

    const statuses = await getStatuses(employees.map((e) => e.id), date, date);
    const statusMap = new Map(statuses.map((s) => [s.employee_id, s]));

    res.json(
      employees.map((e) => ({
        ...e,
        status: statusMap.get(e.id)?.status || 'n/a',
        check_in: statusMap.get(e.id)?.check_in || null,
        check_out: statusMap.get(e.id)?.check_out || null,
      }))
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Corrections: request (Employee) ----------
router.post('/corrections', authorize('employee'), requireEmployeeId, async (req, res) => {
  try {
    const { date, reason, check_in, check_out } = req.body;

    if (!date || !reason || !check_in || !check_out) {
      return res.status(400).json({ error: 'date, reason, check_in and check_out are required' });
    }
    if (!DATE_REGEX.test(date) || !TIME_REGEX.test(check_in) || !TIME_REGEX.test(check_out)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD and times must be HH:MM' });
    }
    if (check_out <= check_in) {
      return res.status(400).json({ error: 'check_out must be after check_in' });
    }
    if (date > (await getToday())) {
      return res.status(400).json({ error: 'Cannot request a correction for a future date' });
    }

    const result = await pool.query(
      `INSERT INTO attendance_corrections
         (employee_id, date, reason, requested_check_in, requested_check_out)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.employeeId, date, reason, check_in, check_out]
    );

    await logAudit(req.user.id, 'create', 'attendance_corrections', result.rows[0].id, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Corrections: list (Employee = own, Admin/HR = all) ----------
router.get('/corrections', async (req, res) => {
  try {
    const values = [];
    const conditions = [];

    if (req.user.role === 'employee') {
      values.push(req.user.employeeId);
      conditions.push(`c.employee_id = $${values.length}`);
    }
    if (req.query.status) {
      values.push(req.query.status);
      conditions.push(`c.status = $${values.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await pool.query(
      `SELECT c.*, c.date::text AS date, e.full_name, e.code
       FROM attendance_corrections c JOIN employees e ON e.id = c.employee_id
       ${where} ORDER BY c.id DESC`,
      values
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Corrections: approve / reject (HR only) ----------
router.patch('/corrections/:id', authorize('hr'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { decision } = req.body;
    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ error: "decision must be 'approved' or 'rejected'" });
    }

    await client.query('BEGIN');

    const found = await client.query(
      `SELECT *, date::text AS date_text,
              to_char(requested_check_in, 'HH24:MI') AS ci,
              to_char(requested_check_out, 'HH24:MI') AS co
       FROM attendance_corrections WHERE id = $1 FOR UPDATE`,
      [req.params.id]
    );
    const correction = found.rows[0];

    if (!correction) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }
    if (correction.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This request was already reviewed' });
    }

    if (decision === 'approved') {
      await client.query(
        `INSERT INTO attendance (employee_id, date, check_in, check_out, status, source)
         SELECT $1, $2::date,
           ($2::date + $3::time) AT TIME ZONE $4,
           ($2::date + $5::time) AT TIME ZONE $4,
           CASE WHEN EXTRACT(EPOCH FROM ($5::time - $3::time)) / 3600 < s.half_day_hours THEN 'half_day'
                WHEN $3::time > s.office_start + (s.grace_minutes * INTERVAL '1 minute') THEN 'late'
                ELSE 'present' END,
           'correction'
         FROM settings s WHERE s.id = 1
         ON CONFLICT (employee_id, date) DO UPDATE SET
           check_in = EXCLUDED.check_in,
           check_out = EXCLUDED.check_out,
           status = EXCLUDED.status,
           source = 'correction'`,
        [correction.employee_id, correction.date_text, correction.ci, TZ, correction.co]
      );
    }

    const updated = await client.query(
      `UPDATE attendance_corrections SET status = $1, reviewed_by = $2
       WHERE id = $3 RETURNING *`,
      [decision, req.user.id, req.params.id]
    );

    // Notify the employee
    await client.query(
      `INSERT INTO notifications (user_id, message)
       SELECT id, $1 FROM users WHERE employee_id = $2`,
      [`Your attendance correction for ${correction.date_text} was ${decision}`, correction.employee_id]
    );

    await client.query('COMMIT');

    await logAudit(req.user.id, decision, 'attendance_corrections', correction.id, correction, updated.rows[0]);
    res.json(updated.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

export default router;