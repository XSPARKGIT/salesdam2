import express from 'express';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import {
  getEffectiveConfig,
  updateTenantConfig,
  resetTenantConfig,
  getSystemDefaults,
  setSystemDefault,
  resetSystemDefault,
  getPublicBranding,
} from '../controllers/configurationController.js';
import {
  requireAuth,
  requireSuperuser,
} from '../middleware/auth.js';
import { enforceTenant } from '../middleware/tenant.js';
import { checkAppPermission } from '../middleware/permissions.js';

const router = express.Router();

// Public (pre-login) branding for the login page: whitelisted branding keys only.
const publicBrandingLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' },
});
// Public, read-only, branding values only: open to any origin, never with credentials.
router.get('/public-branding', cors({ origin: '*', credentials: false, methods: ['GET'] }), publicBrandingLimiter, getPublicBranding);

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
