import express from 'express';
import {
  getPublicPlans,
  verifyTransaction,
  getAdminPlans,
  getPaymentDetails,
  getInvoices,
  getUpdatePaymentUrl,
} from '../controllers/billingController.js';
import { requireAuth } from '../middleware/auth.js';
import { enforceTenant } from '../middleware/tenant.js';
import { checkAppPermission } from '../middleware/permissions.js';

const router = express.Router();

router.get('/public-plans', getPublicPlans);
router.post('/verify-transaction', verifyTransaction);

router.use(requireAuth, enforceTenant);

router.get('/admin/plans', checkAppPermission('canManageTenantSettings'), getAdminPlans);
router.get('/admin/payment-details', checkAppPermission('canManageTenantSettings'), getPaymentDetails);
router.get('/admin/invoices', checkAppPermission('canManageTenantSettings'), getInvoices);
router.post('/admin/update-payment-url', checkAppPermission('canManageTenantSettings'), getUpdatePaymentUrl);

export default router;
