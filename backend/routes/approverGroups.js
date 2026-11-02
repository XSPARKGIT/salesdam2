import express from 'express';
import { listGroups, createGroup, updateGroup, deleteGroup } from '../controllers/approverGroupController.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { enforceTenant } from '../middleware/tenant.js';

const router = express.Router();
router.use(requireAuth, enforceTenant, requireAdmin);

router.get('/', listGroups);
router.post('/', createGroup);
router.put('/:id', updateGroup);
router.delete('/:id', deleteGroup);

export default router;
