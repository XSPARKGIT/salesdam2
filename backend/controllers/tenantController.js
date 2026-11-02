import Tenant from '../models/Tenant.js';
import User from '../models/User.js';
import ObjectMeta from '../models/ObjectMeta.js';
import Workspace from '../models/Workspace.js';
import FieldMeta from '../models/FieldMeta.js';
import DynamicRecord from '../models/DynamicRecord.js';
import Layout from '../models/Layout.js';
import LayoutAssignment from '../models/LayoutAssignment.js';
import PermissionSet from '../models/PermissionSet.js';
import ApproverGroup from '../models/ApproverGroup.js';
import Role from '../models/Role.js';
import Automation from '../models/Automation.js';
import Dashboard from '../models/Dashboard.js';
import Notification from '../models/Notification.js';
import ApiKey from '../models/ApiKey.js';
import AuditLog from '../models/AuditLog.js';
import { asyncHandler, sendSuccess, AppError, paginate } from '../utils/errors.js';
import { audit } from '../utils/auditLogger.js';
import { seedDefaultRoles } from '../services/roleService.js';
import { seedStandardObjects } from '../services/metadataService.js';
import paystackService from '../services/paystackService.js';
import PLAN_LIMITS from '../config/planLimits.js';
import nodemailer from 'nodemailer';
import logger from '../utils/logger.js';

/**
 * Send tenant deletion email to the owner
 */
async function sendTenantDeletionEmail(tenantName, ownerEmail) {
  try {
    let transporter;

    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.SMTP_SERVICE) {
      transporter = nodemailer.createTransport({
        service: process.env.SMTP_SERVICE,
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT || 587,
        secure: true,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });
    } else if (process.env.NODE_ENV === 'development') {
      try {
        const testAccount = await Promise.race([
          nodemailer.createTestAccount({ requestsTimeout: 8000 }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Ethereal timeout')), 10000)),
        ]);

        transporter = nodemailer.createTransport({
          host: 'smtp.ethereal.email',
          port: 587,
          secure: false,
          auth: {
            user: testAccount.user,
            pass: testAccount.pass,
          },
          tls: { rejectUnauthorized: false },
        });
      } catch (err) {
        logger.info('Ethereal Email unavailable, logging to console');
        logger.info(`Tenant Deletion Email: To: ${ownerEmail}, Subject: Salesdam Account Deleted, Tenant: ${tenantName}`);
        return;
      }
    } else {
      throw new Error('SMTP not configured');
    }

    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #244c64 0%, #2d5a7b 100%); color: #fff; padding: 20px; border-radius: 8px; text-align: center; }
            .content { padding: 20px 0; }
            .info-box { background: #fef3cd; border-left: 4px solid #ff9800; padding: 12px; margin: 20px 0; border-radius: 4px; }
            .footer { font-size: 12px; color: #666; border-top: 1px solid #ddd; padding-top: 20px; margin-top: 40px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Account Deleted</h1>
            </div>
            <div class="content">
              <p>Hi ${ownerEmail.split('@')[0]},</p>
              <p>We are writing to confirm that your Salesdam workspace <strong>"${tenantName}"</strong> has been permanently deleted.</p>
              <div class="info-box">
                <strong>⚠️ Important:</strong> All associated data, including users, records, and configurations, has been permanently removed and cannot be recovered.
              </div>
              <p>If you did not request this deletion or believe this was done in error, please contact our support team immediately.</p>
              <p>Thank you for using Salesdam. We hope to serve you again in the future.</p>
            </div>
            <div class="footer">
              <p>© ${new Date().getFullYear()} Salesdam. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    const mailOptions = {
      from: process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@salesdam.com',
      to: ownerEmail,
      subject: 'Salesdam Account Deleted',
      html: htmlContent,
    };

    await transporter.sendMail(mailOptions);
    logger.info(`Tenant deletion email sent to ${ownerEmail}`);
  } catch (error) {
    logger.error(`Failed to send tenant deletion email: ${error.message}`);
  }
}

/** GET /api/admin/tenants */
const listTenants = asyncHandler(async (req, res) => {
  const { page = 1, limit = 50, search, status } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const query = {};
  if (status) query.status = status;
  if (search) query.name = { $regex: search, $options: 'i' };

  const [tenants, total] = await Promise.all([
    Tenant.find(query).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)),
    Tenant.countDocuments(query),
  ]);

  sendSuccess(res, paginate(tenants, total, page, limit));
});

