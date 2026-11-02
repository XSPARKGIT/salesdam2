import express from 'express';
import {
  getMyStatus,
  setMyStatus,
  listStatuses,
  getDispositions,
  wrapUp,
  callHistory,
  listProviders,
  dial,
} from '../controllers/telephonyController.js';
import { requireAuth } from '../middleware/auth.js';
import { enforceTenant } from '../middleware/tenant.js';
import { checkAppPermission } from '../middleware/permissions.js';

const router = express.Router();

router.use(requireAuth, enforceTenant);

router.get('/status/me', getMyStatus);
router.put('/status/me', setMyStatus);
router.get('/status', checkAppPermission('canManageUsers'), listStatuses);

router.get('/dispositions', getDispositions);
router.get('/providers', listProviders);
router.post('/calls', dial);
router.get('/calls', callHistory);
router.post('/calls/:activityId/wrap-up', wrapUp);

export default router;
