import mongoose from 'mongoose';
import User from '../models/User.js';
import Role from '../models/Role.js';
import ApproverGroup from '../models/ApproverGroup.js';
import ObjectSharingSetting from '../models/ObjectSharingSetting.js';
import SharingRule from '../models/SharingRule.js';

const isPrivileged = (user) =>
  user?.role?.name === 'superuser' || user?.role?.name === 'admin';

/**
 * All subordinates of `userId` via the existing User.manager field, recursively
 * (multi-level hierarchy). Returns ObjectIds excluding the user themself.
 */
export const getSubordinateIds = async (tenantId, userId) => {
  const result = [];
  const seen = new Set([String(userId)]);
  let frontier = [userId];

  // Guard against cycles / runaway depth.
  for (let depth = 0; depth < 25 && frontier.length; depth += 1) {
    const reports = await User.find({
      tenantId,
      manager: { $in: frontier },
      status: { $ne: 'inactive' },
    }).select('_id');

    frontier = [];
    for (const r of reports) {
      const id = String(r._id);
      if (!seen.has(id)) {
        seen.add(id);
        result.push(r._id);
        frontier.push(r._id);
      }
    }
  }

  return result;
};

/** Recursively walk up the manager chain (used for hierarchy write access). */
export const getManagerChainIds = async (tenantId, userId) => {
  const result = [];
  const seen = new Set([String(userId)]);
  let current = userId;

  for (let depth = 0; depth < 25; depth += 1) {
    const user = await User.findOne({ _id: current, tenantId }).select('manager');
    if (!user?.manager) break;
    const id = String(user.manager);
    if (seen.has(id)) break;
    seen.add(id);
    result.push(user.manager);
    current = user.manager;
  }

  return result;
};

export const getOwd = async (tenantId, objectApiName) => {
  if (!objectApiName) return null;
  return ObjectSharingSetting.findOne({ tenantId, objectApiName }).lean();
};

/**
 * Which sharing rules apply to this user, directly (shared with them / their
 * role) or through a public group they belong to.
 */
const getUserRuleTargetIds = async (user, tenantId) => {
  const roles = new Set();
  if (user.role?._id) roles.add(String(user.role._id));
  if (user.role?._id) {
    const r = await Role.findOne({ _id: user.role._id, tenantId }).select('parentRole');
    if (r?.parentRole) roles.add(String(r.parentRole));
  }

  const groups = await ApproverGroup.find({
    tenantId,
    $or: [
      { memberIds: user._id },
      ...(roles.size ? [{ roleIds: { $in: [...roles].map((id) => new mongoose.Types.ObjectId(id)) } }] : []),
    ],
  }).select('_id');

  return {
    userIds: [user._id],
    roleIds: [...roles].map((id) => new mongoose.Types.ObjectId(id)),
    groupIds: groups.map((g) => g._id),
  };
};

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Convert one sharing-rule condition into a Mongo query fragment over the
 * DynamicRecord.data map.
 */
const conditionToQuery = (condition) => {
  const key = `data.${condition.field}`;
  const v = condition.value;
  switch (condition.operator) {
    case 'ne':
      return { [key]: { $ne: v } };
    case 'in':
      return { [key]: { $in: Array.isArray(v) ? v : [v] } };
    case 'contains':
      return { [key]: { $regex: escapeRegex(v), $options: 'i' } };
    case 'startsWith':
      return { [key]: { $regex: `^${escapeRegex(v)}`, $options: 'i' } };
    case 'gt':
      return { [key]: { $gt: v } };
    case 'lt':
      return { [key]: { $lt: v } };
    case 'gte':
      return { [key]: { $gte: v } };
    case 'lte':
      return { [key]: { $lte: v } };
    case 'eq':
    default:
      return { [key]: v };
  }
};

const ruleCriteriaQuery = (rule) => {
  if (rule.ruleType === 'all' || !rule.criteria?.length) return {};
  const clauses = rule.criteria.map(conditionToQuery);
  return clauses.length === 1 ? clauses[0] : { $and: clauses };
};

export const hasRuleCriteriaValue = (rule) =>
  rule.ruleType === 'all' || (rule.criteria || []).length > 0;

/**
 * Returns the active sharing rules that grant the user access, optionally
 * filtered to a single access level.
 */
export const getApplicableRules = async (user, tenantId, objectApiName, accessLevels) => {
  if (!objectApiName) return [];
  const targets = await getUserRuleTargetIds(user, tenantId);
  const rules = await SharingRule.find({
    tenantId,
    objectApiName,
    isActive: true,
  }).lean();

  return rules.filter((rule) => {
    // A criteria rule with no usable conditions would otherwise compile to an
    // empty Mongo filter and match every record. Treat it as invalid rather
    // than silently granting org-wide access.
    if (rule.ruleType !== 'all') {
      const valid = (rule.criteria || []).filter(
        (c) => c && typeof c.field === 'string' && c.field.trim() !== '',
      );
      if (valid.length === 0) return false;
    }
    if (accessLevels && !accessLevels.includes(rule.accessLevel)) return false;
    const id = String(rule.sharedWith?.id);
    switch (rule.sharedWith?.type) {
      case 'user':
        return targets.userIds.some((u) => String(u) === id);
      case 'role':
        return targets.roleIds.some((r) => String(r) === id);
      case 'group':
        return targets.groupIds.some((g) => String(g) === id);
      default:
        return false;
    }
  });
};

