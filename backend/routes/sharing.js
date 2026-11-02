import express from 'express';
import {
  listSharingSettings,
  updateSharingSetting,
  listSharingRules,
  listSharingTargets,
  createSharingRule,
  updateSharingRule,
  deleteSharingRule,
} from '../controllers/sharingController.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { enforceTenant } from '../middleware/tenant.js';

const router = express.Router();
router.use(requireAuth, enforceTenant, requireAdmin);

router.get('/settings', listSharingSettings);
router.put('/settings/:objectApiName', updateSharingSetting);
router.get('/targets', listSharingTargets);
router.get('/rules', listSharingRules);
router.post('/rules', createSharingRule);
router.put('/rules/:id', updateSharingRule);
router.delete('/rules/:id', deleteSharingRule);

export default router;
