import express from 'express';
import {
  listRules,
  getRule,
  createRule,
  updateRule,
  deleteRule,
  checkDuplicates,
} from '../controllers/duplicateRuleController.js';
import { requireAuth } from '../middleware/auth.js';
import { enforceTenant } from '../middleware/tenant.js';
import { checkAppPermission } from '../middleware/permissions.js';

const router = express.Router();

router.use(requireAuth, enforceTenant);

// Dry-run check (any authenticated user) — declared before '/:id'.
router.post('/check', checkDuplicates);

router.get('/', checkAppPermission('canManageObjects'), listRules);
router.post('/', checkAppPermission('canManageObjects'), createRule);
router.get('/:id', checkAppPermission('canManageObjects'), getRule);
router.put('/:id', checkAppPermission('canManageObjects'), updateRule);
router.delete('/:id', checkAppPermission('canManageObjects'), deleteRule);

export default router;
