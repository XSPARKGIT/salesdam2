import express from 'express';
import {
  listActivities,
  getTimeline,
  getActivity,
  createActivity,
  logActivity,
  updateActivity,
  deleteActivity,
  getActivityTypes,
  getActivityReport,
} from '../controllers/activityController.js';
import { requireAuth } from '../middleware/auth.js';
import { enforceTenant } from '../middleware/tenant.js';

const router = express.Router();

router.use(requireAuth, enforceTenant);

// Literal routes before '/:id'.
router.get('/types', getActivityTypes);
router.get('/timeline', getTimeline);
router.get('/report', getActivityReport);
router.post('/log', logActivity);

router.get('/', listActivities);
router.post('/', createActivity);
router.get('/:id', getActivity);
router.put('/:id', updateActivity);
router.delete('/:id', deleteActivity);

export default router;
