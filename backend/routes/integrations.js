import express from 'express';
import {
  listIntegrations,
  createIntegration,
  getIntegration,
  updateIntegration,
  regenerateToken,
  deleteIntegration,
  verifyToken,
} from '../controllers/integrationController.js';
import { requireAuth } from '../middleware/auth.js';
import { enforceTenant } from '../middleware/tenant.js';
import { checkAppPermission } from '../middleware/permissions.js';

const router = express.Router();

// Public endpoint for token verification (no auth required)
router.post('/verify-token', verifyToken);

router.use(requireAuth, enforceTenant, checkAppPermission('canManageIntegrations'));

/**
 * GET /api/integrations
 * List all integrations for the tenant
 */
router.get('/', listIntegrations);

/**
 * POST /api/integrations
 * Create a new integration
 */
router.post('/', createIntegration);

/**
 * GET /api/integrations/:id
 * Get a single integration
 */
router.get('/:id', getIntegration);

/**
 * PUT /api/integrations/:id
 * Update an integration
 */
router.put('/:id', updateIntegration);

/**
 * POST /api/integrations/:id/regenerate-token
 * Regenerate the access token
 */
router.post('/:id/regenerate-token', regenerateToken);

/**
 * DELETE /api/integrations/:id
 * Delete an integration
 */
router.delete('/:id', deleteIntegration);

export default router;
