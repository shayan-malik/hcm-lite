import { Router } from 'express';
import bcrypt from 'bcryptjs';
import pool from '../db.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { logAudit } from '../utils/audit.js';

const router = Router();
router.use(authenticate, authorize('admin'));

router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email, role, employee_id, is_active FROM users ORDER BY id'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create an HR login with a temporary password
router.post('/hr', async (req, res) => {
  try {
    const { email, tempPassword } = req.body;
    if (!email || !tempPassword || tempPassword.length < 6) {
      return res.status(400).json({ error: 'email and tempPassword (min 6 chars) are required' });
    }

    const hash = await bcrypt.hash(tempPassword, 10);
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, role, must_change_password)
       VALUES ($1, $2, 'hr', TRUE) RETURNING id, email, role`,
      [email.toLowerCase(), hash]
    );

    await logAudit(req.user.id, 'create', 'users', result.rows[0].id, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already exists' });
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id/active', async (req, res) => {
  try {
    const { isActive } = req.body;
    if (Number(req.params.id) === req.user.id) {
      return res.status(400).json({ error: 'You cannot change your own status' });
    }

    const result = await pool.query(
      'UPDATE users SET is_active = $1 WHERE id = $2 RETURNING id, email, role, is_active',
      [Boolean(isActive), req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });

    await logAudit(req.user.id, isActive ? 'activate' : 'deactivate', 'users', result.rows[0].id, null, result.rows[0]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/reset-password', async (req, res) => {
  try {
    const { tempPassword } = req.body;
    if (!tempPassword || tempPassword.length < 6) {
      return res.status(400).json({ error: 'tempPassword (min 6 chars) is required' });
    }

    const hash = await bcrypt.hash(tempPassword, 10);
    const result = await pool.query(
      `UPDATE users SET password_hash = $1, must_change_password = TRUE
       WHERE id = $2 RETURNING id, email`,
      [hash, req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });

    await logAudit(req.user.id, 'reset_password', 'users', result.rows[0].id);
    res.json({ message: 'Password reset. User must change it on next login.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;