import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { enforceTenant } from '../middleware/tenant.js';
import { checkAppPermission } from '../middleware/permissions.js';
import {
  listGlobalValueSets,
  getGlobalValueSet,
  createGlobalValueSet,
  updateGlobalValueSet,
  deleteGlobalValueSet,
  linkField,
  unlinkField,
} from '../controllers/globalValueSetController.js';

const router = express.Router();

router.use(requireAuth, enforceTenant);

router.get('/', listGlobalValueSets);
router.get('/:id', getGlobalValueSet);

router.post('/', checkAppPermission('canManageObjects'), createGlobalValueSet);
router.put('/:id', checkAppPermission('canManageObjects'), updateGlobalValueSet);
router.delete('/:id', checkAppPermission('canManageObjects'), deleteGlobalValueSet);

router.post('/:id/link', checkAppPermission('canManageObjects'), linkField);
router.post('/:id/unlink', checkAppPermission('canManageObjects'), unlinkField);

export default router;
