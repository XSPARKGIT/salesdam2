import express from 'express';
import { getConfig, updateConfig } from '../controllers/objectConfigController.js';
import { requireAuth } from '../middleware/auth.js';
import { enforceTenant } from '../middleware/tenant.js';
import { requireObjectMetadataAccess } from '../services/objectAccessService.js';
import { checkAppPermission } from '../middleware/permissions.js';

const router = express.Router();

router.use(requireAuth, enforceTenant);

router.param('objectApiName', requireObjectMetadataAccess);

router.get('/:objectApiName',  getConfig);
router.put('/:objectApiName',  checkAppPermission('canManageObjects'), updateConfig);

export default router;