/**
 * Mongo filter for records the user may READ on this object.
 *
 * Resolution order:
 *  1. Admin / superuser → all records.
 *  2. OWD public_read_only / public_read_write → all tenant records.
 *  3. OWD private → owned + hierarchy subordinates + matching sharing rules.
 *  4. No OWD row → legacy role.dataAccess behaviour (backwards compatible).
 *  5. Role dataAccess 'all' continues to grant full visibility.
 */
export const buildRecordAccessFilter = async (user, objectApiName) => {
  if (isPrivileged(user)) return {};

  const tenantId = user.tenantId;

  if (!objectApiName) {
    // Legacy callers without an object keep the old role-based scoping.
    return legacyRoleFilter(user, tenantId);
  }

  const role = user.role;
  if (role?.dataAccess === 'all') return {};

  const setting = await getOwd(tenantId, objectApiName);

  if (!setting) {
    // No OWD configured — preserve existing role dataAccess semantics.
    return legacyRoleFilter(user, tenantId);
  }

  if (
    setting.orgWideDefault === 'public_read_only' ||
    setting.orgWideDefault === 'public_read_write'
  ) {
    return {};
  }

  // OWD private
  const or = [
    { ownerId: user._id },
    { createdBy: user._id },
  ];

  const subordinateIds = await getSubordinateIds(tenantId, user._id);
  if (subordinateIds.length) or.push({ ownerId: { $in: subordinateIds } });

  // Managers also see records created by their reports.
  if (subordinateIds.length) or.push({ createdBy: { $in: subordinateIds } });

  const rules = await getApplicableRules(user, tenantId, objectApiName);
  for (const rule of rules) {
    or.push(ruleCriteriaQuery(rule));
  }

  return { $or: or };
};

/**
 * Mongo filter for records the user may WRITE (update/delete) on this object.
 */
export const buildRecordWriteFilter = async (user, objectApiName) => {
  if (isPrivileged(user)) return {};

  const tenantId = user.tenantId;
  const setting = objectApiName ? await getOwd(tenantId, objectApiName) : null;

  // Public Read-Write opens writes to all (object-level permission still applies
  // at the route layer).
  if (setting?.orgWideDefault === 'public_read_write') return {};

  const or = [{ ownerId: user._id }, { createdBy: user._id }];

  const subordinateIds = await getSubordinateIds(tenantId, user._id);
  if (subordinateIds.length) {
    or.push({ ownerId: { $in: subordinateIds } });
    or.push({ createdBy: { $in: subordinateIds } });
  }

  if (objectApiName) {
    const rules = await getApplicableRules(user, tenantId, objectApiName, ['readWrite']);
    for (const rule of rules) or.push(ruleCriteriaQuery(rule));
  } else {
    return legacyRoleFilter(user, tenantId);
  }

  return { $or: or };
};

/**
 * Legacy role-based scoping used before OWD was introduced.
 */
const legacyRoleFilter = async (user, tenantId) => {
  const role = user.role;
  if (!role) return { ownerId: user._id };
  if (role.dataAccess === 'all') return {};
  if (role.dataAccess === 'own_and_subordinates') {
    const subordinateIds = await getSubordinateIds(tenantId, user._id);
    return { ownerId: { $in: [user._id, ...subordinateIds] } };
  }
  return { ownerId: user._id };
};

/**
 * Explicit per-record check used by update/delete/restore paths. Returns
 * { canRead, canWrite, reason }.
 */
export const getRecordAccess = async (user, objectApiName, record) => {
  if (isPrivileged(user)) return { canRead: true, canWrite: true, reason: 'privileged' };
  if (!record) return { canRead: false, canWrite: false, reason: 'missing' };

  const ownerId = String(record.ownerId || '');
  const createdById = String(record.createdBy || '');
  const userId = String(user._id);

  if (ownerId === userId || createdById === userId) {
    return { canRead: true, canWrite: true, reason: 'owner' };
  }

  const setting = await getOwd(user.tenantId, objectApiName);
  const owd = setting?.orgWideDefault;

  let hierarchy = false;
  // Determine whether the record owner reports to us (any depth).
  const subordinates = await getSubordinateIds(user.tenantId, userId);
  if (subordinates.some((id) => String(id) === ownerId || String(id) === createdById)) {
    hierarchy = true;
  }

  const rules = await getApplicableRules(user, user.tenantId, objectApiName);
  const readRule = rules.length > 0;
  const writeRule = rules.some((r) => r.accessLevel === 'readWrite');

  const canRead =
    owd === 'public_read_only' ||
    owd === 'public_read_write' ||
    hierarchy ||
    readRule ||
    (!setting && hierarchy);
  const canWrite =
    owd === 'public_read_write' ||
    hierarchy ||
    writeRule;

  return { canRead, canWrite, reason: hierarchy ? 'hierarchy' : readRule ? 'sharing_rule' : 'owd' };
};

export default {
  getOwd,
  getSubordinateIds,
  getManagerChainIds,
  getApplicableRules,
  buildRecordAccessFilter,
  buildRecordWriteFilter,
  getRecordAccess,
};
