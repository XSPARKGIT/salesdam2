import express from 'express';
import multer from 'multer';
import {
  getSystemStats,
  getAuditLogs,
  getAdminSettings,
  getLeadApprovalSettings,
  updateAdminSettings,
  getTendersConfig,
  updateTendersConfig,
  getSubscription,
  updateSubscriptionPlan,
  updatePaymentMethod,
  cancelSubscription,
  getStorageUsage,
} from '../controllers/adminController.js';
import {
  adminExport,
  importRecords,
} from '../controllers/importExportController.js';
import {
  listTenants,
  getTenant,
  createTenant,
  updateTenant,
  suspendTenant,
  activateTenant,
  deleteTenant,
  permanentlyDeleteTenant,
  getTenantUsers,
  addTenantUser,
  removeTenantUser,
  getTenantObjects,
  toggleTenantObject,
} from '../controllers/tenantController.js';
import {
  requireAuth,
  requireSuperuser,
} from '../middleware/auth.js';
import { enforceTenant } from '../middleware/tenant.js';
import { checkAppPermission } from '../middleware/permissions.js';

const router = express.Router();
const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const IMPORT_MIMES = new Set([
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheet.sheet',
  'text/csv',
  'text/plain',
  'application/csv',
]);

const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!IMAGE_MIMES.has(file.mimetype)) {
      return cb(new Error(`Unsupported logo file type: ${file.mimetype}`));
    }
    cb(null, true);
  },
});

const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!IMPORT_MIMES.has(file.mimetype)) {
      return cb(new Error(`Unsupported import file type: ${file.mimetype}`));
    }
    cb(null, true);
  },
});

router.use(requireAuth, enforceTenant);

// Lead approval settings — readable by all authenticated users (used by tender dialog, etc.)
router.get('/settings/lead-approval-settings', getLeadApprovalSettings);

// Stats
router.get('/stats', checkAppPermission('canCustomizeApplication'), getSystemStats);
// Audit logs
router.get('/logs', checkAppPermission('canViewAuditLog'), getAuditLogs);

// Admin settings (company profile, targets, invoice/quote)
router.get('/settings', checkAppPermission('canManageTenantSettings'), getAdminSettings);
router.put('/settings', checkAppPermission('canManageTenantSettings'), logoUpload.single('logoFile'), updateAdminSettings);

// Storage usage
router.get('/storage-usage', checkAppPermission('canCustomizeApplication'), getStorageUsage);

// Tenders config
router.get('/settings/tenders-config', checkAppPermission('canManageTenantSettings'), getTendersConfig);
router.put('/settings/tenders-config', checkAppPermission('canManageTenantSettings'), updateTendersConfig);

// Subscription management
router.get('/subscription', checkAppPermission('canManageTenantSettings'), getSubscription);
router.put('/subscription/plan', checkAppPermission('canManageTenantSettings'), updateSubscriptionPlan);
router.put('/subscription/payment-method', checkAppPermission('canManageTenantSettings'), updatePaymentMethod);
router.post('/subscription/cancel', checkAppPermission('canManageTenantSettings'), cancelSubscription);

// Data import/export
router.post('/import', checkAppPermission('canImportData'), importUpload.single('file'), importRecords);
router.get('/export', checkAppPermission('canExportData'), adminExport);

// Tenant (workspace) management — superuser only
router.get('/tenants', requireSuperuser, listTenants);
router.get('/tenants/:id', requireSuperuser, getTenant);
router.post('/tenants', requireSuperuser, createTenant);
router.put('/tenants/:id', requireSuperuser, updateTenant);
router.patch('/tenants/:id/suspend', requireSuperuser, suspendTenant);
router.patch('/tenants/:id/activate', requireSuperuser, activateTenant);
router.delete('/tenants/:id', requireSuperuser, deleteTenant);
router.delete('/tenants/:id/permanently', requireSuperuser, permanentlyDeleteTenant);
router.get('/tenants/:id/users', requireSuperuser, getTenantUsers);
router.post('/tenants/:id/users', requireSuperuser, addTenantUser);
router.delete('/tenants/:id/users/:userId', requireSuperuser, removeTenantUser);
router.get('/tenants/:id/objects', requireSuperuser, getTenantObjects);
router.patch(
  '/tenants/:id/objects/:apiName/toggle',
  requireSuperuser,
  toggleTenantObject,
);

export default router;
