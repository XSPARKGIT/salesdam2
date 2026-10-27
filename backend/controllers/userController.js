import User from '../models/User.js';
import Role from '../models/Role.js';
import Tenant from '../models/Tenant.js';
import FieldMeta from '../models/FieldMeta.js';
import {
  asyncHandler,
  sendSuccess,
  AppError,
  paginate,
} from '../utils/errors.js';
import { audit } from '../utils/auditLogger.js';
import logger from '../utils/logger.js';
import { ensureUserObject } from '../services/metadataService.js';
import passwordResetService from '../services/passwordResetService.js';
import { validateUserPermissions } from '../services/permissionValidationService.js';

/**
 * The superuser role is tenant-scoped and `user.role` is an unpopulated
 * ObjectId ref, so guards have to compare role ids: a
 * `countDocuments({ role: { name: 'superuser' } })` query against a ref field
 * can never match, which left the guards inert.
 */
const superuserRoleId = async (tenantId) => {
  const role = await Role.findOne({ tenantId, name: 'superuser' }).select('_id').lean();
  return role?._id || null;
};

const roleIdOf = (user) => user?.role?._id || user?.role || null;

const listUsers = asyncHandler(async (req, res) => {
  const { page = 1, limit = 50, search, status, role } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const query = { tenantId: req.tenantId };
  if (status) query.status = status;
  if (search) {
    query.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
    ];
  }
  if (role) query.role = role;

  const [users, total] = await Promise.all([
    User.find(query)
      .select('-password -emailVerificationToken -passwordResetToken')
      .populate('role', 'name label')
      .populate('manager', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit)),
    User.countDocuments(query),
  ]);

  sendSuccess(res, paginate(users, total, page, limit));
});

const getUser = asyncHandler(async (req, res) => {
  const user = await User.findOne({
    _id: req.params.id,
    tenantId: req.tenantId,
  })
    .select('-password -emailVerificationToken -passwordResetToken')
    .populate('role', 'name label appPermissions objectPermissions')
    .populate('manager', 'firstName lastName email');
  if (!user) throw new AppError('User not found.', 404);
  sendSuccess(res, { data: user });
});

const createUser = asyncHandler(async (req, res) => {
  const { email, username, role, manager, password, sendWelcomeEmail, ...rest } = req.body;

  // Validate username format (must be valid email)
  if (username) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(username)) {
      throw new AppError('Username must be a valid email address.', 400);
    }
  }

  // Check email uniqueness within tenant
  const existing = await User.findOne({
    tenantId: req.tenantId,
    $or: [
      { email: email.toLowerCase() },
      username ? { username: username.toLowerCase() } : null,
    ].filter(Boolean),
  });
  if (existing) {
    if (existing.email === email.toLowerCase()) {
      throw new AppError(
        'A user with this email already exists in this workspace.',
        409,
      );
    } else {
      throw new AppError(
        'A user with this username already exists in this workspace.',
        409,
      );
    }
  }

  if (!req.tenant.canAddUser()) {
    throw new AppError(
      `User limit reached (max ${req.tenant.limits.maxUsers}).`,
      429,
    );
  }

  // Use provided role or get default role for new users
  let roleId = role;
  if (!roleId) {
    const defaultRole = await Role.findOne({
      tenantId: req.tenantId,
      isDefault: true,
    });
    roleId = defaultRole?._id;
  }

  // Handle password setup
  let userPassword = password;
  let passwordResetToken = null; // raw token, emailed only

  if (sendWelcomeEmail) {
    // Generate reset token for password creation
    passwordResetToken = passwordResetService.generateResetToken();
    // Password will be set when user creates it via the reset link
    userPassword = undefined;
  } else if (!userPassword) {
    throw new AppError('Either provide a password or set sendWelcomeEmail to true', 400);
  }

  // Find the default workspace to add the user to
  const Workspace = (await import('../models/Workspace.js')).default;
  const defaultWorkspace = await Workspace.findOne({
    tenantId: req.tenantId,
    isDefault: true,
  });

  const user = await User.create({
    tenantId: req.tenantId,
    activeTenantId: req.tenantId,
    email: email.toLowerCase(),
    username: username ? username.toLowerCase().trim() : undefined,
    password: userPassword,
    passwordResetToken: passwordResetToken
      ? passwordResetService.hashToken(passwordResetToken)
      : null,
    passwordResetExpires: sendWelcomeEmail ? new Date(Date.now() + 2 * 60 * 60 * 1000) : null,
    role: roleId,
    manager: manager || null,
    workspaceIds: defaultWorkspace ? [defaultWorkspace._id] : [],
    createdBy: req.user._id,
    invitedBy: req.user._id,
    ...rest,
  });

  // Add user to the default workspace's memberIds
  if (defaultWorkspace) {
    await Workspace.updateOne(
      { _id: defaultWorkspace._id },
      { $addToSet: { memberIds: user._id } }
    );
  }

  // Send password creation email if requested
  if (sendWelcomeEmail) {
    try {
      const appUrl = process.env.APP_URL || 'http://localhost:3000';
      await passwordResetService.sendPasswordResetEmail(user.email, passwordResetToken, appUrl);
    } catch (emailError) {
      logger.error(`Failed to send password creation email to ${user.email}:`, emailError);
      // Don't fail user creation if email sending fails
    }
  }

  await req.tenant.updateOne({ $inc: { 'usage.users': 1 } });

  // Validate user permissions are properly configured
  try {
    const permValidation = await validateUserPermissions(user._id, req.tenantId);
    if (!permValidation.valid) {
      logger.warn(`Permission issues for new user ${user.email}:`, permValidation.errors);
    }
  } catch (permError) {
    logger.warn(`Permission validation warning for user ${user.email}:`, permError);
  }

  await audit({
    tenantId: req.tenantId,
    userId: req.user._id,
    action: 'user_invite',
    resource: 'User',
    resourceId: user._id,
    req,
  });

  const userResponse = user.toObject();
  delete userResponse.password;
  delete userResponse.passwordResetToken;
  sendSuccess(res, { data: userResponse }, 'User created', 201);
});

