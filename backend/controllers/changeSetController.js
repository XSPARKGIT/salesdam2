import ChangeSet from '../models/ChangeSet.js';
import DeploymentLog from '../models/DeploymentLog.js';
import changeSetService from '../services/changeSetService.js';
import { hasSystemPermission } from '../services/systemPermissionService.js';
import { asyncHandler, sendSuccess, AppError } from '../utils/errors.js';

const createChangeSet = asyncHandler(async (req, res) => {
  const { name, description, components } = req.body || {};
  const changeSet = await changeSetService.build({
    tenantId: req.tenantId,
    name,
    description,
    components,
    user: req.user,
  });
  sendSuccess(res, { data: changeSet }, 'Change set created', 201);
});

const listChangeSets = asyncHandler(async (req, res) => {
  const data = await ChangeSet.find({ tenantId: req.tenantId }).sort({
    createdAt: -1,
  });
  sendSuccess(res, { data });
});

const getChangeSet = asyncHandler(async (req, res) => {
  const changeSet = await ChangeSet.findOne({
    _id: req.params.id,
    tenantId: req.tenantId,
  });
  if (!changeSet) throw new AppError('Change set not found.', 404);
  sendSuccess(res, { data: changeSet });
});

const validateChangeSet = asyncHandler(async (req, res) => {
  const changeSet = await ChangeSet.findOne({
    _id: req.params.id,
    tenantId: req.tenantId,
  });
  if (!changeSet) throw new AppError('Change set not found.', 404);
  const { targetTenantId } = req.body || {};
  if (!targetTenantId) throw new AppError('targetTenantId is required.', 400);

  const result = await changeSetService.validate({ changeSet, targetTenantId });
  changeSet.validations.push({
    by: req.user._id,
    targetTenantId,
    valid: result.valid,
    missing: result.missing,
  });
  changeSet.status = result.valid ? 'validated' : 'failed';
  await changeSet.save();

  sendSuccess(
    res,
    { data: result },
    result.valid ? 'Dependencies satisfied' : 'Dependencies missing',
  );
});

const deployChangeSet = asyncHandler(async (req, res) => {
  const changeSet = await ChangeSet.findOne({
    _id: req.params.id,
    tenantId: req.tenantId,
  });
  if (!changeSet) throw new AppError('Change set not found.', 404);
  const { targetTenantId } = req.body || {};
  if (!targetTenantId) throw new AppError('targetTenantId is required.', 400);
  await assertCanDeployCode(req.user, changeSet.components);

  const result = await changeSetService.deploy({
    changeSet,
    targetTenantId,
    user: req.user,
  });
  sendSuccess(res, { data: result }, 'Change set deployed', 201);
});

const deploymentLog = asyncHandler(async (req, res) => {
  const { targetTenantId } = req.query;
  if (!targetTenantId) {
    throw new AppError('targetTenantId is required.', 400);
  }
  const result = await changeSetService.listDeploymentLog({
    tenantId: targetTenantId,
    limit: req.query.limit,
    skip: req.query.skip,
  });
  sendSuccess(res, {
    data: result.items,
    meta: { total: result.total, limit: result.limit, skip: result.skip },
  });
});

const rollbackDeployment = asyncHandler(async (req, res) => {
  const log = await DeploymentLog.findById(req.params.logId);
  if (!log) throw new AppError('Deployment log not found.', 404);
  const result = await changeSetService.rollback({ log, user: req.user });
  sendSuccess(res, { data: result }, 'Deployment rolled back');
});

const cloneSandbox = asyncHandler(async (req, res) => {
  const { sourceTenantId, name } = req.body || {};
  const result = await changeSetService.cloneConfiguration({
    sourceTenantId: sourceTenantId || req.tenantId,
    name,
    user: req.user,
  });
  sendSuccess(
    res,
    { data: result },
    `Sandbox tenant created (${result.componentCount} components)`,
    201,
  );
});

// Custom code needs the Deploy Custom Code right on top of deployment itself.
const assertCanDeployCode = async (user, components = []) => {
  if (components.some((c) => c.componentType === 'custom_code') && !(await hasSystemPermission(user, 'canDeployCustomCode'))) {
    throw new AppError('Deploying custom code requires the Deploy Custom Code permission.', 403);
  }
};

const exportChangeSet = asyncHandler(async (req, res) => {
  const changeSet = await ChangeSet.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!changeSet) throw new AppError('Change set not found.', 404);
  sendSuccess(res, { data: await changeSetService.exportPackage({ changeSet }) }, 'Package exported');
});

const importChangeSet = asyncHandler(async (req, res) => {
  const pkg = req.body?.package;
  await assertCanDeployCode(req.user, Array.isArray(pkg?.components) ? pkg.components : []);
  const changeSet = await changeSetService.importPackage({ pkg, tenantId: req.tenantId, user: req.user });
  sendSuccess(res, { data: changeSet }, 'Package imported as a change set', 201);
});

const deleteSandboxTenant = asyncHandler(async (req, res) => {
  const result = await changeSetService.deleteSandbox({
    tenantId: req.params.id,
    confirmName: req.body?.confirmName,
    currentTenantIds: [req.tenantId, req.user?.tenantId].filter(Boolean),
  });
  sendSuccess(res, { data: result }, 'Sandbox deleted');
});

export {
  exportChangeSet,
  importChangeSet,
  deleteSandboxTenant,
  createChangeSet,
  listChangeSets,
  getChangeSet,
  validateChangeSet,
  deployChangeSet,
  deploymentLog,
  rollbackDeployment,
  cloneSandbox,
};
