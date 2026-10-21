import EmailSender from '../models/EmailSender.js';
import { asyncHandler, sendSuccess, AppError } from '../utils/errors.js';
import { audit } from '../utils/auditLogger.js';

/** GET /api/email-senders */
const listEmailSenders = asyncHandler(async (req, res) => {
  const senders = await EmailSender.find({ tenantId: req.tenantId })
    .populate('allowedUserIds', 'firstName lastName email')
    .sort({ isDefault: -1, name: 1 });
  sendSuccess(res, { data: senders });
});

/**
 * GET /api/email-senders/mine
 * Returns senders the current user is allowed to use.
 */
const myEmailSenders = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const senders = await EmailSender.find({
    tenantId: req.tenantId,
    isActive: true,
    $or: [
      { availableTo: 'all' },
      { availableTo: 'specific_users', allowedUserIds: userId },
    ],
  }).select('-smtpUser -smtpPass').sort({ isDefault: -1, name: 1 });
  sendSuccess(res, { data: senders });
});

/** POST /api/email-senders */
const createEmailSender = asyncHandler(async (req, res) => {
  const { name, email, replyTo, smtpHost, smtpPort, smtpSecure,
          smtpUser, smtpPass, isDefault, availableTo, allowedUserIds } = req.body;

  if (!name?.trim()) throw new AppError('Name is required.', 400);
  if (!email?.trim()) throw new AppError('Email address is required.', 400);

  // Only one default per tenant
  if (isDefault) {
    await EmailSender.updateMany({ tenantId: req.tenantId }, { isDefault: false });
  }

  const sender = await EmailSender.create({
    tenantId: req.tenantId,
    name: name.trim(),
    email: email.trim().toLowerCase(),
    replyTo: replyTo?.trim().toLowerCase() || undefined,
    smtpHost: smtpHost?.trim() || undefined,
    smtpPort: smtpPort || 587,
    smtpSecure: !!smtpSecure,
    smtpUser: smtpUser?.trim() || undefined,
    smtpPass: smtpPass || undefined,
    isDefault: !!isDefault,
    availableTo: availableTo || 'all',
    allowedUserIds: availableTo === 'specific_users' ? (allowedUserIds || []) : [],
    createdBy: req.user._id,
  });

  await audit({
    tenantId: req.tenantId, userId: req.user._id,
    action: 'create', resource: 'EmailSender', resourceId: sender._id, req,
  });

  // Return without sensitive fields
  const safe = sender.toObject();
  delete safe.smtpUser; delete safe.smtpPass;
  sendSuccess(res, { data: safe }, 'Email sender created', 201);
});

/** PUT /api/email-senders/:id */
const updateEmailSender = asyncHandler(async (req, res) => {
  const sender = await EmailSender.findOne({ _id: req.params.id, tenantId: req.tenantId })
    .select('+smtpUser +smtpPass');
  if (!sender) throw new AppError('Email sender not found.', 404);

  const { name, email, replyTo, smtpHost, smtpPort, smtpSecure,
          smtpUser, smtpPass, isActive, isDefault, availableTo, allowedUserIds } = req.body;

  // Only one default per tenant
  if (isDefault && !sender.isDefault) {
    await EmailSender.updateMany({ tenantId: req.tenantId, _id: { $ne: sender._id } }, { isDefault: false });
  }

  if (name       !== undefined) sender.name       = name.trim();
  if (email      !== undefined) sender.email      = email.trim().toLowerCase();
  if (replyTo    !== undefined) sender.replyTo    = replyTo?.trim().toLowerCase() || undefined;
  if (smtpHost   !== undefined) sender.smtpHost   = smtpHost?.trim() || undefined;
  if (smtpPort   !== undefined) sender.smtpPort   = smtpPort || 587;
  if (smtpSecure !== undefined) sender.smtpSecure = !!smtpSecure;
  // Only update credentials if explicitly provided (empty string = clear)
  if (smtpUser !== undefined) sender.smtpUser = smtpUser?.trim() || undefined;
  if (smtpPass !== undefined) sender.smtpPass = smtpPass || undefined;
  if (isActive   !== undefined) sender.isActive   = !!isActive;
  if (isDefault  !== undefined) sender.isDefault  = !!isDefault;
  if (availableTo !== undefined) {
    sender.availableTo   = availableTo;
    sender.allowedUserIds = availableTo === 'specific_users' ? (allowedUserIds || []) : [];
  }

  sender.lastModifiedBy = req.user._id;
  await sender.save();

  await audit({
    tenantId: req.tenantId, userId: req.user._id,
    action: 'update', resource: 'EmailSender', resourceId: sender._id, req,
  });

  const safe = sender.toObject();
  delete safe.smtpUser; delete safe.smtpPass;
  sendSuccess(res, { data: safe }, 'Email sender updated');
});

/** DELETE /api/email-senders/:id */
const deleteEmailSender = asyncHandler(async (req, res) => {
  const sender = await EmailSender.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!sender) throw new AppError('Email sender not found.', 404);

  await sender.deleteOne();

  await audit({
    tenantId: req.tenantId, userId: req.user._id,
    action: 'delete', resource: 'EmailSender', resourceId: sender._id, req,
  });

  sendSuccess(res, {}, 'Email sender deleted');
});

/**
 * POST /api/email-senders/:id/test
 * Sends a test email using the configured SMTP settings.
 */
const testEmailSender = asyncHandler(async (req, res) => {
  const sender = await EmailSender.findOne({ _id: req.params.id, tenantId: req.tenantId })
    .select('+smtpUser +smtpPass');
  if (!sender) throw new AppError('Email sender not found.', 404);
  if (!sender.smtpHost) throw new AppError('No SMTP host configured.', 400);

  const { to } = req.body;
  if (!to) throw new AppError('Recipient email address (to) is required.', 400);

  try {
    const nodemailer = (await import('nodemailer')).default;
    const transporter = nodemailer.createTransport({
      host:   sender.smtpHost,
      port:   sender.smtpPort || 587,
      secure: sender.smtpSecure,
      auth:   sender.smtpUser ? { user: sender.smtpUser, pass: sender.smtpPass || '' } : undefined,
    });

    await transporter.sendMail({
      from:    `"${sender.name}" <${sender.email}>`,
      replyTo: sender.replyTo || undefined,
      to,
      subject: 'Test email from Salesdam',
      text:    `This is a test email from the "${sender.name}" sender configuration.\n\nIf you received this, the SMTP settings are working correctly.`,
    });

    sendSuccess(res, {}, `Test email sent to ${to}`);
  } catch (err) {
    throw new AppError(`Failed to send test email: ${err.message}`, 422);
  }
});

export { listEmailSenders, myEmailSenders, createEmailSender, updateEmailSender, deleteEmailSender, testEmailSender };
