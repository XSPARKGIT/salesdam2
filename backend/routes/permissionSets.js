import express from 'express';
import {
  listPermissionSets,
  getPermissionSet,
  createPermissionSet,
  updatePermissionSet,
  deletePermissionSet,
} from '../controllers/permissionSetController.js';
import { requireAuth } from '../middleware/auth.js';
import { enforceTenant } from '../middleware/tenant.js';
import { checkAppPermission } from '../middleware/permissions.js';

const router = express.Router();

router.use(requireAuth, enforceTenant, checkAppPermission('canManageRoles'));

router.get('/', listPermissionSets);
router.get('/:id', getPermissionSet);
router.post('/', createPermissionSet);
router.put('/:id', updatePermissionSet);
router.delete('/:id', deletePermissionSet);

export default router;
