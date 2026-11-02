import express from 'express';
import { listGroups, createGroup, updateGroup, deleteGroup } from '../controllers/approverGroupController.js';
import { requireAuth } from '../middleware/auth.js';
import { enforceTenant } from '../middleware/tenant.js';
import { checkAppPermission } from '../middleware/permissions.js';

const router = express.Router();
router.use(requireAuth, enforceTenant, checkAppPermission('canManageApprovals'));

router.get('/', listGroups);
router.post('/', createGroup);
router.put('/:id', updateGroup);
router.delete('/:id', deleteGroup);

export default router;
