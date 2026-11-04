import User from '../models/User.js';
import Tenant from '../models/Tenant.js';
import Workspace from '../models/Workspace.js';
import Role from '../models/Role.js';
import Session from '../models/Session.js';
import { asyncHandler, sendSuccess, AppError } from '../utils/errors.js';
import { audit } from '../utils/auditLogger.js';
import logger from '../utils/logger.js';
import { seedDefaultRoles } from '../services/roleService.js';
import { seedSalesdamLayouts } from '../services/layoutService.js';
import { createDefaultWorkspace } from '../services/workspaceService.js';
import { seedSalesdamObjects } from '../services/salesdamObjectsService.js';
import { ensureDefaultActions } from '../services/actionService.js';
import { accessibleWorkspaceFilter } from '../services/appAccessService.js';
import approvalProcessService from '../services/approvalProcessService.js';
import passwordResetService from '../services/passwordResetService.js';
import welcomeEmailService from '../services/welcomeEmailService.js';
import { validateUserPermissions } from '../services/permissionValidationService.js';
import { getPlanTier } from '../config/planMapping.js';
import { executeWithTransaction } from '../utils/transactionHelper.js';
import PLAN_LIMITS from '../config/planLimits.js';
import authSecurityService from '../services/authSecurityService.js';
import mfaService from '../services/mfaService.js';

/**
 * POST /api/auth/register
 * Creates a new tenant + superuser (first user).
 */
const register = asyncHandler(async (req, res) => {
  const {
    firstName,
    lastName,
    email,
    username,
    password,
    tenantName,
    phone,
    numberOfEmployees,
    plan,
    debitOrderDay,
    industry,
    useCase,
    hub,
  } = req.body;

  // Company name must be unique
  const nameExists = await Tenant.findOne({
    name: { $regex: new RegExp(`^${tenantName.trim()}$`, 'i') },
  });
  if (nameExists) {
    throw new AppError(
      'A workspace with this company name already exists.',
      409,
    );
  }

  const slug = tenantName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  const slugExists = await Tenant.findOne({ slug });
  if (slugExists) {
    throw new AppError('A workspace with this URL already exists.', 409);
  }

  // No tenant exists yet for the new account, so this is checked against the
  // platform-wide default policy (tenantId: null).
  await authSecurityService.validatePasswordForTenant(password, null);

  const selectedPlan = getPlanTier(plan || 'starter');
  const limits = PLAN_LIMITS[selectedPlan];

  // Execute registration within a transaction to ensure consistency
  const result = await executeWithTransaction(async (session) => {
    // Create tenant
    const tenant = await Tenant.create(
      [{
        name: tenantName.trim(),
        slug,
        phone,
        numberOfEmployees,
        plan: selectedPlan,
        debitOrderDay: debitOrderDay ? Number(debitOrderDay) : undefined,
        hub: hub || 'sales',
        limits,
        onboarding: { industry, useCase },
        companyProfile: {
          companyName: tenantName.trim(),
          email,
          phone: phone || '',
        },
        operatingCurrency: {
          code: 'ZAR',
          name: 'South African Rand',
          symbol: 'R',
        },
        features: {
          aiOnboarding: true,
          customObjects: true,
          automations: true,
          analytics: true,
          apiAccess: false,
          webhooks: false,
          enableSalesdamFeatures: true,
          salesdamFindTenders: true,
          salesdamHomeDashboard: true,
          salesdamOrdersDashboard: true,
          salesdamAccountDashboard: true,
          salesdamDealsDashboard: true,
          salesdamLeadsDashboard: true,
          salesdamRevenueDashboard: true,
          salesdamSalesDashboard: true,
          salesdamROIDashboard: true,
        },
      }],
      { session }
    );

    const tenantDoc = tenant[0];

    // Create superuser role for this tenant with transaction session
    await seedDefaultRoles(tenantDoc._id, session);

    // Seed Salesdam default layouts
    // await seedSalesdamLayouts(tenantDoc._id, null);

    const superuserRole = await Role.findOne({
      tenantId: tenantDoc._id,
      name: 'superuser',
    }).session(session);

    // Create the first user as superuser
    const user = await User.create(
      [{
        tenantId: tenantDoc._id,
        firstName,
        lastName,
        email,
        username: username?.toLowerCase()?.trim(),
        password,
        role: superuserRole?._id,
        status: 'active',
        emailVerified: true,
      }],
      { session }
    );

    const userDoc = user[0];

    // Create default "Sales Hub" workspace with predefined object groups
    await createDefaultWorkspace(tenantDoc._id, userDoc._id);

    // Seed Salesdam objects with fields
    await seedSalesdamObjects(tenantDoc._id, userDoc._id);
    await ensureDefaultActions(tenantDoc._id);
    await approvalProcessService.ensureLeadApprovalProcess(tenantDoc._id);

    // Update tenant with creator and allowedObjects
    const allowedObjectApiNames = [
      'client',
      'contact',
      'lead',
      'deal',
      'order',
      'product',
      'task',
      'case',
    ];

    await Tenant.findByIdAndUpdate(
      tenantDoc._id,
      {
        createdBy: userDoc._id,
        $set: {
          'usage.users': 1,
          allowedObjects: allowedObjectApiNames,
        },
      },
      { session, new: true }
    );

    return { tenant: tenantDoc, user: userDoc };
  });

  // Validate user permissions are properly configured
  try {
    await validateUserPermissions(result.user._id, result.tenant._id);
  } catch (permError) {
    logger.warn(`Permission validation warning for new user ${result.user.email}:`, permError);
    // Don't fail registration on permission validation errors, just log
  }

  // Create session record and set cookie
  await req.createSession({
    userId: result.user._id.toString(),
    tenantId: result.tenant._id.toString(),
    userAgent: req.headers['user-agent'] || '',
    ipAddress: req.ip,
  });

  await audit({
    tenantId: result.tenant._id,
    userId: result.user._id,
    userEmail: result.user.email,
    action: 'tenant_create',
    resource: 'Tenant',
    resourceId: result.tenant._id,
    req,
  });

  // Send welcome email (in background, don't block response)
  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  welcomeEmailService
    .sendWelcomeEmail(result.user.email, result.user.firstName, result.tenant.name, appUrl)
    .catch((err) => {
      logger.error('Failed to send welcome email:', err);
    });

  sendSuccess(
    res,
    {
      data: {
        user: {
          _id: result.user._id,
          firstName: result.user.firstName,
          lastName: result.user.lastName,
          email: result.user.email,
        },
        tenant: {
          _id: result.tenant._id,
          name: result.tenant.name,
          features: result.tenant.features,
          operatingCurrency: result.tenant.operatingCurrency || {
            code: 'ZAR',
            name: 'South African Rand',
            symbol: 'R',
          },
        },
      },
    },
    'Account created successfully',
    201,
  );
});