/** GET /api/admin/tenants/:id */
const getTenant = asyncHandler(async (req, res) => {
  const tenant = await Tenant.findById(req.params.id);
  if (!tenant) throw new AppError('Workspace not found.', 404);
  sendSuccess(res, { data: tenant });
});

/** POST /api/admin/tenants */
const createTenant = asyncHandler(async (req, res) => {
  const { name, slug, plan, settings } = req.body;
  if (!name?.trim()) throw new AppError('Name is required.', 400);

  const generatedSlug = slug?.trim() ||
    name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const existing = await Tenant.findOne({
    $or: [
      { name: { $regex: new RegExp(`^${name.trim()}$`, 'i') } },
      { slug: generatedSlug },
    ],
  });
  if (existing) throw new AppError('A workspace with this name or slug already exists.', 409);

  const selectedPlan = PLAN_LIMITS[plan] ? plan : 'free';

  const tenant = await Tenant.create({
    name: name.trim(),
    slug: generatedSlug,
    plan: selectedPlan,
    limits: PLAN_LIMITS[selectedPlan],
    settings: settings || {},
    createdBy: req.user._id,
  });

  // Seed default roles and standard objects
  await seedDefaultRoles(tenant._id);
  await seedStandardObjects(tenant._id, req.user._id);

  await audit({
    tenantId: req.tenantId, userId: req.user._id,
    action: 'create', resource: 'Tenant', resourceId: tenant._id, req,
  });

  sendSuccess(res, { data: tenant }, 'Workspace created', 201);
});

/** PUT /api/admin/tenants/:id */
const updateTenant = asyncHandler(async (req, res) => {
  const tenant = await Tenant.findById(req.params.id);
  if (!tenant) throw new AppError('Workspace not found.', 404);

  const { name, plan, settings } = req.body;
  if (name !== undefined) tenant.name = name.trim();
  if (plan !== undefined) tenant.plan = plan;
  if (settings !== undefined) tenant.settings = { ...tenant.settings, ...settings };

  await tenant.save();

  await audit({
    tenantId: req.tenantId, userId: req.user._id,
    action: 'update', resource: 'Tenant', resourceId: tenant._id, req,
  });

  sendSuccess(res, { data: tenant }, 'Workspace updated');
});

/** PATCH /api/admin/tenants/:id/suspend */
const suspendTenant = asyncHandler(async (req, res) => {
  const tenant = await Tenant.findById(req.params.id);
  if (!tenant) throw new AppError('Workspace not found.', 404);
  if (tenant.status === 'suspended') throw new AppError('Already suspended.', 400);

  tenant.status = 'suspended';
  await tenant.save();

  await audit({
    tenantId: req.tenantId, userId: req.user._id,
    action: 'suspend', resource: 'Tenant', resourceId: tenant._id, req,
  });

  sendSuccess(res, { data: tenant }, 'Workspace suspended');
});

/** PATCH /api/admin/tenants/:id/activate */
const activateTenant = asyncHandler(async (req, res) => {
  const tenant = await Tenant.findById(req.params.id);
  if (!tenant) throw new AppError('Workspace not found.', 404);

  tenant.status = 'active';
  await tenant.save();

  await audit({
    tenantId: req.tenantId, userId: req.user._id,
    action: 'activate', resource: 'Tenant', resourceId: tenant._id, req,
  });

  sendSuccess(res, { data: tenant }, 'Workspace activated');
});

/** DELETE /api/admin/tenants/:id */
const deleteTenant = asyncHandler(async (req, res) => {
  const tenant = await Tenant.findById(req.params.id);
  if (!tenant) throw new AppError('Workspace not found.', 404);

  // Soft-delete: mark as deleted rather than removing the document
  tenant.status = 'deleted';
  await tenant.save();

  // Send deletion email to owner
  if (tenant.ownerEmail) {
    await sendTenantDeletionEmail(tenant.name, tenant.ownerEmail);
  }

  await audit({
    tenantId: req.tenantId, userId: req.user._id,
    action: 'delete', resource: 'Tenant', resourceId: tenant._id, req,
  });

  sendSuccess(res, {}, 'Workspace deleted');
});

