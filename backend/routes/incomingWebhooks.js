import express from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { enforceTenant } from '../middleware/tenant.js';
import { handleIncoming, listLogs } from '../controllers/incomingWebhookController.js';

const router = express.Router();
router.use(requireAuth, enforceTenant);
router.post('/', handleIncoming);
router.get('/logs', requireAdmin, listLogs);
export default router;