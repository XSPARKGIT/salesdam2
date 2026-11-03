import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { enforceTenant } from '../middleware/tenant.js';
import { getPrefs, updatePrefs, listConsent, createConsent } from '../controllers/communicationController.js';

const router = express.Router();
router.use(requireAuth, enforceTenant);

router.get('/preferences', getPrefs);
router.put('/preferences', updatePrefs);
router.get('/consent', listConsent);
router.post('/consent', createConsent);

export default router;