/** DELETE /api/admin/tenants/:id/permanently */
const permanentlyDeleteTenant = asyncHandler(async (req, res) => {
  const tenant = await Tenant.findById(req.params.id);
  if (!tenant) throw new AppError('Workspace not found.', 404);

  // Store owner email before deletion
  const ownerEmail = tenant.ownerEmail;
  const tenantName = tenant.name;

  // Cancel Paystack subscription if active
  if (tenant.billing?.paystackSubscriptionCode) {
    try {
      await paystackService.disableSubscription(tenant.billing.paystackSubscriptionCode);
    } catch (err) {
      // Log the error but continue with deletion
      console.error('Error disabling Paystack subscription:', err.message);
    }
  }

  const tenantId = tenant._id;

  // Delete all tenant-related data in order of dependencies
  await Promise.all([
    User.deleteMany({ tenantId }),
    Workspace.deleteMany({ tenantId }),
    ObjectMeta.deleteMany({ tenantId }),
    FieldMeta.deleteMany({ tenantId }),
    DynamicRecord.deleteMany({ tenantId }),
    Layout.deleteMany({ tenantId }),
    LayoutAssignment.deleteMany({ tenantId }),
    PermissionSet.deleteMany({ tenantId }),
    ApproverGroup.deleteMany({ tenantId }),
    Role.deleteMany({ tenantId }),
    Automation.deleteMany({ tenantId }),
    Dashboard.deleteMany({ tenantId }),
    Notification.deleteMany({ tenantId }),
    ApiKey.deleteMany({ tenantId }),
    AuditLog.deleteMany({ tenantId }),
  ]);

  // Delete the tenant itself
  await Tenant.deleteOne({ _id: tenantId });

  // Send deletion email to owner
  if (ownerEmail) {
    await sendTenantDeletionEmail(tenantName, ownerEmail);
  }

  await audit({
    tenantId: req.tenantId,
    userId: req.user._id,
    action: 'permanently_delete',
    resource: 'Tenant',
    resourceId: tenantId,
    req,
  });

  sendSuccess(res, {}, 'Workspace and all associated data permanently deleted');
});

/** GET /api/admin/tenants/:id/users */
const getTenantUsers = asyncHandler(async (req, res) => {
  const users = await User.find({ tenantId: req.params.id })
    .select('-password')
    .populate('role', 'name label')
    .sort({ firstName: 1 });
  sendSuccess(res, { data: users });
});

/** POST /api/admin/tenants/:id/users — add an existing user to this workspace */
const addTenantUser = asyncHandler(async (req, res) => {
  const { userId, roleId } = req.body;
  if (!userId) throw new AppError('userId is required.', 400);

  const tenant = await Tenant.findById(req.params.id);
  if (!tenant) throw new AppError('Workspace not found.', 404);

  const user = await User.findById(userId);
  if (!user) throw new AppError('User not found.', 404);

  // Move user into this tenant (multi-tenant: update tenantId)
  user.tenantId = tenant._id;
  if (roleId) user.role = roleId;
  await user.save();

  await audit({
    tenantId: req.tenantId, userId: req.user._id,
    action: 'add_user', resource: 'Tenant', resourceId: tenant._id,
    details: { addedUserId: userId }, req,
  });

  sendSuccess(res, { data: user }, 'User added to workspace');
});

/** DELETE /api/admin/tenants/:id/users/:userId */
const removeTenantUser = asyncHandler(async (req, res) => {
  const user = await User.findOne({ _id: req.params.userId, tenantId: req.params.id });
  if (!user) throw new AppError('User not found in this workspace.', 404);

  // Deactivate rather than delete — preserves audit trail
  user.status = 'inactive';
  await user.save();

  await audit({
    tenantId: req.tenantId, userId: req.user._id,
    action: 'remove_user', resource: 'Tenant', resourceId: req.params.id,
    details: { removedUserId: req.params.userId }, req,
  });

  sendSuccess(res, {}, 'User removed from workspace');
});

/** GET /api/admin/tenants/:id/objects */
const getTenantObjects = asyncHandler(async (req, res) => {
  const objects = await ObjectMeta.find({ tenantId: req.params.id })
    .sort({ navOrder: 1, name: 1 });
  sendSuccess(res, { data: objects });
});

/** PATCH /api/admin/tenants/:id/objects/:apiName/toggle */
const toggleTenantObject = asyncHandler(async (req, res) => {
  const { field } = req.body;
  if (!['isActive', 'showInNav'].includes(field)) {
    throw new AppError('field must be isActive or showInNav.', 400);
  }

  const obj = await ObjectMeta.findOne({ tenantId: req.params.id, apiName: req.params.apiName });
  if (!obj) throw new AppError('Object not found.', 404);

  obj[field] = !obj[field];
  await obj.save();

  sendSuccess(res, { data: { [field]: obj[field] } });
});

export {
  listTenants, getTenant, createTenant, updateTenant,
  suspendTenant, activateTenant, deleteTenant, permanentlyDeleteTenant,
  getTenantUsers, addTenantUser, removeTenantUser,
  getTenantObjects, toggleTenantObject,
};
