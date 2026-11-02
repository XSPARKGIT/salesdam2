import express from 'express';
import {
  listWorkspaces, myWorkspaces, getWorkspace,
  createWorkspace, updateWorkspace, deleteWorkspace,
  addMember, removeMember, updateObjectGroups, switchWorkspace, appCatalogue,
} from '../controllers/workspaceController.js';
import { checkAppPermission } from '../middleware/permissions.js';
import { requireAuth } from '../middleware/auth.js';
import { enforceTenant } from '../middleware/tenant.js';

const router = express.Router();
router.use(requireAuth, enforceTenant);

// Any authenticated user
router.get('/mine',           myWorkspaces);
router.post('/switch',        switchWorkspace);

// Apps to choose from when granting app access on a Role or Permission Set
router.get('/catalogue',      checkAppPermission('canManageRoles'), appCatalogue);

// Manage workspaces — requires Customize Application.
router.get('/',                              checkAppPermission('canCustomizeApplication'), listWorkspaces);
router.post('/',                             checkAppPermission('canCustomizeApplication'), createWorkspace);
router.get('/:id',                           checkAppPermission('canCustomizeApplication'), getWorkspace);
router.put('/:id',                           checkAppPermission('canCustomizeApplication'), updateWorkspace);
router.put('/:id/object-groups',             checkAppPermission('canCustomizeApplication'), updateObjectGroups);
router.delete('/:id',                        checkAppPermission('canCustomizeApplication'), deleteWorkspace);
router.post('/:id/members',                  checkAppPermission('canCustomizeApplication'), addMember);
router.delete('/:id/members/:userId',        checkAppPermission('canCustomizeApplication'), removeMember);

export default router;
