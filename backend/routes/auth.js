import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../db.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// Tells the frontend whether first-run setup is still needed
router.get('/setup-status', async (req, res) => {
  try {
    const result = await pool.query('SELECT 1 FROM settings WHERE id = 1');
    res.json({ setupDone: result.rowCount > 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// First-run setup: company name + Admin account (works only once)
router.post('/setup', async (req, res) => {
  try {
    const { companyName, email, password } = req.body;

    if (!companyName || !email || !password) {
      return res.status(400).json({ error: 'companyName, email and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existing = await pool.query('SELECT 1 FROM settings WHERE id = 1');
    if (existing.rowCount > 0) {
      return res.status(409).json({ error: 'Setup already completed' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    await pool.query('INSERT INTO settings (id, company_name) VALUES (1, $1)', [companyName]);
    await pool.query(
      `INSERT INTO users (email, password_hash, role)
       VALUES ($1, $2, 'admin')`,
      [email.toLowerCase(), passwordHash]
    );

    res.status(201).json({ message: 'Setup completed. You can now log in.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    const user = result.rows[0];

    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, role: user.role, employeeId: user.employee_id },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        employeeId: user.employee_id,
        mustChangePassword: user.must_change_password,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/change-password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'Valid currentPassword and newPassword (min 6 chars) required' });
    }

    const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const match = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await pool.query(
      'UPDATE users SET password_hash = $1, must_change_password = FALSE WHERE id = $2',
      [newHash, req.user.id]
    );

    res.json({ message: 'Password changed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;