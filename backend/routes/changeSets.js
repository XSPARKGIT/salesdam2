import express from 'express';
import {
  createChangeSet,
  listChangeSets,
  getChangeSet,
  validateChangeSet,
  deployChangeSet,
  deploymentLog,
  rollbackDeployment,
  cloneSandbox,
} from '../controllers/changeSetController.js';
import {
  requireAuth,
  requireSuperuser,
} from '../middleware/auth.js';
import { enforceTenant } from '../middleware/tenant.js';
import { checkAppPermission } from '../middleware/permissions.js';

const router = express.Router();

router.use(requireAuth, enforceTenant);

// Cross-tenant operations (validate/deploy/log/rollback/sandbox) are
// operator-level: they read or write another tenant's metadata, so only
// superusers may use them.
router.get('/deployment-log', requireSuperuser, deploymentLog);
router.post(
  '/deployment-log/:logId/rollback',
  requireSuperuser,
  rollbackDeployment,
);
router.post('/sandbox', requireSuperuser, cloneSandbox);
router.post('/:id/validate', requireSuperuser, validateChangeSet);
router.post('/:id/deploy', requireSuperuser, deployChangeSet);

// Packaging stays within the caller's own tenant.
router.get('/', checkAppPermission('canCustomizeApplication'), listChangeSets);
router.post('/', checkAppPermission('canCustomizeApplication'), createChangeSet);
router.get('/:id', checkAppPermission('canCustomizeApplication'), getChangeSet);

export default router;
