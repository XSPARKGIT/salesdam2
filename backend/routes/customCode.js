import express from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { enforceTenant } from '../middleware/tenant.js';
import * as cc from '../controllers/customCodeController.js';

const router = express.Router();
router.use(requireAuth, enforceTenant);
router.get('/', requireAdmin, cc.list);
router.get('/:name', requireAdmin, cc.get);
router.post('/', requireAdmin, cc.create);
router.post('/:name/versions', requireAdmin, cc.addVersion);
router.post('/:name/activate', requireAdmin, cc.activate);
router.post('/:name/execute', requireAdmin, cc.execute);
router.delete('/:name', requireAdmin, cc.remove);
export default router;