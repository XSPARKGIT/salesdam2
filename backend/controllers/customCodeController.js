import CustomCode from '../models/CustomCode.js';
import customCodeService from '../services/customCodeService.js';
import { asyncHandler, sendSuccess, AppError } from '../utils/errors.js';
import { audit } from '../utils/auditLogger.js';

const list = asyncHandler(async (req, res) => {
  const data = await CustomCode.find({ tenantId: req.tenantId }).sort({ name: 1 });
  sendSuccess(res, { data });
});

const get = asyncHandler(async (req, res) => {
  const doc = await CustomCode.findOne({ tenantId: req.tenantId, name: req.params.name });
  if (!doc) throw new AppError('Custom code not found.', 404);
  sendSuccess(res, { data: doc });
});

const create = asyncHandler(async (req, res) => {
  const { name, description, code, inputs } = req.body || {};
  if (!name || !code) throw new AppError('name and code are required.', 400);
  const doc = await customCodeService.createCustomCode(req.tenantId, { name, description, code, inputs }, req.user);
  await audit({
    tenantId: req.tenantId,
    userId: req.user._id,
    action: 'create',
    resource: 'CustomCode',
    resourceId: doc._id,
    details: { name },
    req,
  });
  sendSuccess(res, { data: doc }, 'Created', 201);
});

const addVersion = asyncHandler(async (req, res) => {
  const { code, inputs, changeNote } = req.body || {};
  if (!code) throw new AppError('code is required.', 400);
  const doc = await customCodeService.addVersion(req.tenantId, req.params.name, { code, inputs, changeNote }, req.user);
  await audit({
    tenantId: req.tenantId,
    userId: req.user._id,
    action: 'custom_code_deploy',
    resource: 'CustomCode',
    resourceId: doc._id,
    details: { name: req.params.name, changeNote },
    req,
  });
  sendSuccess(res, { data: doc }, 'Version added');
});

const activate = asyncHandler(async (req, res) => {
  const { version } = req.body || {};
  if (!version) throw new AppError('version is required.', 400);
  const doc = await customCodeService.activateVersion(req.tenantId, req.params.name, Number(version), req.user);
  await audit({
    tenantId: req.tenantId,
    userId: req.user._id,
    action: 'custom_code_activate',
    resource: 'CustomCode',
    resourceId: doc._id,
    details: { name: req.params.name, version: Number(version) },
    req,
  });
  sendSuccess(res, { data: doc }, 'Version activated');
});

const execute = asyncHandler(async (req, res) => {
  const { inputs, record, testMode } = req.body || {};
  const result = await customCodeService.executeCustomCode(req.tenantId, req.params.name, inputs || {}, { record, testMode: !!testMode, userId: req.user._id });
  sendSuccess(res, { data: result }, 'Executed');
});

const remove = asyncHandler(async (req, res) => {
  const doc = await CustomCode.findOneAndDelete({ tenantId: req.tenantId, name: req.params.name });
  if (!doc) throw new AppError('Custom code not found.', 404);
  await audit({
    tenantId: req.tenantId,
    userId: req.user._id,
    action: 'delete',
    resource: 'CustomCode',
    resourceId: doc._id,
    details: { name: req.params.name },
    req,
  });
  sendSuccess(res, { data: null }, 'Deleted');
});

const restore = asyncHandler(async (req, res) => {
  const { version } = req.body || {};
  if (!version) throw new AppError('version is required.', 400);
  const doc = await customCodeService.restoreVersion(req.tenantId, req.params.name, Number(version), req.user);
  await audit({
    tenantId: req.tenantId,
    userId: req.user._id,
    action: 'custom_code_restore',
    resource: 'CustomCode',
    resourceId: doc._id,
    details: { name: req.params.name, version: Number(version) },
    req,
  });
  sendSuccess(res, { data: doc }, 'Version restored');
});

export { list, get, create, addVersion, activate, execute, remove, restore };