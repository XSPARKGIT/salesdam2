import express from 'express';
import {
  getEffectiveConfig,
  updateTenantConfig,
  resetTenantConfig,
  getSystemDefaults,
  setSystemDefault,
  resetSystemDefault,
} from '../controllers/configurationController.js';
import {
  requireAuth,
  requireSuperuser,
} from '../middleware/auth.js';
import { enforceTenant } from '../middleware/tenant.js';
import { checkAppPermission } from '../middleware/permissions.js';

const router = express.Router();

router.use(requireAuth, enforceTenant);

// Platform-wide defaults (operator level) — superuser only.
router.get('/defaults', requireSuperuser, getSystemDefaults);
router.put('/defaults/:key', requireSuperuser, setSystemDefault);
router.delete('/defaults/:key', requireSuperuser, resetSystemDefault);

// Tenant-level view and overrides.
router.get('/', getEffectiveConfig);
router.put('/:key', checkAppPermission('canManageTenantSettings'), updateTenantConfig);
router.delete('/:key', checkAppPermission('canManageTenantSettings'), resetTenantConfig);

export default router;
