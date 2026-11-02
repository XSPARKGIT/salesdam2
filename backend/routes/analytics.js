import express from 'express';
import {
  getOverview,
  runReport,
  recordsOverTime,
  getSalesdamHome,
  getSalesdamOrders,
  getSalesdamClients,
  getSalesdamDeals,
  getSalesdamLeads,
  getSalesdamRevenue,
  getSalesdamSales,
  getSalesdamROI,
  getRoiDashboard,
  saveSalesdamDashboardConfig,
} from '../controllers/analyticsController.js';
import { requireAuth } from '../middleware/auth.js';
import { enforceTenant } from '../middleware/tenant.js';
import { checkAppPermission } from '../middleware/permissions.js';

const router = express.Router();

router.use(requireAuth, enforceTenant);

router.get('/overview', getOverview);
router.post('/report', runReport);
router.get('/records-over-time', recordsOverTime);
router.get('/salesdam-home', getSalesdamHome);
router.get('/salesdam-orders', getSalesdamOrders);
router.get('/salesdam-clients', getSalesdamClients);
router.get('/salesdam-deals', getSalesdamDeals);
router.get('/salesdam-leads', getSalesdamLeads);
router.get('/salesdam-revenue', getSalesdamRevenue);
router.get('/salesdam-sales', getSalesdamSales);
router.get('/salesdam-roi', getSalesdamROI);
router.get('/roi-dashboard', getRoiDashboard);
router.put('/salesdam-dashboard-config', saveSalesdamDashboardConfig);

export default router;
