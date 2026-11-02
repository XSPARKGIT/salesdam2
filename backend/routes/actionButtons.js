import express from 'express';
import {
  getActionButtons,
  createActionButton,
  updateActionButton,
  deleteActionButton,
  reorderActionButtons,
  runActionButton,
} from '../controllers/actionButtonController.js';

import { requireAuth } from '../middleware/auth.js';
import { enforceTenant } from '../middleware/tenant.js';
import { requireObjectMetadataAccess } from '../services/objectAccessService.js';
import { checkAppPermission, checkObjectPermission } from '../middleware/permissions.js';

const router = express.Router();

/**
 * All routes require auth + tenant
 */
router.use(requireAuth, enforceTenant);

// Workspace isolation: only objects reachable from the active workspace.
router.param('objectApiName', requireObjectMetadataAccess);

/* =========================
   ACTION BUTTONS
   Base: /api/action-buttons
========================= */

/**
 * GET /api/action-buttons/:objectApiName
 */
router.get(
  '/:objectApiName',
  checkAppPermission('canManageObjects'),
  getActionButtons,
);

/**
 * POST /api/action-buttons/:objectApiName
 */
router.post(
  '/:objectApiName',
  checkAppPermission('canManageObjects'),
  createActionButton,
);

/**
 * PUT /api/action-buttons/:objectApiName/:actionId
 */
router.put(
  '/:objectApiName/:actionId',
  checkAppPermission('canManageObjects'),
  updateActionButton,
);

/**
 * DELETE /api/action-buttons/:objectApiName/:actionId
 */
router.delete(
  '/:objectApiName/:actionId',
  checkAppPermission('canManageObjects'),
  deleteActionButton,
);

/**
 * POST /api/action-buttons/:objectApiName/:actionId/run
 * Any user who can edit the object's records; the action re-checks the
 * button's conditions and the user's access to the record.
 */
router.post(
  '/:objectApiName/:actionId/run',
  checkObjectPermission('update'),
  runActionButton,
);

/**
 * POST /api/action-buttons/:objectApiName/reorder
 */
router.post(
  '/:objectApiName/reorder',
  checkAppPermission('canManageObjects'),
  reorderActionButtons,
);

export default router;
