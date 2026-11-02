import express from 'express';
import {
  getConsent,
  updateConsent,
  checkConsent,
  listConsents,
} from '../controllers/consentController.js';
import { requireAuth } from '../middleware/auth.js';
import { enforceTenant } from '../middleware/tenant.js';
import { checkAppPermission } from '../middleware/permissions.js';

const router = express.Router();

router.use(requireAuth, enforceTenant);

router.post('/check', checkConsent);
router.get('/', checkAppPermission('canCustomizeApplication'), listConsents);

router.get('/:subjectType/:subjectId', getConsent);
router.put('/:subjectType/:subjectId', updateConsent);

export default router;
