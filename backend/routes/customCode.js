import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { enforceTenant } from '../middleware/tenant.js';
import { checkAppPermission } from '../middleware/permissions.js';
import * as cc from '../controllers/customCodeController.js';

const router = express.Router();
router.use(requireAuth, enforceTenant);
router.get('/', checkAppPermission('canManageCustomCode'), cc.list);
router.get('/:name', checkAppPermission('canManageCustomCode'), cc.get);
router.post('/', checkAppPermission('canManageCustomCode'), cc.create);
router.post('/:name/versions', checkAppPermission('canManageCustomCode'), cc.addVersion);
router.post('/:name/activate', checkAppPermission('canDeployCustomCode'), cc.activate);
router.post('/:name/restore', checkAppPermission('canDeployCustomCode'), cc.restore);
router.post('/:name/execute', checkAppPermission('canDeployCustomCode'), cc.execute);
router.delete('/:name', checkAppPermission('canManageCustomCode'), cc.remove);
export default router;