/**
 * POST /api/auth/login
 */
const login = asyncHandler(async (req, res) => {
  const { email, username, password, tenantId, isAdminLogin } = req.body;

  // Email is the sole login identifier. `username` is accepted only as a
  // legacy alias for the email field and is never matched against the stored
  // username/display handle.
  const identifier = String(email || username || '').trim().toLowerCase();

  // Find user by email + tenant (or by email for cross-tenant lookup)
  let user;
  if (tenantId) {
    user = await User.findOne({ email: identifier, tenantId })
      .select('+password')
      .populate('role');
  } else {
    user = await User.findOne({ email: identifier, status: 'active' })
      .select('+password')
      .populate('role');
  }

  if (!user) {
    // Log auth failure
    try {
      const AuthFailureLog = (await import('../models/AuthFailureLog.js')).default;
      await AuthFailureLog.create({
        tenantId: null,
        integration: 'session',
        identifier: identifier,
        reason: 'User not found',
        ip: req.ip || req.headers['x-forwarded-for'],
        path: req.path,
        method: req.method,
      });
    } catch { /* ignore */ }
    throw new AppError('Invalid username or password.', 401);
  }

  // Check if user is allowed for admin dashboard
  if (isAdminLogin) {
    const allowedSuperusers = (process.env.ADMIN_SUPERUSERS || '')
      .split(',')
      .map(u => u.trim().toLowerCase())
      .filter(u => u);

    if (!allowedSuperusers.includes(identifier)) {
      throw new AppError('You do not have access to the admin dashboard.', 403);
    }
  }

  if (user.isLocked()) {
    throw new AppError(
      'Account is temporarily locked. Please try again later.',
      423,
    );
  }

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    const { justLocked } = await authSecurityService.recordFailedLogin(user, user.tenantId);
    // Log auth failure
    try {
      const AuthFailureLog = (await import('../models/AuthFailureLog.js')).default;
      await AuthFailureLog.create({
        tenantId: user.tenantId,
        integration: 'session',
        identifier: user.email,
        reason: 'Invalid password',
        ip: req.ip || req.headers['x-forwarded-for'],
        path: req.path,
        method: req.method,
      });
    } catch { /* ignore */ }
    await audit({
      tenantId: user.tenantId,
      userId: user._id,
      userEmail: user.email,
      action: 'login_failed',
      req,
      status: 'failure',
    });
    if (justLocked) {
      await audit({
        tenantId: user.tenantId,
        userId: user._id,
        userEmail: user.email,
        action: 'account_lockout',
        resource: 'User',
        resourceId: user._id,
        req,
      });
    }
    throw new AppError('Invalid username or password.', 401);
  }

  if (user.status !== 'active') {
    throw new AppError(
      'Your account is not active. Please contact your administrator.',
      403,
    );
  }

  // Check tenant is active
  const activeTenant = await Tenant.findById(tenantId || user.tenantId);
  if (!activeTenant || activeTenant.status !== 'active') {
    throw new AppError('This workspace is not accessible.', 403);
  }

  // Set systemRole for admin dashboard users
  if (isAdminLogin) {
    user.systemRole = 'admin';
    await user.save();
  }

  await authSecurityService.recordSuccessfulLogin(user);

  const effectiveTenantId = (tenantId || user.tenantId).toString();

  // Core BRD §21.4: MFA, enforced here on the backend — never skippable by
  // going straight to a different endpoint, since no full session exists
  // until this check passes. Challenged on EVERY enrolled user, whether
  // enrollment was required by policy or set up voluntarily — "required"
  // only controls whether an unenrolled user is forced to enroll below.
  const mfaRequired = await authSecurityService.isMfaRequiredFor(user);
  if (user.mfa?.enabled) {
    // Password was correct, but authentication is not complete: issue a
    // short-lived pending session that only POST /auth/mfa/verify can act
    // on (requireAuth rejects it — see middleware/auth.js).
    await req.createSession(
      {
        userId: user._id.toString(),
        tenantId: effectiveTenantId,
        userAgent: req.headers['user-agent'] || '',
        ipAddress: req.ip,
      },
      { maxAgeMs: 5 * 60 * 1000, data: { mfaPending: true } },
    );
    return sendSuccess(
      res,
      { data: { mfaChallengeRequired: true } },
      'Enter your authentication code to finish signing in.',
    );
  }

  // Create session record and set cookie
  await req.createSession({
    userId: user._id.toString(),
    tenantId: effectiveTenantId,
    userAgent: req.headers['user-agent'] || '',
    ipAddress: req.ip,
  });

  await audit({
    tenantId: user.tenantId,
    userId: user._id,
    userEmail: user.email,
    action: 'login',
    resource: 'User',
    req,
  });

  sendSuccess(
    res,
    {
      data: {
        user: {
          _id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.role,
          avatar: user.avatar,
          preferences: user.preferences,
          systemRole: user.systemRole,
          activeTenantId: req.sessionData?.tenantId,
        },
        tenant: {
          _id: activeTenant._id,
          name: activeTenant.name,
          slug: activeTenant.slug,
          settings: activeTenant.settings,
          features: activeTenant.features,
          operatingCurrency: activeTenant.operatingCurrency || {
            code: 'ZAR',
            name: 'South African Rand',
            symbol: 'R',
          },
        },
        // Tenant/Role/user policy requires MFA but this user has not
        // enrolled yet — let them in, but the frontend must prompt
        // enrollment immediately rather than leaving them permanently able
        // to skip it.
        mfaEnrollmentRequired: mfaRequired && !user.mfa?.enabled,
      },
    },
    'Login successful',
  );
});

