import Workspace from '../models/Workspace.js';
import User from '../models/User.js';
import { asyncHandler, sendSuccess, AppError } from '../utils/errors.js';
import { audit } from '../utils/auditLogger.js';

/* ── GET /api/workspaces ─────────────────────────────────────────────────── */
const listWorkspaces = asyncHandler(async (req, res) => {
  const workspaces = await Workspace.find({
    tenantId: req.tenantId,
    status: { $ne: 'deleted' },
  })
    .populate('memberIds', 'firstName lastName email avatar status')
    .sort({ isDefault: -1, name: 1 });
  sendSuccess(res, { data: workspaces });
});

/* ── GET /api/workspaces/mine ──────────────────────────────────────────────
   Returns only workspaces this user is a member of. */
const myWorkspaces = asyncHandler(async (req, res) => {
  const workspaces = await Workspace.find({
    tenantId: req.tenantId,
    status: 'active',
    $or: [
      { memberIds: req.user._id },
      { isDefault: true }, // default workspace is available to everyone
    ],
  }).sort({ isDefault: -1, name: 1 });
  sendSuccess(res, { data: workspaces });
});

/* ── GET /api/workspaces/:id ─────────────────────────────────────────────── */
const getWorkspace = asyncHandler(async (req, res) => {
  const ws = await Workspace.findOne({
    _id: req.params.id,
    tenantId: req.tenantId,
  })
    .populate('memberIds', 'firstName lastName email avatar status role')
    .populate({
      path: 'memberIds',
      populate: { path: 'role', select: 'name label' },
    });
  if (!ws) throw new AppError('Workspace not found.', 404);
  sendSuccess(res, { data: ws });
});

/* ── POST /api/workspaces ────────────────────────────────────────────────── */
const createWorkspace = asyncHandler(async (req, res) => {
  const { name, apiName, description, color, icon, settings, allowedObjects } =
    req.body;
  if (!name?.trim()) throw new AppError('Name is required.', 400);

  const trimmedName = name.trim();

  const existing = await Workspace.findOne({
    tenantId: req.tenantId,
    name: trimmedName,
  });
  if (existing)
    throw new AppError(
      `A workspace with name "${trimmedName}" already exists.`,
      409,
    );

  // Only one default per tenant
  const isFirst = !(await Workspace.exists({ tenantId: req.tenantId }));

  const generateApiName = (name) => {
    return name
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_') // replace spaces with underscores
      .replace(/[^\w_]/g, ''); // remove non-alphanumeric chars except underscore
  };

  const ws = await Workspace.create({
    tenantId: req.tenantId,
    name: name.trim(),
    apiName: apiName?.trim() || generateApiName(name),
    description: description?.trim(),
    color: color || '#6366f1',
    icon: icon || 'Briefcase',
    isDefault: isFirst,
    settings: settings || {},
    allowedObjects: allowedObjects || [],
    memberIds: [req.user._id], // creator is automatically a member
    createdBy: req.user._id,
  });

  // Keep User.workspaceIds in sync
  await User.updateOne(
    { _id: req.user._id },
    { $addToSet: { workspaceIds: ws._id } },
  );

  await audit({
    tenantId: req.tenantId,
    userId: req.user._id,
    action: 'create',
    resource: 'Workspace',
    resourceId: ws._id,
    req,
  });
  sendSuccess(res, { data: ws }, 'Workspace created', 201);
});

/* ── PUT /api/workspaces/:id ─────────────────────────────────────────────── */
const updateWorkspace = asyncHandler(async (req, res) => {
  const ws = await Workspace.findOne({
    _id: req.params.id,
    tenantId: req.tenantId,
  });
  if (!ws) throw new AppError('Workspace not found.', 404);

  const {
    name,
    description,
    color,
    icon,
    settings,
    allowedObjects,
    defaultObjectApiName,
    isDefault,
  } = req.body;

  if (name !== undefined) ws.name = name.trim();
  if (description !== undefined) ws.description = description?.trim();
  if (color !== undefined) ws.color = color;
  if (icon !== undefined) ws.icon = icon;
  if (settings !== undefined) ws.settings = { ...ws.settings, ...settings };
  if (allowedObjects !== undefined) ws.allowedObjects = allowedObjects;
  if (defaultObjectApiName !== undefined) ws.defaultObjectApiName = defaultObjectApiName?.trim() || '';

  // Only one default — clear others first
  if (isDefault && !ws.isDefault) {
    await Workspace.updateMany(
      { tenantId: req.tenantId, _id: { $ne: ws._id } },
      { isDefault: false },
    );
    ws.isDefault = true;
  }

  ws.lastModifiedBy = req.user._id;
  await ws.save();

  await audit({
    tenantId: req.tenantId,
    userId: req.user._id,
    action: 'update',
    resource: 'Workspace',
    resourceId: ws._id,
    req,
  });
  sendSuccess(res, { data: ws }, 'Workspace updated');
});

