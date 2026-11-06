import express from 'express';
import {
  listAccounts,
  capabilities,
  providers,
  getAccount,
  createAccount,
  updateAccount,
  deleteAccount,
  validateAccount,
  webhook,
  testWebhook,
} from '../controllers/channelController.js';
import { requireAuth } from '../middleware/auth.js';
import { enforceTenant } from '../middleware/tenant.js';
import { checkAppPermission } from '../middleware/permissions.js';

const router = express.Router();

// Public inbound webhook: verified by the channel account's signing secret,
// not by a session, so it must be reachable without authentication (§16.2).
router.post('/webhook/:channel/:accountId', webhook);

router.get('/capabilities', requireAuth, enforceTenant, capabilities);
router.get('/providers', requireAuth, enforceTenant, providers);

router.use(requireAuth, enforceTenant, checkAppPermission('canManageCommunicationTemplates'));
router.get('/', listAccounts);
router.post('/', createAccount);
router.post('/:id/validate', validateAccount);
router.post('/:id/test-webhook', testWebhook);
router.get('/:id', getAccount);
router.put('/:id', updateAccount);
router.delete('/:id', deleteAccount);

export default router;