/**
 * POST /api/auth/mfa/verify
 * Completes login for a session left pending by an MFA-required user.
 * Accepts either a live TOTP code or a one-time backup code.
 */
const mfaVerifyLogin = asyncHandler(async (req, res) => {
  const { code, backupCode } = req.body || {};
  if (!req.sessionData?.mfaPending || !req.sessionData?.userId) {
    throw new AppError('No pending MFA challenge for this session.', 400);
  }

  const user = await User.findById(req.sessionData.userId).select('+mfa.secret +mfa.backupCodeHashes');
  if (!user || !user.mfa?.enabled) {
    await req.destroySession();
    throw new AppError('MFA is not set up for this account.', 400);
  }

  let ok = false;
  let usedBackupCode = false;
  if (code) {
    const secret = mfaService.decryptMfaSecret(user.mfa.secret);
    ok = mfaService.verifyToken(code, secret);
  } else if (backupCode) {
    const idx = await mfaService.matchBackupCode(backupCode, user.mfa.backupCodeHashes || []);
    if (idx >= 0) {
      ok = true;
      usedBackupCode = true;
      user.mfa.backupCodeHashes.splice(idx, 1);
      await user.save();
    }
  }

  if (!ok) {
    await audit({
      tenantId: user.tenantId,
      userId: user._id,
      userEmail: user.email,
      action: 'mfa_verify_failed',
      resource: 'User',
      resourceId: user._id,
      req,
      status: 'failure',
    });
    throw new AppError('Incorrect authentication code.', 401);
  }

  user.mfa.lastVerifiedAt = new Date();
  await user.save();
  await req.upgradeSessionAfterMfa();

  await audit({
    tenantId: user.tenantId,
    userId: user._id,
    userEmail: user.email,
    action: usedBackupCode ? 'mfa_recovery_used' : 'mfa_verify_success',
    resource: 'User',
    resourceId: user._id,
    req,
  });
  await audit({
    tenantId: user.tenantId,
    userId: user._id,
    userEmail: user.email,
    action: 'login',
    resource: 'User',
    req,
  });

  const activeTenant = await Tenant.findById(req.sessionData.tenantId);
  sendSuccess(res, {
    data: {
      user: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        avatar: user.avatar,
        preferences: user.preferences,
        activeTenantId: req.sessionData?.tenantId,
      },
      tenant: activeTenant ? {
        _id: activeTenant._id,
        name: activeTenant.name,
        slug: activeTenant.slug,
        settings: activeTenant.settings,
        features: activeTenant.features,
      } : null,
      usedBackupCode,
    },
  }, 'Login successful');
});

