import express from 'express';
import {
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  previewTemplate,
} from '../controllers/messageTemplateController.js';
import { requireAuth } from '../middleware/auth.js';
import { enforceTenant } from '../middleware/tenant.js';
import { checkAppPermission } from '../middleware/permissions.js';

const router = express.Router();

router.use(requireAuth, enforceTenant);

router.get('/', listTemplates);
router.get('/:id', getTemplate);
router.post('/:id/preview', previewTemplate);

router.post('/', checkAppPermission('canManageCommunicationTemplates'), createTemplate);
router.put('/:id', checkAppPermission('canManageCommunicationTemplates'), updateTemplate);
router.delete('/:id', checkAppPermission('canManageCommunicationTemplates'), deleteTemplate);

export default router;
