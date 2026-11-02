import express from 'express';
import {
  listViews,
  createView,
  updateView,
  deleteView,
} from '../controllers/listViewController.js';
import { requireAuth } from '../middleware/auth.js';
import { enforceTenant } from '../middleware/tenant.js';
import { requireReachableObject } from '../services/objectAccessService.js';
import { checkObjectPermission } from '../middleware/permissions.js';

const router = express.Router();

router.use(requireAuth, enforceTenant);

// Workspace isolation: only objects reachable from the active workspace.
router.param('objectApiName', requireReachableObject);

// Viewing and managing views only requires read access to the object — a view is
// a saved query over records the user can already see.
router.get('/:objectApiName', checkObjectPermission('read'), listViews);
router.post('/:objectApiName', checkObjectPermission('read'), createView);
router.put('/:objectApiName/:id', checkObjectPermission('read'), updateView);
router.delete('/:objectApiName/:id', checkObjectPermission('read'), deleteView);

export default router;