/**
 * GET /api/auth/mfa/status
 * Whether the current user has MFA enabled and/or is required to have it.
 */
const mfaStatus = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).populate('role', 'mfaRequired');
  const required = await authSecurityService.isMfaRequiredFor(user);
  sendSuccess(res, {
    data: {
      enabled: Boolean(user.mfa?.enabled),
      required,
      enrolledAt: user.mfa?.enrolledAt || null,
    },
  });
});

/**
 * POST /api/auth/mfa/enroll
 * Starts enrollment: generates a TOTP secret (stored, but not yet "enabled"
 * — enrollment only completes once the user proves they can generate a
 * valid code from it) and a fresh set of recovery codes.
 */
const mfaEnroll = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (user.mfa?.enabled) {
    throw new AppError('MFA is already enabled. Disable it before re-enrolling.', 400);
  }

  const secret = mfaService.generateSecret();
  const { plain: backupCodes, hashes } = await mfaService.generateBackupCodes();

  user.mfa = {
    enabled: false,
    secret: mfaService.encryptMfaSecret(secret),
    backupCodeHashes: hashes,
  };
  await user.save();

  await audit({
    tenantId: req.tenantId,
    userId: user._id,
    userEmail: user.email,
    action: 'mfa_enroll',
    resource: 'User',
    resourceId: user._id,
    req,
  });

  // The secret, QR code and backup codes are shown exactly once, here —
  // never returned by any other endpoint and never written to the audit log.
  const otpAuthUri = mfaService.buildOtpAuthUri(secret, user.email);
  const qrCodeDataUrl = await mfaService.buildEnrollmentQrCode(otpAuthUri);
  sendSuccess(res, {
    data: {
      secret,
      otpAuthUri,
      qrCodeDataUrl,
      backupCodes,
    },
  }, 'Scan this with your authenticator app, then confirm with a code to finish enrollment.');
});

