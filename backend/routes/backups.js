import express from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { enforceTenant } from '../middleware/tenant.js';
import { create, list, verify, remove, restore } from '../controllers/backupController.js';
import { asyncHandler } from '../utils/errors.js';

const router = express.Router();
router.use(requireAuth, enforceTenant, requireAdmin);

router.post('/', create);
router.get('/', list);
router.get('/:id/verify', verify);
router.delete('/:id', remove);
router.post('/:id/restore', restore);

export default router;
