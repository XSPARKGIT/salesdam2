import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { enforceTenant } from '../middleware/tenant.js';
import { requireAdmin } from '../middleware/auth.js';
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

// Write operations are admin-only — value set changes propagate to all linked
// fields tenant-wide, so a regular user must not be able to alter them.
router.post('/', requireAdmin, createGlobalValueSet);
router.put('/:id', requireAdmin, updateGlobalValueSet);
router.delete('/:id', requireAdmin, deleteGlobalValueSet);

router.post('/:id/link', requireAdmin, linkField);
router.post('/:id/unlink', requireAdmin, unlinkField);

export default router;
