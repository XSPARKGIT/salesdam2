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
import passwordResetService from '../services/passwordResetService.js';
import welcomeEmailService from '../services/welcomeEmailService.js';
import { validateUserPermissions } from '../services/permissionValidationService.js';
import { getPlanTier } from '../config/planMapping.js';
import { executeWithTransaction } from '../utils/transactionHelper.js';
import PLAN_LIMITS from '../config/planLimits.js';

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
  const { username, password, tenantId, isAdminLogin } = req.body;

  // Find user by username + tenant (or just username for cross-tenant lookup)
  let user;
  if (tenantId) {
    user = await User.findOne({ username: username?.toLowerCase(), tenantId })
      .select('+password')
      .populate('role');
  } else {
    user = await User.findOne({ username: username?.toLowerCase(), status: 'active' })
      .select('+password')
      .populate('role');
  }

  if (!user) {
    throw new AppError('Invalid username or password.', 401);
  }

  // Check if user is allowed for admin dashboard
  if (isAdminLogin) {
    const allowedSuperusers = (process.env.ADMIN_SUPERUSERS || '')
      .split(',')
      .map(u => u.trim().toLowerCase())
      .filter(u => u);

    if (!allowedSuperusers.includes(username.toLowerCase())) {
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
    await user.incrementFailedLogins();
    await audit({
      tenantId: user.tenantId,
      userId: user._id,
      userEmail: user.email,
      action: 'login_failed',
      req,
      status: 'failure',
    });
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

  await user.resetFailedLogins();

  // Create session record and set cookie
  await req.createSession({
    userId: user._id.toString(),
    tenantId: (tenantId || user.tenantId).toString(),
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
      },
    },
    'Login successful',
  );
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
 * GET /api/auth/me
 */
const getMe = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id)
    .populate('role', 'name label appPermissions objectPermissions')
    .populate('tenantId', 'name slug settings features');

  const tenant = await Tenant.findOne({
    _id: user.tenantId,
    status: 'active',
  }).select('_id name slug logo operatingCurrency features');

  if (!tenant) {
    throw new AppError(
      'Your workspace is not active. Please contact support.',
      403,
    );
  }

  // Same rule as GET /workspaces/mine and POST /workspaces/switch: the
  // user's own workspaces plus the tenant default, which everyone may use.
  const workspaces = await Workspace.find({
    tenantId: user.tenantId,
    status: 'active',
    $or: [{ memberIds: user._id }, { isDefault: true }],
  })
    .select('_id name slug color icon allowedObjects objectGroups isDefault')
    .sort({ isDefault: -1, name: 1 });

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
        // Last workspace chosen on the server session (POST /workspaces/switch).
        activeWorkspaceId: req.sessionData?.workspaceId || null,
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

  user.password = newPassword;
  await user.save();

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
 * Initiates password reset by username. Sends reset link to registered email.
 */
const forgotPassword = asyncHandler(async (req, res) => {
  const { username } = req.body;

  if (!username) {
    throw new AppError('Username is required.', 400);
  }

  // Find user by username
  const user = await User.findOne({ username: username.toLowerCase() });

  // Return generic message regardless of whether user exists (security best practice - no user enumeration)
  if (!user || user.status !== 'active') {
    sendSuccess(
      res,
      {},
      'If that username exists, a password reset link has been sent to the associated email.',
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
    'If that username exists, a password reset link has been sent to the associated email.',
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

  if (newPassword.length < 8) {
    throw new AppError('Password must be at least 8 characters long.', 400);
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
};
