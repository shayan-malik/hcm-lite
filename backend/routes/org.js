import { Router } from 'express';
import pool from '../db.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { logAudit } from '../utils/audit.js';

const router = Router();
router.use(authenticate);

// ---------- Settings ----------
router.get('/settings', authorize('admin', 'hr'), async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM settings WHERE id = 1');
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/settings', authorize('admin'), async (req, res) => {
  try {
    const b = req.body;
    const before = (await pool.query('SELECT * FROM settings WHERE id = 1')).rows[0];

    const result = await pool.query(
      `UPDATE settings SET
         company_name = COALESCE($1, company_name),
         office_start = COALESCE($2, office_start),
         grace_minutes = COALESCE($3, grace_minutes),
         half_day_hours = COALESCE($4, half_day_hours),
         weekend_days = COALESCE($5, weekend_days),
         office_lat = COALESCE($6, office_lat),
         office_lng = COALESCE($7, office_lng),
         radius_m = COALESCE($8, radius_m)
       WHERE id = 1 RETURNING *`,
      [b.company_name, b.office_start, b.grace_minutes, b.half_day_hours,
       b.weekend_days, b.office_lat, b.office_lng, b.radius_m]
    );

    await logAudit(req.user.id, 'update', 'settings', 1, before, result.rows[0]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Departments & Designations (same logic, so one helper) ----------
const addNameRoutes = (path, table) => {
  router.get(path, async (req, res) => {
    try {
      const result = await pool.query(`SELECT * FROM ${table} ORDER BY name`);
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post(path, authorize('admin'), async (req, res) => {
    try {
      const { name } = req.body;
      if (!name) return res.status(400).json({ error: 'name is required' });

      const result = await pool.query(
        `INSERT INTO ${table} (name) VALUES ($1) RETURNING *`,
        [name.trim()]
      );
      await logAudit(req.user.id, 'create', table, result.rows[0].id, null, result.rows[0]);
      res.status(201).json(result.rows[0]);
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'Already exists' });
      res.status(500).json({ error: err.message });
    }
  });
};

addNameRoutes('/departments', 'departments');
addNameRoutes('/designations', 'designations');

// ---------- Leave types ----------
router.get('/leave-types', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM leave_types ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/leave-types', authorize('admin'), async (req, res) => {
  try {
    const { name, yearly_quota, is_paid } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    const result = await pool.query(
      `INSERT INTO leave_types (name, yearly_quota, is_paid)
       VALUES ($1, $2, COALESCE($3, TRUE)) RETURNING *`,
      [name.trim().toLowerCase(), yearly_quota ?? null, is_paid]
    );
    await logAudit(req.user.id, 'create', 'leave_types', result.rows[0].id, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Already exists' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/leave-types/:id', authorize('admin'), async (req, res) => {
  try {
    const { yearly_quota } = req.body;
    const before = (await pool.query('SELECT * FROM leave_types WHERE id = $1', [req.params.id])).rows[0];
    if (!before) return res.status(404).json({ error: 'Not found' });

    const result = await pool.query(
      'UPDATE leave_types SET yearly_quota = $1 WHERE id = $2 RETURNING *',
      [yearly_quota, req.params.id]
    );
    await logAudit(req.user.id, 'update', 'leave_types', before.id, before, result.rows[0]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Holidays ----------
router.get('/holidays', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM holidays ORDER BY date');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/holidays', authorize('admin'), async (req, res) => {
  try {
    const { date, name } = req.body;
    if (!date || !name) return res.status(400).json({ error: 'date and name are required' });

    const result = await pool.query(
      'INSERT INTO holidays (date, name) VALUES ($1, $2) RETURNING *',
      [date, name]
    );
    await logAudit(req.user.id, 'create', 'holidays', result.rows[0].id, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Holiday already exists on this date' });
    res.status(500).json({ error: err.message });
  }
});

router.delete('/holidays/:id', authorize('admin'), async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM holidays WHERE id = $1 RETURNING *', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });

    await logAudit(req.user.id, 'delete', 'holidays', result.rows[0].id, result.rows[0], null);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;