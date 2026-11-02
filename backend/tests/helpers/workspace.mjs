import Workspace from '../../models/Workspace.js';
import User from '../../models/User.js';

/**
 * Test fixture: users only reach objects through their active workspace
 * (services/objectAccessService.js), so e2e tests put their seeded users in a
 * workspace holding the objects the test exercises. Returns the workspace.
 * The workspace is removed with the tenant's other documents (tenantId).
 */
export const seedWorkspace = async (tenantId, userIds, objectApiNames, name = 'Test Workspace') => {
  const ws = await Workspace.create({
    tenantId,
    name,
    apiName: `test_ws_${Date.now().toString(36)}`,
    status: 'active',
    memberIds: userIds,
    allowedObjects: objectApiNames,
  });
  await User.updateMany({ _id: { $in: userIds } }, { $addToSet: { workspaceIds: ws._id } });
  return ws;
};
