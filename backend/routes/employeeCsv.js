import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import pool from '../db.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { logAudit } from '../utils/audit.js';

const router = Router();

const HEADERS = ['code', 'full_name', 'email', 'phone', 'gender', 'department', 'designation', 'join_date', 'basic_salary'];
const MAX_ROWS = 200;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        cell += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      rows.push(row);
      row = [];
    } else {
      cell += c;
    }
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
};

const isRealDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
};

// Neutralizes spreadsheet formulas and quotes values that need it
const csvCell = (value) => {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// ---------- Export ----------
router.get('/export', authenticate, authorize('hr'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT e.code, e.full_name, e.email, e.phone, e.gender,
              d.name AS department, g.name AS designation,
              e.join_date::text AS join_date, e.basic_salary
       FROM employees e
       LEFT JOIN departments d ON d.id = e.department_id
       LEFT JOIN designations g ON g.id = e.designation_id
       ORDER BY e.id`
    );

    const lines = [HEADERS.join(',')];
    for (const r of result.rows) {
      lines.push(HEADERS.map((h) => csvCell(r[h])).join(','));
    }

    await logAudit(req.user.id, 'export', 'employees', null, null, { rows: result.rowCount });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="employees.csv"');
    res.send(lines.join('\n'));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Import: POST /import?dryRun=true, body { csv: "..." } ----------
router.post('/import', authenticate, authorize('hr'), async (req, res) => {
  const dryRun = req.query.dryRun === 'true';
  const client = await pool.connect();

  try {
    const text = String(req.body.csv || '');
    if (!text.trim()) return res.status(400).json({ error: 'csv text is required' });

    const table = parseCsv(text);
    const header = (table[0] || []).map((h) => h.trim().toLowerCase());
    const missing = HEADERS.filter((h) => !header.includes(h));
    if (missing.length) {
      return res.status(400).json({ error: `Missing columns: ${missing.join(', ')}` });
    }

    const dataRows = table.slice(1);
    if (dataRows.length === 0) return res.status(400).json({ error: 'No data rows found' });
    if (dataRows.length > MAX_ROWS) {
      return res.status(400).json({ error: `Maximum ${MAX_ROWS} rows per import` });
    }

    // Lookups
    const departments = new Map((await pool.query('SELECT id, name FROM departments')).rows.map((d) => [d.name.toLowerCase(), d.id]));
    const designations = new Map((await pool.query('SELECT id, name FROM designations')).rows.map((d) => [d.name.toLowerCase(), d.id]));
    const takenCodes = new Set((await pool.query('SELECT code FROM employees')).rows.map((r) => r.code.toLowerCase()));
    const takenEmails = new Set([
      ...(await pool.query('SELECT email FROM employees')).rows.map((r) => r.email.toLowerCase()),
      ...(await pool.query('SELECT email FROM users')).rows.map((r) => r.email.toLowerCase()),
    ]);

    const errors = [];
    const valid = [];
    const seenCodes = new Set();
    const seenEmails = new Set();

    dataRows.forEach((cells, index) => {
      const rowNumber = index + 2; // row 1 is the header
      const r = {};
      header.forEach((h, i) => {
        r[h] = (cells[i] || '').trim();
      });
      const fail = (field, reason) => errors.push({ row: rowNumber, field, reason });
      const before = errors.length;

      if (!r.code) fail('code', 'Required');
      else if (takenCodes.has(r.code.toLowerCase()) || seenCodes.has(r.code.toLowerCase())) fail('code', 'Code already exists');

      if (!r.full_name) fail('full_name', 'Required');

      if (!r.email) fail('email', 'Required');
      else if (!EMAIL_REGEX.test(r.email)) fail('email', 'Invalid email');
      else if (takenEmails.has(r.email.toLowerCase()) || seenEmails.has(r.email.toLowerCase())) fail('email', 'Email already exists');

      if (!r.department) fail('department', 'Required');
      else if (!departments.has(r.department.toLowerCase())) fail('department', `Unknown department "${r.department}"`);

      if (r.designation && !designations.has(r.designation.toLowerCase())) {
        fail('designation', `Unknown designation "${r.designation}"`);
      }

      if (!r.join_date) fail('join_date', 'Required');
      else if (!isRealDate(r.join_date)) fail('join_date', 'Must be a valid date in YYYY-MM-DD format');

      if (!r.basic_salary) fail('basic_salary', 'Required');
      else if (!(Number(r.basic_salary) > 0)) fail('basic_salary', 'Must be a number greater than 0');

      seenCodes.add(r.code.toLowerCase());
      seenEmails.add(r.email.toLowerCase());

      if (errors.length === before) {
        valid.push({
          ...r,
          department_id: departments.get(r.department.toLowerCase()),
          designation_id: r.designation ? designations.get(r.designation.toLowerCase()) : null,
        });
      }
    });

    if (dryRun) {
      return res.json({ dryRun: true, total: dataRows.length, valid: valid.length, errors });
    }
    if (errors.length) {
      return res.status(422).json({ error: 'Fix the errors first (run a dry run to see them)', errors });
    }

    // Real import: all rows or none
    const credentials = [];
    await client.query('BEGIN');
    for (const r of valid) {
      const emp = await client.query(
        `INSERT INTO employees
           (code, full_name, email, phone, gender, department_id, designation_id, join_date, basic_salary)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [r.code, r.full_name, r.email.toLowerCase(), r.phone || null, r.gender || null,
         r.department_id, r.designation_id, r.join_date, r.basic_salary]
      );

      const tempPassword = crypto.randomBytes(4).toString('hex');
      await client.query(
        `INSERT INTO users (email, password_hash, role, employee_id, must_change_password)
         VALUES ($1, $2, 'employee', $3, TRUE)`,
        [r.email.toLowerCase(), await bcrypt.hash(tempPassword, 10), emp.rows[0].id]
      );
      credentials.push({ code: r.code, email: r.email.toLowerCase(), tempPassword });
    }
    await client.query('COMMIT');

    await logAudit(req.user.id, 'import', 'employees', null, null, { rows: valid.length });
    res.status(201).json({ imported: valid.length, credentials });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: 'Duplicate code or email' });
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

export default router;