/**
 * POST /api/auth/mfa/enroll/verify
 * Completes enrollment by proving the user can generate a valid code.
 */
const mfaEnrollVerify = asyncHandler(async (req, res) => {
  const { code } = req.body || {};
  const user = await User.findById(req.user._id).select('+mfa.secret');
  if (!user.mfa?.secret) {
    throw new AppError('No MFA enrollment in progress. Start enrollment first.', 400);
  }

  const secret = mfaService.decryptMfaSecret(user.mfa.secret);
  if (!mfaService.verifyToken(code, secret)) {
    throw new AppError('Incorrect authentication code.', 401);
  }

  user.mfa.enabled = true;
  user.mfa.enrolledAt = new Date();
  user.mfa.lastVerifiedAt = new Date();
  await user.save();

  await audit({
    tenantId: req.tenantId,
    userId: user._id,
    userEmail: user.email,
    action: 'mfa_enabled',
    resource: 'User',
    resourceId: user._id,
    req,
  });

  sendSuccess(res, {}, 'MFA is now enabled on your account.');
});

/**
 * POST /api/auth/mfa/disable
 * Requires the current password, so a hijacked session alone can't turn
 * MFA off.
 */
const mfaDisable = asyncHandler(async (req, res) => {
  const { currentPassword } = req.body || {};
  if (!currentPassword) throw new AppError('Current password is required.', 400);

  const user = await User.findById(req.user._id).select('+password');
  const isMatch = await user.comparePassword(currentPassword);
  if (!isMatch) throw new AppError('Current password is incorrect.', 401);

  user.mfa = { enabled: false, backupCodeHashes: [] };
  await user.save();

  await audit({
    tenantId: req.tenantId,
    userId: user._id,
    userEmail: user.email,
    action: 'mfa_disabled',
    resource: 'User',
    resourceId: user._id,
    req,
  });

  sendSuccess(res, {}, 'MFA has been disabled on your account.');
});

/**
 * POST /api/auth/logout
 */
const logout = asyncHandler(async (req, res) => {
  const userId = req.sessionData?.userId;
  const tenantId = req.sessionData?.tenantId;

  await audit({ tenantId, userId, action: 'logout', req });

  await req.destroySession();
  sendSuccess(res, {}, 'Logged out successfully');
});

/**
 * POST /api/auth/switch-tenant
 * Switch the active tenant for a superuser.
 */
const switchTenant = asyncHandler(async (req, res) => {
  const { tenantId } = req.body || {};
  if (!tenantId) throw new AppError('tenantId is required.', 400);

  const user = req.user;
  if (user?.role?.name?.toLowerCase() !== 'superuser') {
    throw new AppError('Only superusers can switch tenants.', 403);
  }

  const tenant = await Tenant.findById(tenantId);
  if (!tenant || tenant.status !== 'active') {
    throw new AppError('Tenant not found or inactive.', 404);
  }

  // Update session
  await req.sessionData && (req.sessionData.tenantId = tenant._id);

  // Re-create session with new tenant
  await req.createSession({
    userId: user._id.toString(),
    tenantId: tenant._id.toString(),
    userAgent: req.headers['user-agent'] || '',
    ipAddress: req.ip,
  });

  sendSuccess(res, {
    data: {
      tenant: {
        _id: tenant._id,
        name: tenant.name,
        slug: tenant.slug,
        settings: tenant.settings,
        features: tenant.features,
      },
    },
  }, 'Tenant switched');
});

/**
 * GET /api/auth/me
 */
