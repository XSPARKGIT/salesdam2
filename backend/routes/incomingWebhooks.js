import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { enforceTenant } from '../middleware/tenant.js';
import { checkAppPermission } from '../middleware/permissions.js';
import { handleIncoming, listLogs } from '../controllers/incomingWebhookController.js';

const router = express.Router();
router.use(requireAuth, enforceTenant);
router.post('/', handleIncoming);
router.get('/logs', checkAppPermission('canManageWebhooks'), listLogs);
export default router;
