import express from 'express';
import {
  listWorkspaces, myWorkspaces, getWorkspace,
  createWorkspace, updateWorkspace, deleteWorkspace,
  addMember, removeMember, updateObjectGroups, switchWorkspace, appCatalogue,
} from '../controllers/workspaceController.js';
import { checkAppPermission } from '../middleware/permissions.js';
import { requireAuth } from '../middleware/auth.js';
import { enforceTenant } from '../middleware/tenant.js';
import { requireAdmin } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth, enforceTenant);

// Any authenticated user
router.get('/mine',           myWorkspaces);
router.post('/switch',        switchWorkspace);   // set active workspace in session

// Apps to choose from when granting app access on a Role or Permission Set
router.get('/catalogue',      checkAppPermission('canManageRoles'), appCatalogue);

// Admin — manage workspaces within their tenant
router.get('/',                              requireAdmin, listWorkspaces);
router.post('/',                             requireAdmin, createWorkspace);
router.get('/:id',                           requireAdmin, getWorkspace);
router.put('/:id',                           requireAdmin, updateWorkspace);
router.put('/:id/object-groups',             requireAdmin, updateObjectGroups);
router.delete('/:id',                        requireAdmin, deleteWorkspace);
router.post('/:id/members',                  requireAdmin, addMember);
router.delete('/:id/members/:userId',        requireAdmin, removeMember);

export default router;
