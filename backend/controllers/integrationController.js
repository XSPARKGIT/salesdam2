import Integration from '../models/Integration.js';
import { asyncHandler, sendSuccess, AppError } from '../utils/errors.js';
import logger from '../utils/logger.js';
import { audit } from '../utils/auditLogger.js';

/**
 * GET /api/integrations
 * List all integrations for a tenant
 */
const listIntegrations = asyncHandler(async (req, res) => {
  const { status, externalSystem } = req.query;

  const query = {
    tenantId: req.user.tenantId,
    isDeleted: false,
  };

  if (status) query.status = status;
  if (externalSystem) query.externalSystem = externalSystem;

  const integrations = await Integration.find(query)
    .select('-tokenHash -accessToken')
    .sort({ createdAt: -1 });

  sendSuccess(res, {
    data: integrations,
  });
});

/**
 * POST /api/integrations
 * Create a new integration
 */
const createIntegration = asyncHandler(async (req, res) => {
  const {
    name,
    description,
    externalSystem = 'custom',
    expiresAt,
    permissions = ['read'],
    metadata = {},
  } = req.body;

  if (!name) {
    throw new AppError('Integration name is required', 400);
  }

  const integration = new Integration({
    tenantId: req.user.tenantId,
    name,
    description,
    externalSystem,
    expiresAt,
    permissions,
    metadata,
    createdBy: req.user._id,
  });

  const token = integration.generateToken();
  await integration.save();

  await audit({
    tenantId: req.user.tenantId,
    userId: req.user._id,
    action: 'create',
    resource: 'Integration',
    resourceId: integration._id,
    details: { name, externalSystem },
    req,
  });

  sendSuccess(res, {
    data: {
      ...integration.toObject(),
      accessToken: token,
    },
    message: 'Integration created successfully. Save the token as it will not be shown again.',
  });
});

/**
 * GET /api/integrations/:id
 * Get a single integration by ID
 */
const getIntegration = asyncHandler(async (req, res) => {
  const integration = await Integration.findOne({
    _id: req.params.id,
    tenantId: req.user.tenantId,
    isDeleted: false,
  }).select('-tokenHash');

  if (!integration) {
    throw new AppError('Integration not found', 404);
  }

  sendSuccess(res, {
    data: integration,
  });
});

/**
 * PUT /api/integrations/:id
 * Update an integration
 */
const updateIntegration = asyncHandler(async (req, res) => {
  const { name, description, status, expiresAt, permissions, metadata } = req.body;

  const integration = await Integration.findOne({
    _id: req.params.id,
    tenantId: req.user.tenantId,
    isDeleted: false,
  });

  if (!integration) {
    throw new AppError('Integration not found', 404);
  }

  if (name) integration.name = name;
  if (description !== undefined) integration.description = description;
  if (status) integration.status = status;
  if (expiresAt) integration.expiresAt = expiresAt;
  if (permissions) integration.permissions = permissions;
  if (metadata) integration.metadata = { ...integration.metadata, ...metadata };

  await integration.save();

  await audit({
    tenantId: req.user.tenantId,
    userId: req.user._id,
    action: 'update',
    resource: 'Integration',
    resourceId: integration._id,
    details: { fields: Object.keys(req.body || {}) },
    req,
  });

  sendSuccess(res, {
    data: integration.toObject({ select: '-tokenHash -accessToken' }),
    message: 'Integration updated successfully.',
  });
});

/**
 * POST /api/integrations/:id/regenerate-token
 * Regenerate the access token for an integration
 */
const regenerateToken = asyncHandler(async (req, res) => {
  const integration = await Integration.findOne({
    _id: req.params.id,
    tenantId: req.user.tenantId,
    isDeleted: false,
  });

  if (!integration) {
    throw new AppError('Integration not found', 404);
  }

  const newToken = integration.generateToken();
  await integration.save();

  await audit({
    tenantId: req.user.tenantId,
    userId: req.user._id,
    action: 'api_credential_rotate',
    resource: 'Integration',
    resourceId: integration._id,
    details: { name: integration.name },
    req,
  });

  sendSuccess(res, {
    data: {
      ...integration.toObject(),
      accessToken: newToken,
    },
    message: 'Token regenerated successfully. Update the external system with the new token.',
  });
});

/**
 * DELETE /api/integrations/:id
 * Delete an integration (soft delete)
 */
const deleteIntegration = asyncHandler(async (req, res) => {
  const integration = await Integration.findOne({
    _id: req.params.id,
    tenantId: req.user.tenantId,
    isDeleted: false,
  });

  if (!integration) {
    throw new AppError('Integration not found', 404);
  }

  integration.isDeleted = true;
  await integration.save();

  await audit({
    tenantId: req.user.tenantId,
    userId: req.user._id,
    action: 'delete',
    resource: 'Integration',
    resourceId: integration._id,
    details: { name: integration.name },
    req,
  });

  sendSuccess(res, {
    message: 'Integration deleted successfully.',
  });
});

/**
 * POST /api/integrations/verify-token
 * Verify an access token (for external systems)
 * This is called by external systems or webhooks to validate access
 */
const verifyToken = asyncHandler(async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    throw new AppError('Missing authorization token', 401);
  }

  const integration = await Integration.findOne({
    accessToken: token,
    isDeleted: false,
  });

  if (!integration) {
    throw new AppError('Invalid token', 401);
  }

  if (integration.status !== 'active') {
    throw new AppError('Integration is inactive', 401);
  }

  if (integration.isExpired()) {
    throw new AppError('Token has expired', 401);
  }

  integration.recordUsage(req.ip);
  await integration.save();

  sendSuccess(res, {
    data: {
      valid: true,
      tenantId: integration.tenantId,
      permissions: integration.permissions,
      integrationName: integration.name,
    },
  });
});

export {
  listIntegrations,
  createIntegration,
  getIntegration,
  updateIntegration,
  regenerateToken,
  deleteIntegration,
  verifyToken,
};