const getMe = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id)
    .populate('role', 'name label appPermissions objectPermissions')
    .populate('tenantId', 'name slug settings features');

  // The session tenant, not the home tenant: a superuser may have switched
  // (POST /auth/switch-tenant), and every data request is already scoped to it.
  const activeTenantId = req.tenantId || user.tenantId;

  const tenant = await Tenant.findOne({
    _id: activeTenantId,
    status: 'active',
  }).select('_id name slug logo operatingCurrency features');

  if (!tenant) {
    throw new AppError(
      'Your workspace is not active. Please contact support.',
      403,
    );
  }

  // Same rule as GET /workspaces/mine and POST /workspaces/switch: Apps from
  // the user's Role, Permission Sets or membership, plus the default (BRD 5.3).
  const workspaces = await Workspace.find(
    await accessibleWorkspaceFilter(user, activeTenantId),
  )
    .select('_id name slug color icon allowedObjects objectGroups isDefault')
    .sort({ isDefault: -1, name: 1 });

  // BRD 9.3: Effective permissions = Role ∪ Permission Sets
  const { getEffectivePermissions } = await import('../services/systemPermissionService.js');
  const effectivePermissions = await getEffectivePermissions(user);

  sendSuccess(res, {
    data: {
      user: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        avatar: user.avatar,
        title: user.title,
        department: user.department,
        username: user.username,
        gender: user.gender,
        phone: user.phone,
        bio: user.bio,
        role: user.role,
        preferences: user.preferences,
        activeTenantId: req.sessionData?.tenantId,
        workspaces: workspaces || [],
        activeWorkspaceId: req.sessionData?.workspaceId || null,
        effectivePermissions,
      },
      tenant: {
        ...tenant.toObject(),
        operatingCurrency: tenant.operatingCurrency || {
          code: 'ZAR',
          name: 'South African Rand',
          symbol: 'R',
        },
      },
    },
  });
});

/**
 * GET /api/auth/password-policy
 * Lets the frontend validate with exactly the rules the backend enforces.
 * Unauthenticated callers (register, forgot-password) get the platform
 * default; an authenticated call resolves the caller's own tenant policy.
 */
const getPasswordPolicyRoute = asyncHandler(async (req, res) => {
  const policy = await authSecurityService.getPasswordPolicy(req.tenantId || null);
  sendSuccess(res, { data: policy });
});

/**
 * POST /api/auth/change-password
 */
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    throw new AppError('Current password and new password are required.', 400);
  }

  const user = await User.findById(req.user._id).select('+password');
  const isMatch = await user.comparePassword(currentPassword);
  if (!isMatch) throw new AppError('Current password is incorrect.', 401);

  await authSecurityService.validatePasswordForTenant(newPassword, req.tenantId);

  user.password = newPassword;
  await user.save();

  // Keep the session that just made this request alive; end every other
  // one, consistent with "password reset must invalidate existing sessions".
  await Session.deleteMany({ userId: user._id, sessionId: { $ne: req.sessionId } });

  await audit({
    tenantId: req.tenantId,
    userId: user._id,
    userEmail: user.email,
    action: 'password_change',
    req,
  });

  sendSuccess(res, {}, 'Password changed successfully');
});

/**
 * GET /api/auth/sessions
 * Returns all active sessions for the current user.
 */
const listSessions = asyncHandler(async (req, res) => {
  const sessions = await Session.find({
    userId: req.user._id,
    expiresAt: { $gt: new Date() },
  })
    .sort({ lastAccessedAt: -1 })
    .lean();

  const data = sessions.map((s) => ({
    id: s.sessionId,
    ipAddress: s.ipAddress,
    userAgent: s.userAgent,
    lastAccessedAt: s.lastAccessedAt,
    createdAt: s.createdAt,
    isCurrent: s.sessionId === req.sessionId,
  }));

  sendSuccess(res, { data });
});

/**
 * DELETE /api/auth/sessions/:sessionId
 * Revokes a specific session (not the current one).
 */
const revokeSession = asyncHandler(async (req, res) => {
  const { sessionId } = req.params;

  // Prevent revoking your own current session via this endpoint
  if (sessionId === req.sessionId) {
    throw new AppError(
      'Use POST /auth/logout to end the current session.',
      400,
    );
  }

  const session = await Session.findOne({ sessionId, userId: req.user._id });
  if (!session) throw new AppError('Session not found.', 404);

  await session.deleteOne();

  await audit({
    tenantId: req.tenantId,
    userId: req.user._id,
    userEmail: req.user.email,
    action: 'session_revoke',
    req,
  });

  sendSuccess(res, {}, 'Session revoked');
});

