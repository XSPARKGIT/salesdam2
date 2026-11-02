import express from 'express';
import { getConfig, updateConfig } from '../controllers/objectConfigController.js';
import { requireAuth } from '../middleware/auth.js';
import { enforceTenant } from '../middleware/tenant.js';
import { requireObjectMetadataAccess } from '../services/objectAccessService.js';
import { requireAdmin } from '../middleware/auth.js';

const router = express.Router();

router.use(requireAuth, enforceTenant);

// Workspace isolation: only objects reachable from the active workspace.
router.param('objectApiName', requireObjectMetadataAccess);

router.get('/:objectApiName',  getConfig);
router.put('/:objectApiName',  requireAdmin, updateConfig);

export default router;
