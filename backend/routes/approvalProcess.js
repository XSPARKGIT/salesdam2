import express from 'express';
import {
  listProcesses,
  getProcess,
  createProcess,
  updateProcess,
  deleteProcess,
  submitForApproval,
  approveRequest,
  rejectRequest,
  recallRequest,
  getRecordState,
  listMyPending,
} from '../controllers/approvalProcessController.js';
import { requireAuth } from '../middleware/auth.js';
import { enforceTenant } from '../middleware/tenant.js';
import { checkAppPermission } from '../middleware/permissions.js';

const router = express.Router();

router.use(requireAuth, enforceTenant);

// Runtime routes (any authenticated user) — declared before '/:id'.
router.post('/submit', submitForApproval);
router.get('/state', getRecordState);
router.get('/pending/mine', listMyPending);
router.post('/:id/approve', approveRequest);
router.post('/:id/reject', rejectRequest);
router.post('/:id/recall', recallRequest);

// Process configuration — requires Manage Approval Processes.
router.get('/', checkAppPermission('canManageApprovals'), listProcesses);
router.post('/', checkAppPermission('canManageApprovals'), createProcess);
router.get('/:id', checkAppPermission('canManageApprovals'), getProcess);
router.put('/:id', checkAppPermission('canManageApprovals'), updateProcess);
router.delete('/:id', checkAppPermission('canManageApprovals'), deleteProcess);

export default router;