/**
 * POST /api/auth/forgot-password
 * Initiates password reset by email — email is the sole login identifier
 * (see login() above); `username` is accepted only as a legacy alias and is
 * never matched against the stored username/display handle.
 */
const forgotPassword = asyncHandler(async (req, res) => {
  const { email, username } = req.body;
  const identifier = String(email || username || '').trim().toLowerCase();

  if (!identifier) {
    throw new AppError('Email is required.', 400);
  }

  const user = await User.findOne({ email: identifier });

  // Return generic message regardless of whether the account exists
  // (security best practice — no account enumeration via this endpoint).
  if (!user || user.status !== 'active') {
    sendSuccess(
      res,
      {},
      'If that email address is registered, a password reset link has been sent to it.',
    );
    return;
  }

  // Generate reset token (valid for 2 hours)
  const resetToken = passwordResetService.generateResetToken();
  const resetTokenExpires = new Date(Date.now() + 2 * 60 * 60 * 1000);

  user.passwordResetToken = passwordResetService.hashToken(resetToken);
  user.passwordResetExpires = resetTokenExpires;
  await user.save();

  // Send reset email in background; a mail failure must not change the
  // response, otherwise valid usernames could be distinguished from unknown
  // ones (or the request would fail) when SMTP is unavailable.
  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  passwordResetService.sendPasswordResetEmail(user.email, resetToken, appUrl).catch((err) => {
    logger.error('Failed to send password reset email:', err);
  });

  await audit({
    tenantId: user.tenantId,
    userId: user._id,
    userEmail: user.email,
    action: 'password_reset_requested',
    req,
  });

  sendSuccess(
    res,
    {},
    'If that email address is registered, a password reset link has been sent to it.',
  );
});

/**
 * POST /api/auth/verify-reset-token
 * Verifies that a reset token is valid before allowing password reset.
 */
const verifyResetToken = asyncHandler(async (req, res) => {
  const { token } = req.body;

  if (!token) {
    throw new AppError('Reset token is required.', 400);
  }

  const user = await User.findOne({
    passwordResetToken: passwordResetService.hashToken(token),
    passwordResetExpires: { $gt: new Date() },
  }).select('+passwordResetToken +passwordResetExpires');

  if (!user) {
    throw new AppError(
      'Invalid or expired password reset link. Please request a new one.',
      400,
    );
  }

  sendSuccess(res, { data: { valid: true } }, 'Token is valid');
});

/**
 * POST /api/auth/reset-password
 * Resets password with a valid reset token.
 */
const resetPassword = asyncHandler(async (req, res) => {
  const { token, newPassword } = req.body;

  if (!token || !newPassword) {
    throw new AppError('Reset token and new password are required.', 400);
  }

  const user = await User.findOne({
    passwordResetToken: passwordResetService.hashToken(token),
    passwordResetExpires: { $gt: new Date() },
  }).select('+passwordResetToken +passwordResetExpires +password');

  if (!user) {
    throw new AppError(
      'Invalid or expired password reset link. Please request a new one.',
      400,
    );
  }

  await authSecurityService.validatePasswordForTenant(newPassword, user.tenantId);

  // Set new password and clear reset token
  user.password = newPassword;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  user.failedLoginAttempts = 0;
  user.lockedUntil = undefined;
  await user.save();

  // Destroy all active sessions for this user so they must log in with new password
  await Session.deleteMany({ userId: user._id });

  // Send confirmation email (background, don't block response)
  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  passwordResetService.sendPasswordResetConfirmationEmail(user.email, appUrl).catch((err) => {
    logger.error('Failed to send password reset confirmation email:', err);
  });

  await audit({
    tenantId: user.tenantId,
    userId: user._id,
    userEmail: user.email,
    action: 'password_reset_completed',
    req,
  });

  sendSuccess(
    res,
    {},
    'Password has been reset successfully. Please log in with your new password.',
  );
});

export {
  register,
  login,
  logout,
  getMe,
  changePassword,
  listSessions,
  revokeSession,
  forgotPassword,
  verifyResetToken,
  resetPassword,
  switchTenant,
  getPasswordPolicyRoute,
  mfaVerifyLogin,
  mfaStatus,
  mfaEnroll,
  mfaEnrollVerify,
  mfaDisable,
};