const updateUser = asyncHandler(async (req, res) => {
  const user = await User.findOne({
    _id: req.params.id,
    tenantId: req.tenantId,
  });
  if (!user) throw new AppError('User not found.', 404);

  // Prevent demoting the only superuser
  if (
    user.role?.name === 'superuser' &&
    req.body.role &&
    req.body.role.name !== 'superuser'
  ) {
    const superuserCount = await User.countDocuments({
      tenantId: req.tenantId,
      role: { name: 'superuser' },
    });
    if (superuserCount <= 1)
      throw new AppError('Cannot demote the only superuser in this tenant. At least one superuser must exist.', 403);
  }

  const allowedFields = [
    'firstName',
    'lastName',
    'title',
    'department',
    'phone',
    'avatar',
    'roles',
    'status',
    'preferences',
    'manager',
  ];
  allowedFields.forEach((key) => {
    if (req.body[key] !== undefined) user[key] = req.body[key];
  });

  await user.save();

  await audit({
    tenantId: req.tenantId,
    userId: req.user._id,
    action: 'update',
    resource: 'User',
    resourceId: user._id,
    req,
  });

  sendSuccess(res, { data: user }, 'User updated');
});

const deactivateUser = asyncHandler(async (req, res) => {
  const user = await User.findOne({
    _id: req.params.id,
    tenantId: req.tenantId,
  });
  if (!user) throw new AppError('User not found.', 404);
  if (user._id.toString() === req.user._id.toString())
    throw new AppError('Cannot deactivate yourself.', 403);

  // Prevent deactivating the only superuser
  const superId = await superuserRoleId(req.tenantId);
  if (superId && String(roleIdOf(user)) === String(superId)) {
    const superuserCount = await User.countDocuments({
      tenantId: req.tenantId,
      role: superId,
    });
    if (superuserCount <= 1)
      throw new AppError('Cannot deactivate the only superuser in this tenant.', 403);
  }

  user.status = 'inactive';
  await user.save();
  await req.tenant.updateOne({ $inc: { 'usage.users': -1 } });

  // Invalidate all sessions for the deactivated user.
  const Session = (await import('../models/Session.js')).default;
  await Session.deleteMany({ userId: user._id });

  await audit({
    tenantId: req.tenantId,
    userId: req.user._id,
    action: 'user_deactivate',
    resource: 'User',
    resourceId: user._id,
    req,
  });

  sendSuccess(res, {}, 'User deactivated');
});

const updateMyProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (!user) throw new AppError('User not found.', 404);

  // Only allow users to update their own personal information
  const allowed = [
    'firstName',
    'lastName',
    'title',
    'department',
    'phone',
    'gender',
    'bio',
    'preferences',
  ];

  allowed.forEach((key) => {
    if (req.body[key] === undefined) return;
    if (key === 'preferences' && req.body.preferences && typeof req.body.preferences === 'object') {
      // Merge rather than replace, so a partial update ({ theme: 'dark' })
      // can't wipe other keys such as the welcome-tour progress. Nested
      // groups (notifications, onboarding) merge one level deep.
      const current = user.preferences?.toObject?.() || user.preferences || {};
      const merged = { ...current };
      for (const [k, v] of Object.entries(req.body.preferences)) {
        const isGroup = v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
        merged[k] = isGroup && current[k] && typeof current[k] === 'object'
          ? { ...current[k], ...v }
          : v;
      }
      user.preferences = merged;
      return;
    }
    user[key] = req.body[key];
  });

  // Handle avatar upload
  if (req.file) {
    const avatarDataUri = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    user.avatar = avatarDataUri;
  }

  await user.save();

  await audit({
    tenantId: req.tenantId,
    userId: user._id,
    userEmail: user.email,
    action: 'profile_update',
    resource: 'User',
    resourceId: user._id,
    req,
  });

  sendSuccess(res, { data: user }, 'Profile updated');
});

/**
 * POST /api/users/:id/reset-password
 * Admin sets a new temporary password for a user.
 * Body: { newPassword }
 */
const resetUserPassword = asyncHandler(async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 8) {
    throw new AppError('Password must be at least 8 characters.', 400);
  }

  const user = await User.findOne({
    _id: req.params.id,
    tenantId: req.tenantId,
  });
  if (!user) throw new AppError('User not found.', 404);

  user.password = newPassword; // pre-save hook will hash it
  user.failedLoginAttempts = 0;
  user.lockedUntil = undefined;
  await user.save();

  // Destroy all active sessions for this user so they must log in fresh
  const Session = (await import('../models/Session.js')).default;
  await Session.deleteMany({ userId: user._id });

  await audit({
    tenantId: req.tenantId,
    userId: req.user._id,
    action: 'password_reset',
    resource: 'User',
    resourceId: user._id,
    req,
  });

  sendSuccess(
    res,
    {},
    'Password reset successfully. User sessions have been invalidated.',
  );
});

/**
 * GET /api/users/:id/record
 * Returns a user as a flat record object (standard fields + profileData).
 * Also ensures the user ObjectMeta exists.
 */
const getUserRecord = asyncHandler(async (req, res) => {
  const user = await User.findOne({
    _id: req.params.id,
    tenantId: req.tenantId,
  })
    .select('-password -emailVerificationToken -passwordResetToken')
    .populate('role', 'name label');
  if (!user) throw new AppError('User not found.', 404);

  // Ensure the user object metadata exists
  await ensureUserObject(req.tenantId, req.user._id);

  // Merge standard fields + custom profileData into a flat record
  const profileData = user.profileData
    ? Object.fromEntries(user.profileData)
    : {};
  const record = {
    id: user._id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    phone: user.phone || '',
    title: user.title || '',
    department: user.department || '',
    gender: user.gender || '',
    status: user.status,
    role: user.role?._id || user.role || null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    ...profileData,
  };

  sendSuccess(res, { data: record });
});

/**
 * PUT /api/users/:id/record
 * Updates a user from a flat record payload.
 * Standard fields → User model; unknown fields → profileData.
 */
const updateUserRecord = asyncHandler(async (req, res) => {
  const user = await User.findOne({
    _id: req.params.id,
    tenantId: req.tenantId,
  });
  if (!user) throw new AppError('User not found.', 404);

  const STANDARD_FIELDS = [
    'firstName',
    'lastName',
    'email',
    'phone',
    'title',
    'department',
    'gender',
    'status',
    'role',
    'manager',
  ];

  const customUpdates = {};
  for (const [key, val] of Object.entries(req.body)) {
    if (STANDARD_FIELDS.includes(key)) {
      if (key === 'role') {
        // Guard: prevent demoting the last superuser
        const superId = await superuserRoleId(req.tenantId);
        const nextRoleId = val?._id || val;
        if (
          superId &&
          String(roleIdOf(user)) === String(superId) &&
          String(nextRoleId) !== String(superId)
        ) {
          const count = await User.countDocuments({
            tenantId: req.tenantId,
            role: superId,
          });
          if (count <= 1)
            throw new AppError('Cannot demote the only superuser in this tenant. At least one superuser must exist.', 403);
        }
      }
      user[key] = val;
    } else if (
      !['id', '_id', 'tenantId', 'createdAt', 'updatedAt'].includes(key)
    ) {
      customUpdates[key] = val;
    }
  }

  // Merge profileData
  if (Object.keys(customUpdates).length > 0) {
    if (!user.profileData) user.profileData = new Map();
    Object.entries(customUpdates).forEach(([k, v]) =>
      user.profileData.set(k, v),
    );
    user.markModified('profileData');
  }

  await user.save();

  await audit({
    tenantId: req.tenantId,
    userId: req.user._id,
    action: 'update',
    resource: 'User',
    resourceId: user._id,
    req,
  });

  sendSuccess(res, { data: { id: user._id, ...req.body } }, 'User updated');
});

