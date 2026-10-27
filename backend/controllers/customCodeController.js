import CustomCode from '../models/CustomCode.js';
import customCodeService from '../services/customCodeService.js';
import { asyncHandler, sendSuccess, AppError } from '../utils/errors.js';

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
  sendSuccess(res, { data: doc }, 'Created', 201);
});

const addVersion = asyncHandler(async (req, res) => {
  const { code, inputs, changeNote } = req.body || {};
  if (!code) throw new AppError('code is required.', 400);
  const doc = await customCodeService.addVersion(req.tenantId, req.params.name, { code, inputs, changeNote }, req.user);
  sendSuccess(res, { data: doc }, 'Version added');
});

const activate = asyncHandler(async (req, res) => {
  const { version } = req.body || {};
  if (!version) throw new AppError('version is required.', 400);
  const doc = await customCodeService.activateVersion(req.tenantId, req.params.name, Number(version), req.user);
  sendSuccess(res, { data: doc }, 'Version activated');
});

const execute = asyncHandler(async (req, res) => {
  const { inputs, record } = req.body || {};
  const result = await customCodeService.executeCustomCode(req.tenantId, req.params.name, inputs || {}, { record });
  sendSuccess(res, { data: result }, 'Executed');
});

const remove = asyncHandler(async (req, res) => {
  const doc = await CustomCode.findOneAndDelete({ tenantId: req.tenantId, name: req.params.name });
  if (!doc) throw new AppError('Custom code not found.', 404);
  sendSuccess(res, { data: null }, 'Deleted');
});

export { list, get, create, addVersion, activate, execute, remove };