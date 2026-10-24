import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import pool from '../db.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { logAudit } from '../utils/audit.js';

const router = Router();
router.use(authenticate);

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const BASE_SELECT = `
  SELECT e.*, d.name AS department, g.name AS designation
  FROM employees e
  LEFT JOIN departments d ON d.id = e.department_id
  LEFT JOIN designations g ON g.id = e.designation_id
`;

// ---------- Register employee (HR only) ----------
router.post('/', authorize('hr'), async (req, res) => {
  const client = await pool.connect();
  try {
    const b = req.body;
    const email = (b.email || '').trim().toLowerCase();

    // Validation
    if (!b.full_name || !email || !b.join_date || b.basic_salary === undefined) {
      return res.status(400).json({ error: 'full_name, email, join_date and basic_salary are required' });
    }
    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ error: 'Invalid email' });
    }
    if (!DATE_REGEX.test(b.join_date)) {
      return res.status(400).json({ error: 'join_date must be in YYYY-MM-DD format' });
    }
    if (!(Number(b.basic_salary) > 0)) {
      return res.status(400).json({ error: 'basic_salary must be greater than 0' });
    }
    if (b.department_id) {
      const dept = await pool.query('SELECT 1 FROM departments WHERE id = $1', [b.department_id]);
      if (dept.rowCount === 0) return res.status(400).json({ error: 'Unknown department' });
    }

    // Generate code and temporary password if not provided
    let code = b.code;
    if (!code) {
      const next = await pool.query('SELECT COALESCE(MAX(id), 0) + 1 AS n FROM employees');
      code = `EMP-${String(next.rows[0].n).padStart(4, '0')}`;
    }
    const tempPassword = b.tempPassword || crypto.randomBytes(4).toString('hex');
    const hash = await bcrypt.hash(tempPassword, 10);

    // One transaction: employee + login are created together or not at all
    await client.query('BEGIN');

    const emp = await client.query(
      `INSERT INTO employees
        (code, full_name, email, phone, address, gender, department_id, designation_id,
         join_date, status, basic_salary)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,'active'),$11)
       RETURNING *`,
      [code, b.full_name, email, b.phone || null, b.address || null, b.gender || null,
       b.department_id || null, b.designation_id || null, b.join_date, b.status, b.basic_salary]
    );

    await client.query(
      `INSERT INTO users (email, password_hash, role, employee_id, must_change_password)
       VALUES ($1, $2, 'employee', $3, TRUE)`,
      [email, hash, emp.rows[0].id]
    );

    await client.query('COMMIT');

    await logAudit(req.user.id, 'create', 'employees', emp.rows[0].id, null, emp.rows[0]);

    // Temporary password is returned only once so HR can share it
    res.status(201).json({ employee: emp.rows[0], tempPassword });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Employee code or email already exists' });
    }
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ---------- Directory: search, filters, paging (Admin + HR) ----------
router.get('/', authorize('admin', 'hr'), async (req, res) => {
  try {
    const { q, department_id, status } = req.query;
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 100);

    const conditions = [];
    const values = [];

    if (q) {
      values.push(`%${q}%`);
      conditions.push(`(e.full_name ILIKE $${values.length} OR e.email ILIKE $${values.length} OR e.code ILIKE $${values.length})`);
    }
    if (department_id) {
      values.push(department_id);
      conditions.push(`e.department_id = $${values.length}`);
    }
    if (status) {
      values.push(status);
      conditions.push(`e.status = $${values.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const total = await pool.query(`SELECT COUNT(*) FROM employees e ${where}`, values);

    values.push(limit, (page - 1) * limit);
    const rows = await pool.query(
      `${BASE_SELECT} ${where} ORDER BY e.id DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );

    res.json({
      data: rows.rows,
      page,
      limit,
      total: Number(total.rows[0].count),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Own profile (must be before /:id) ----------
router.get('/me', authorize('employee'), async (req, res) => {
  try {
    const result = await pool.query(`${BASE_SELECT} WHERE e.id = $1`, [req.user.employeeId]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Employee can edit only phone and address
router.patch('/me', authorize('employee'), async (req, res) => {
  try {
    const { phone, address } = req.body;
    const before = (await pool.query('SELECT * FROM employees WHERE id = $1', [req.user.employeeId])).rows[0];

    const result = await pool.query(
      `UPDATE employees SET
         phone = COALESCE($1, phone),
         address = COALESCE($2, address)
       WHERE id = $3 RETURNING *`,
      [phone, address, req.user.employeeId]
    );

    await logAudit(req.user.id, 'update', 'employees', before.id, before, result.rows[0]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Employee 360 ----------
router.get('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);

    // Data scope: an Employee can read only their own record
    if (req.user.role === 'employee' && req.user.employeeId !== id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const result = await pool.query(`${BASE_SELECT} WHERE e.id = $1`, [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Edit details + salary (HR only) ----------
router.put('/:id', authorize('hr'), async (req, res) => {
  try {
    const b = req.body;
    const before = (await pool.query('SELECT * FROM employees WHERE id = $1', [req.params.id])).rows[0];
    if (!before) return res.status(404).json({ error: 'Not found' });

    if (b.basic_salary !== undefined && !(Number(b.basic_salary) > 0)) {
      return res.status(400).json({ error: 'basic_salary must be greater than 0' });
    }
    if (b.exit_date && !DATE_REGEX.test(b.exit_date)) {
      return res.status(400).json({ error: 'exit_date must be in YYYY-MM-DD format' });
    }

    const result = await pool.query(
      `UPDATE employees SET
         full_name = COALESCE($1, full_name),
         phone = COALESCE($2, phone),
         address = COALESCE($3, address),
         gender = COALESCE($4, gender),
         department_id = COALESCE($5, department_id),
         designation_id = COALESCE($6, designation_id),
         status = COALESCE($7, status),
         exit_date = COALESCE($8, exit_date),
         basic_salary = COALESCE($9, basic_salary)
       WHERE id = $10 RETURNING *`,
      [b.full_name, b.phone, b.address, b.gender, b.department_id, b.designation_id,
       b.status, b.exit_date, b.basic_salary, req.params.id]
    );

    await logAudit(req.user.id, 'update', 'employees', before.id, before, result.rows[0]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;