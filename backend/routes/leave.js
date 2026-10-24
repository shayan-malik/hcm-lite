import { Router } from 'express';
import pool from '../db.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { logAudit } from '../utils/audit.js';
import { getToday } from '../utils/attendance.js';
import { countWorkingDays, getBalance } from '../utils/leave.js';

const router = Router();
router.use(authenticate);

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const requireEmployeeId = (req, res, next) => {
  if (!req.user.employeeId) {
    return res.status(400).json({ error: 'This account is not linked to an employee record' });
  }
  next();
};

// ---------- Apply for leave ----------
router.post('/', authorize('employee', 'hr'), requireEmployeeId, async (req, res) => {
  try {
    const { leave_type_id, start_date, end_date, reason } = req.body;

    if (!leave_type_id || !start_date || !end_date) {
      return res.status(400).json({ error: 'leave_type_id, start_date and end_date are required' });
    }
    if (!DATE_REGEX.test(start_date) || !DATE_REGEX.test(end_date)) {
      return res.status(400).json({ error: 'Dates must be in YYYY-MM-DD format' });
    }
    if (end_date < start_date) {
      return res.status(400).json({ error: 'end_date cannot be before start_date' });
    }
    if (start_date.slice(0, 4) !== end_date.slice(0, 4)) {
      return res.status(422).json({ error: 'A leave request cannot span two calendar years' });
    }

    const type = (await pool.query('SELECT * FROM leave_types WHERE id = $1', [leave_type_id])).rows[0];
    if (!type) return res.status(400).json({ error: 'Unknown leave type' });

    // Working days only
    const days = await countWorkingDays(start_date, end_date);
    if (days === 0) {
      return res.status(422).json({ error: 'Selected dates have no working days' });
    }

    // Overlap check against pending and approved requests
    const overlap = await pool.query(
      `SELECT 1 FROM leave_requests
       WHERE employee_id = $1 AND status IN ('pending','approved')
         AND start_date <= $3 AND end_date >= $2`,
      [req.user.employeeId, start_date, end_date]
    );
    if (overlap.rowCount > 0) {
      return res.status(422).json({ error: 'These dates overlap with another leave request' });
    }

    // Balance check (unlimited when quota is null)
    const balances = await getBalance(req.user.employeeId, Number(start_date.slice(0, 4)));
    const balance = balances.find((b) => b.leave_type_id === type.id);
    if (balance.available !== null && days > balance.available) {
      return res.status(422).json({
        error: `Not enough ${type.name} leave balance. Requested ${days}, available ${balance.available}`,
      });
    }

    const result = await pool.query(
      `INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days, reason)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *, start_date::text AS start_date, end_date::text AS end_date`,
      [req.user.employeeId, type.id, start_date, end_date, days, reason || null]
    );

    // Notify all active HR users
    await pool.query(
      `INSERT INTO notifications (user_id, message)
       SELECT u.id, $1 FROM users u WHERE u.role = 'hr' AND u.is_active`,
      [`New ${type.name} leave request (${days} day(s)) from ${start_date} to ${end_date}`]
    );

    await logAudit(req.user.id, 'create', 'leave_requests', result.rows[0].id, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Own balance ----------
router.get('/balance', authorize('employee', 'hr'), requireEmployeeId, async (req, res) => {
  try {
    const year = Number(req.query.year) || Number((await getToday()).slice(0, 4));
    res.json(await getBalance(req.user.employeeId, year));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Balance of any employee (Admin + HR) ----------
router.get('/balance/:employeeId', authorize('admin', 'hr'), async (req, res) => {
  try {
    const year = Number(req.query.year) || Number((await getToday()).slice(0, 4));
    res.json(await getBalance(Number(req.params.employeeId), year));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- List: Employee = own, Admin/HR = all (approval inbox: ?status=pending) ----------
router.get('/', async (req, res) => {
  try {
    const values = [];
    const conditions = [];

    if (req.user.role === 'employee') {
      values.push(req.user.employeeId);
      conditions.push(`r.employee_id = $${values.length}`);
    }
    if (req.query.status) {
      values.push(req.query.status);
      conditions.push(`r.status = $${values.length}`);
    }
    if (req.query.employee_id && req.user.role !== 'employee') {
      values.push(req.query.employee_id);
      conditions.push(`r.employee_id = $${values.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await pool.query(
      `SELECT r.*, r.start_date::text AS start_date, r.end_date::text AS end_date,
              t.name AS leave_type, e.full_name, e.code
       FROM leave_requests r
       JOIN leave_types t ON t.id = r.leave_type_id
       JOIN employees e ON e.id = r.employee_id
       ${where} ORDER BY r.id DESC`,
      values
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Cancel own leave (pending, or approved and not yet finished) ----------
router.patch('/:id/cancel', authorize('employee', 'hr'), requireEmployeeId, async (req, res) => {
  try {
    const before = (
      await pool.query('SELECT * FROM leave_requests WHERE id = $1 AND employee_id = $2', [
        req.params.id,
        req.user.employeeId,
      ])
    ).rows[0];

    if (!before) return res.status(404).json({ error: 'Not found' });
    if (!['pending', 'approved'].includes(before.status)) {
      return res.status(409).json({ error: `A ${before.status} request cannot be cancelled` });
    }

    const today = await getToday();
    const endDate = new Date(before.end_date).toISOString().slice(0, 10);
    if (before.status === 'approved' && endDate < today) {
      return res.status(409).json({ error: 'This leave is already over' });
    }

    const result = await pool.query(
      `UPDATE leave_requests SET status = 'cancelled' WHERE id = $1 RETURNING *`,
      [before.id]
    );

    await logAudit(req.user.id, 'cancel', 'leave_requests', before.id, before, result.rows[0]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Approve or reject (HR only) ----------
router.patch('/:id/decision', authorize('hr'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { decision, comment } = req.body;

    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ error: "decision must be 'approved' or 'rejected'" });
    }
    if (decision === 'rejected' && !comment) {
      return res.status(400).json({ error: 'A comment is required when rejecting' });
    }

    await client.query('BEGIN');

    const found = await client.query('SELECT * FROM leave_requests WHERE id = $1 FOR UPDATE', [req.params.id]);
    const request = found.rows[0];

    if (!request) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }
    if (request.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This request was already reviewed' });
    }
    if (request.employee_id === req.user.employeeId) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'You cannot review your own request' });
    }

    const updated = await client.query(
      `UPDATE leave_requests SET status = $1, hr_comment = $2, reviewed_by = $3
       WHERE id = $4 RETURNING *`,
      [decision, comment || null, req.user.id, request.id]
    );

    await client.query(
      `INSERT INTO notifications (user_id, message)
       SELECT id, $1 FROM users WHERE employee_id = $2`,
      [`Your leave request was ${decision}${comment ? `: ${comment}` : ''}`, request.employee_id]
    );

    await client.query('COMMIT');

    await logAudit(req.user.id, decision, 'leave_requests', request.id, request, updated.rows[0]);
    res.json(updated.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

export default router;