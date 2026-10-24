import { Router } from 'express';
import pool from '../db.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { logAudit } from '../utils/audit.js';

const router = Router();
router.use(authenticate);

// ---------- Announcements ----------
router.get('/announcements', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT a.id, a.title, a.body, a.created_at, u.email AS posted_by
       FROM announcements a LEFT JOIN users u ON u.id = a.posted_by
       ORDER BY a.id DESC LIMIT 50`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/announcements', authorize('admin', 'hr'), async (req, res) => {
  try {
    const { title, body } = req.body;
    if (!title || !body) return res.status(400).json({ error: 'title and body are required' });

    const result = await pool.query(
      'INSERT INTO announcements (title, body, posted_by) VALUES ($1, $2, $3) RETURNING *',
      [title, body, req.user.id]
    );
    await logAudit(req.user.id, 'create', 'announcements', result.rows[0].id, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Notifications (own only) ----------
router.get('/notifications', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM notifications WHERE user_id = $1 ORDER BY id DESC LIMIT 50',
      [req.user.id]
    );
    res.json({
      unread: result.rows.filter((n) => !n.is_read).length,
      data: result.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/notifications/read-all', async (req, res) => {
  try {
    await pool.query('UPDATE notifications SET is_read = TRUE WHERE user_id = $1', [req.user.id]);
    res.json({ message: 'All notifications marked as read' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/notifications/:id/read', async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2 RETURNING *',
      [req.params.id, req.user.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Audit log (Admin only, read-only) ----------
router.get('/audit', authorize('admin'), async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);

    const values = [];
    const conditions = [];
    if (req.query.entity) {
      values.push(req.query.entity);
      conditions.push(`a.entity = $${values.length}`);
    }
    if (req.query.action) {
      values.push(req.query.action);
      conditions.push(`a.action = $${values.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const total = await pool.query(`SELECT COUNT(*) FROM audit_logs a ${where}`, values);

    values.push(limit, (page - 1) * limit);
    const rows = await pool.query(
      `SELECT a.*, u.email AS actor
       FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
       ${where} ORDER BY a.id DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );

    res.json({ data: rows.rows, page, limit, total: Number(total.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;