import { Router } from 'express';
import PDFDocument from 'pdfkit';
import pool from '../db.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { logAudit } from '../utils/audit.js';
import { buildPayroll } from '../utils/payroll.js';

const router = Router();
router.use(authenticate);

const MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

// ---------- Create or regenerate a draft (HR only) ----------
router.post('/runs', authorize('hr'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { month } = req.body;
    if (!month || !MONTH_REGEX.test(month)) {
      return res.status(400).json({ error: 'month is required in YYYY-MM format' });
    }

    const existing = (await pool.query('SELECT * FROM payroll_runs WHERE month = $1', [month])).rows[0];
    if (existing && existing.status === 'finalized') {
      return res.status(409).json({ error: 'This month is finalized and locked' });
    }

    // Calculate first, then save everything in one transaction
    const slips = await buildPayroll(month);
    if (slips.length === 0) {
      return res.status(422).json({ error: 'No employees found for this month' });
    }

    await client.query('BEGIN');

    let run = existing;
    if (run) {
      await client.query('DELETE FROM payslips WHERE run_id = $1', [run.id]);
    } else {
      run = (
        await client.query(
          'INSERT INTO payroll_runs (month, created_by) VALUES ($1, $2) RETURNING *',
          [month, req.user.id]
        )
      ).rows[0];
    }

    for (const s of slips) {
      await client.query(
        `INSERT INTO payslips (run_id, employee_id, gross, deductions, tax, net, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [run.id, s.employee_id, s.gross, s.deductions, s.tax, s.net, s.details]
      );
    }

    await client.query('COMMIT');

    await logAudit(req.user.id, existing ? 'regenerate' : 'create', 'payroll_runs', run.id, existing || null, run);
    res.status(existing ? 200 : 201).json({ run, payslips: slips.length });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ---------- List runs (Admin + HR) ----------
router.get('/runs', authorize('admin', 'hr'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.*, COUNT(p.id)::int AS payslips,
              COALESCE(SUM(p.gross), 0) AS total_gross,
              COALESCE(SUM(p.net), 0) AS total_net
       FROM payroll_runs r
       LEFT JOIN payslips p ON p.run_id = r.id
       GROUP BY r.id ORDER BY r.month DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- One run with all payslips (Admin + HR) ----------
router.get('/runs/:id', authorize('admin', 'hr'), async (req, res) => {
  try {
    const run = (await pool.query('SELECT * FROM payroll_runs WHERE id = $1', [req.params.id])).rows[0];
    if (!run) return res.status(404).json({ error: 'Not found' });

    const payslips = await pool.query(
      `SELECT p.*, e.full_name, e.code, d.name AS department
       FROM payslips p
       JOIN employees e ON e.id = p.employee_id
       LEFT JOIN departments d ON d.id = e.department_id
       WHERE p.run_id = $1 ORDER BY e.full_name`,
      [run.id]
    );
    res.json({ run, payslips: payslips.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Finalize (Admin only, locks the month) ----------
router.post('/runs/:id/finalize', authorize('admin'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const found = await client.query('SELECT * FROM payroll_runs WHERE id = $1 FOR UPDATE', [req.params.id]);
    const run = found.rows[0];

    if (!run) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }
    if (run.status === 'finalized') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Already finalized' });
    }

    const updated = await client.query(
      `UPDATE payroll_runs SET status = 'finalized', finalized_by = $1
       WHERE id = $2 RETURNING *`,
      [req.user.id, run.id]
    );

    await client.query(
      `INSERT INTO notifications (user_id, message)
       SELECT u.id, $1
       FROM payslips p JOIN users u ON u.employee_id = p.employee_id
       WHERE p.run_id = $2`,
      [`Your payslip for ${run.month} is ready`, run.id]
    );

    await client.query('COMMIT');

    await logAudit(req.user.id, 'finalize', 'payroll_runs', run.id, run, updated.rows[0]);
    res.json(updated.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ---------- Own payslips (finalized only) ----------
router.get('/payslips/my', authorize('employee'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, r.month
       FROM payslips p JOIN payroll_runs r ON r.id = p.run_id
       WHERE p.employee_id = $1 AND r.status = 'finalized'
       ORDER BY r.month DESC`,
      [req.user.employeeId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Payslip PDF ----------
router.get('/payslips/:id/pdf', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, r.month, r.status AS run_status,
              e.full_name, e.code, e.email,
              d.name AS department, g.name AS designation, s.company_name
       FROM payslips p
       JOIN payroll_runs r ON r.id = p.run_id
       JOIN employees e ON e.id = p.employee_id
       LEFT JOIN departments d ON d.id = e.department_id
       LEFT JOIN designations g ON g.id = e.designation_id
       CROSS JOIN settings s
       WHERE p.id = $1 AND s.id = 1`,
      [req.params.id]
    );
    const slip = result.rows[0];
    if (!slip) return res.status(404).json({ error: 'Not found' });

    // Data scope: an Employee can open only their own finalized payslip
    if (req.user.role === 'employee') {
      if (slip.employee_id !== req.user.employeeId || slip.run_status !== 'finalized') {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    const d = slip.details;
    const money = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="payslip-${slip.code}-${slip.month}.pdf"`);

    const doc = new PDFDocument({ margin: 50 });
    doc.pipe(res);

    doc.fontSize(20).text(slip.company_name || 'Company', { align: 'center' });
    doc.fontSize(14).text(`Payslip - ${slip.month}`, { align: 'center' });
    if (slip.run_status !== 'finalized') {
      doc.fontSize(10).fillColor('red').text('DRAFT - not finalized', { align: 'center' }).fillColor('black');
    }
    doc.moveDown();

    doc.fontSize(11);
    doc.text(`Employee: ${slip.full_name} (${slip.code})`);
    doc.text(`Email: ${slip.email}`);
    doc.text(`Department: ${slip.department || '-'}`);
    doc.text(`Designation: ${slip.designation || '-'}`);
    doc.moveDown();

    doc.fontSize(13).text('Earnings');
    doc.fontSize(11);
    doc.text(`Basic: ${money(d.basic)}`);
    doc.text(`HRA (40%): ${money(d.hra)}`);
    doc.text(`Medical (10%): ${money(d.medical)}`);
    doc.text(`Gross: ${money(slip.gross)}`);
    doc.moveDown();

    doc.fontSize(13).text('Deductions');
    doc.fontSize(11);
    doc.text(`Working days in month: ${d.workingDays} (per day: ${money(d.perDay)})`);
    doc.text(`Absent days: ${d.absentDays} (-${money(d.absentDeduction)})`);
    doc.text(`Unpaid leave days: ${d.unpaidDays} (-${money(d.unpaidDeduction)})`);
    doc.text(`Half days: ${d.halfDays} (-${money(d.halfDayDeduction)})`);
    doc.text(`Joining/leaving proration: -${money(d.prorationDeduction)}`);
    doc.text(`Total deductions: ${money(slip.deductions)}`);
    doc.text(`Income tax: ${money(slip.tax)}`);
    doc.moveDown();

    doc.fontSize(15).text(`Net pay: ${money(slip.net)}`);
    doc.end();
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

export default router;