/**
 * GET /api/users/role/:roleId
 * Returns users assigned to the specified role within the tenant.
 */
const getUsersByRole = asyncHandler(async (req, res) => {
  const users = await User.find({
    tenantId: req.tenantId,
    role: req.params.roleId,
    status: 'active',
  })
    .select('firstName lastName email title department status createdAt')
    .sort({ firstName: 1 });
  sendSuccess(res, { data: users });
});

/**
 * POST /api/users/me/verify-password
 * Verifies the current password without changing it.
 */
const verifyMyPassword = asyncHandler(async (req, res) => {
  const { currentPassword } = req.body;

  if (!currentPassword) {
    throw new AppError('Current password is required.', 400);
  }

  const user = await User.findById(req.user._id).select('+password');
  if (!user) throw new AppError('User not found.', 404);

  const isMatch = await user.comparePassword(currentPassword);
  if (!isMatch) throw new AppError('Current password is incorrect.', 401);

  await audit({
    tenantId: req.tenantId,
    userId: user._id,
    userEmail: user.email,
    action: 'password_verify',
    req,
  });

  sendSuccess(res, {}, 'Password verified successfully.');
});

/**
 * POST /api/users/me/change-password
 * Allows user to change their password by verifying current password.
 */
const changeMyPassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    throw new AppError('Current password and new password are required.', 400);
  }

  if (newPassword.length < 8) {
    throw new AppError('Password must be at least 8 characters long.', 400);
  }

  if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/.test(newPassword)) {
    throw new AppError(
      'Password must contain uppercase, lowercase, number, and special character.',
      400,
    );
  }

  const user = await User.findById(req.user._id).select('+password');
  if (!user) throw new AppError('User not found.', 404);

  const isMatch = await user.comparePassword(currentPassword);
  if (!isMatch) throw new AppError('Current password is incorrect.', 401);

  user.password = newPassword;
  await user.save();

  // Destroy all active sessions so user must log in again
  const Session = (await import('../models/Session.js')).default;
  await Session.deleteMany({ userId: user._id });

  await audit({
    tenantId: req.tenantId,
    userId: user._id,
    userEmail: user.email,
    action: 'password_change',
    resource: 'User',
    resourceId: user._id,
    req,
  });

  sendSuccess(res, {}, 'Password changed successfully. Please log in again.');
});

/**
 * POST /api/users/me/request-password-reset
 * Sends a password reset link to the user's email.
 */
const requestPasswordReset = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (!user) throw new AppError('User not found.', 404);

  // Use the password reset service to generate token and send email
  const passwordResetService = (
    await import('../services/passwordResetService.js')
  ).default;

  const resetToken = passwordResetService.generateResetToken();
  const resetTokenExpires = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours

  user.passwordResetToken = passwordResetService.hashToken(resetToken);
  user.passwordResetExpires = resetTokenExpires;
  await user.save();

  // Send reset email in background
  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  passwordResetService.sendPasswordResetEmail(user.email, resetToken, appUrl).catch((err) => {
    logger.error('Failed to send password reset email:', err);
  });

  await audit({
    tenantId: req.tenantId,
    userId: user._id,
    userEmail: user.email,
    action: 'password_reset_requested',
    req,
  });

  sendSuccess(
    res,
    {},
    'Password reset link sent to your email. Please check your inbox.',
  );
});

const getUserPublicProfile = asyncHandler(async (req, res) => {
  const user = await User.findOne({
    _id: req.params.id,
    tenantId: req.tenantId,
  })
    .select('_id firstName lastName email avatar status createdAt');
  if (!user) throw new AppError('User not found.', 404);
  sendSuccess(res, { data: user });
});

export {
  listUsers,
  getUser,
  createUser,
  updateUser,
  deactivateUser,
  updateMyProfile,
  getUserRecord,
  updateUserRecord,
  getUsersByRole,
  resetUserPassword,
  verifyMyPassword,
  changeMyPassword,
  requestPasswordReset,
  getUserPublicProfile,
};
