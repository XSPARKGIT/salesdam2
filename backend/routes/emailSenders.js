import express from 'express';
import {
  listEmailSenders, myEmailSenders,
  createEmailSender, updateEmailSender,
  deleteEmailSender, testEmailSender,
} from '../controllers/emailSenderController.js';
import { requireAuth } from '../middleware/auth.js';
import { enforceTenant } from '../middleware/tenant.js';
import { checkAppPermission } from '../middleware/permissions.js';

const router = express.Router();

router.use(requireAuth, enforceTenant);

router.get('/mine', myEmailSenders);

router.get('/',         checkAppPermission('canManageCommunicationTemplates'), listEmailSenders);
router.post('/',        checkAppPermission('canManageCommunicationTemplates'), createEmailSender);
router.put('/:id',      checkAppPermission('canManageCommunicationTemplates'), updateEmailSender);
router.delete('/:id',   checkAppPermission('canManageCommunicationTemplates'), deleteEmailSender);
router.post('/:id/test', checkAppPermission('canManageCommunicationTemplates'), testEmailSender);

export default router;
