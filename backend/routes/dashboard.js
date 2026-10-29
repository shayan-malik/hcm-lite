import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import {
  resolveFilters,
  getHrDashboard,
  getAdminDashboard,
  getEmployeeDashboard,
} from '../utils/analytics.js';
import { getAttritionRisk } from '../utils/risk.js';

const router = Router();
router.use(authenticate);

const fail = (res, err) => res.status(err.status || 500).json({ error: err.message });

// Filters: ?from=YYYY-MM-DD&to=YYYY-MM-DD&department_id=
router.get('/hr', authorize('admin', 'hr'), async (req, res) => {
  try {
    res.json(await getHrDashboard(await resolveFilters(req.query)));
  } catch (err) {
    fail(res, err);
  }
});

router.get('/admin', authorize('admin'), async (req, res) => {
  try {
    res.json(await getAdminDashboard(await resolveFilters(req.query)));
  } catch (err) {
    fail(res, err);
  }
});

router.get('/employee', authorize('employee'), async (req, res) => {
  try {
    res.json(await getEmployeeDashboard(req.user.employeeId));
  } catch (err) {
    fail(res, err);
  }
});


router.get('/risk', authorize('admin', 'hr'), async (req, res) => {
  try {
    const departmentId = req.query.department_id ? Number(req.query.department_id) : null;
    res.json(await getAttritionRisk(departmentId));
  } catch (err) {
    fail(res, err);
  }
});

export default router;