/* ── DELETE /api/workspaces/:id ──────────────────────────────────────────── */
const deleteWorkspace = asyncHandler(async (req, res) => {
  const ws = await Workspace.findOne({
    _id: req.params.id,
    tenantId: req.tenantId,
  });
  if (!ws) throw new AppError('Workspace not found.', 404);
  if (ws.isDefault)
    throw new AppError('The default workspace cannot be deleted.', 400);

  ws.status = 'deleted';
  await ws.save();

  // Remove from all users
  await User.updateMany(
    { tenantId: req.tenantId },
    { $pull: { workspaceIds: ws._id } },
  );

  await audit({
    tenantId: req.tenantId,
    userId: req.user._id,
    action: 'delete',
    resource: 'Workspace',
    resourceId: ws._id,
    req,
  });
  sendSuccess(res, {}, 'Workspace deleted');
});

/* ── POST /api/workspaces/:id/members ────────────────────────────────────── */
const addMember = asyncHandler(async (req, res) => {
  const { userId } = req.body;
  if (!userId) throw new AppError('userId is required.', 400);

  const [ws, user] = await Promise.all([
    Workspace.findOne({ _id: req.params.id, tenantId: req.tenantId }),
    User.findOne({ _id: userId, tenantId: req.tenantId }),
  ]);

  if (!ws) throw new AppError('Workspace not found.', 404);
  if (!user) throw new AppError('User not found in this organisation.', 404);

  // Idempotent add
  if (!ws.memberIds.includes(userId)) ws.memberIds.push(userId);
  await ws.save();

  await User.updateOne(
    { _id: userId },
    { $addToSet: { workspaceIds: ws._id } },
  );

  await audit({
    tenantId: req.tenantId,
    userId: req.user._id,
    action: 'add_member',
    resource: 'Workspace',
    resourceId: ws._id,
    details: { userId },
    req,
  });
  sendSuccess(
    res,
    { data: { workspaceId: ws._id, userId } },
    'User added to workspace',
  );
});

/* ── DELETE /api/workspaces/:id/members/:userId ──────────────────────────── */
const removeMember = asyncHandler(async (req, res) => {
  const ws = await Workspace.findOne({
    _id: req.params.id,
    tenantId: req.tenantId,
  });
  if (!ws) throw new AppError('Workspace not found.', 404);

  ws.memberIds = ws.memberIds.filter(
    (id) => id.toString() !== req.params.userId,
  );
  await ws.save();

  await User.updateOne(
    { _id: req.params.userId },
    { $pull: { workspaceIds: ws._id } },
  );

  await audit({
    tenantId: req.tenantId,
    userId: req.user._id,
    action: 'remove_member',
    resource: 'Workspace',
    resourceId: ws._id,
    details: { userId: req.params.userId },
    req,
  });
  sendSuccess(res, {}, 'User removed from workspace');
});

/* ── PUT /api/workspaces/:id/object-groups ──────────────────────────────── */
const updateObjectGroups = asyncHandler(async (req, res) => {
  const ws = await Workspace.findOne({
    _id: req.params.id,
    tenantId: req.tenantId,
  });
  if (!ws) throw new AppError('Workspace not found.', 404);

  const { objectGroups } = req.body;
  if (!Array.isArray(objectGroups))
    throw new AppError('objectGroups must be an array.', 400);

  ws.objectGroups = objectGroups;
  ws.lastModifiedBy = req.user._id;
  await ws.save();

  await audit({
    tenantId: req.tenantId,
    userId: req.user._id,
    action: 'update_object_groups',
    resource: 'Workspace',
    resourceId: ws._id,
    req,
  });
  sendSuccess(res, { data: ws }, 'Object groups updated');
});

/* ── POST /api/workspaces/switch ─────────────────────────────────────────── */
const switchWorkspace = asyncHandler(async (req, res) => {
  const { workspaceId } = req.body;
  if (!workspaceId) throw new AppError('workspaceId is required.', 400);

  // Validate the workspace exists, belongs to this tenant, and the user is a member
  const ws = await Workspace.findOne({
    _id: workspaceId,
    tenantId: req.tenantId,
    status: 'active',
    $or: [{ memberIds: req.user._id }, { isDefault: true }],
  });

  if (!ws)
    throw new AppError('Workspace not found or you are not a member.', 403);

  // Persist to session
  await req.updateSession({ workspaceId: ws._id.toString() });

  sendSuccess(
    res,
    {
      data: {
        workspaceId: ws._id,
        name: ws.name,
        slug: ws.slug,
        color: ws.color,
        icon: ws.icon,
      },
    },
    'Workspace switched',
  );
});

export {
  listWorkspaces,
  myWorkspaces,
  getWorkspace,
  createWorkspace,
  updateWorkspace,
  deleteWorkspace,
  addMember,
  removeMember,
  updateObjectGroups,
  switchWorkspace,
};
