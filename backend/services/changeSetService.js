import ChangeSet, { COMPONENT_TYPES } from '../models/ChangeSet.js';
import DeploymentLog from '../models/DeploymentLog.js';
import ObjectMeta from '../models/ObjectMeta.js';
import FieldMeta from '../models/FieldMeta.js';
import Layout from '../models/Layout.js';
import LayoutAssignment from '../models/LayoutAssignment.js';
import Automation from '../models/Automation.js';
import ApprovalProcess from '../models/ApprovalProcess.js';
import ApproverGroup from '../models/ApproverGroup.js';
import DuplicateRule from '../models/DuplicateRule.js';
import TenantConfiguration from '../models/TenantConfiguration.js';
import Role from '../models/Role.js';
import User from '../models/User.js';
import Tenant from '../models/Tenant.js';
import { seedDefaultRoles } from './roleService.js';
import { AppError } from '../utils/errors.js';
import logger from '../utils/logger.js';

/**
 * Metadata deployment & environments (Core BRD §13).
 *
 * A ChangeSet is assembled from one tenant's metadata, validated against a
 * target tenant's dependencies (§13.2) and deployed there, writing a
 * DeploymentLog entry either way (§13).
 */

// Deploy parents before children so field/layout components resolve their object.
const COMPONENT_ORDER = [
  'object',
  'field',
  'layout',
  'layout_assignment',
  'flow',
  'approver_group',
  'approval_process',
  'duplicate_rule',
  'tenant_config',
];

const stripTenancy = (doc) => {
  const obj = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  for (const key of [
    '_id',
    'tenantId',
    'objectId',
    'createdAt',
    'updatedAt',
    'createdBy',
    'lastModifiedBy',
    '__v',
  ]) {
    delete obj[key];
  }
  return obj;
};

const _roleNames = async (tenantId, ids = []) => {
  const clean = ids.filter(Boolean).map(String);
  if (clean.length === 0) return [];
  const roles = await Role.find({ tenantId, _id: { $in: clean } })
    .select('name')
    .lean();
  return roles.map((r) => r.name);
};

const _roleIds = async (tenantId, names = []) => {
  const clean = (names || []).filter(Boolean);
  if (clean.length === 0) return [];
  const roles = await Role.find({ tenantId, name: { $in: clean } })
    .select('_id')
    .lean();
  return roles.map((r) => r._id);
};

const _splitKey = (key, sep) => {
  const idx = key.indexOf(sep);
  if (idx === -1) return null;
  return [key.slice(0, idx), key.slice(idx + 1)];
};

/* ── Build (export a package from the source tenant) ────────────────────── */

const SNAPSHOTTERS = {
  object: async (tenantId, apiName) => {
    const doc = await ObjectMeta.findOne({ tenantId, apiName });
    return doc ? stripTenancy(doc) : null;
  },

  field: async (tenantId, key) => {
    const parts = _splitKey(key, '.');
    if (!parts) return null;
    const doc = await FieldMeta.findOne({
      tenantId,
      objectApiName: parts[0],
      apiName: parts[1],
    });
    return doc ? stripTenancy(doc) : null;
  },

  layout: async (tenantId, key) => {
    const parts = _splitKey(key, ':');
    if (!parts) return null;
    const doc = await Layout.findOne({
      tenantId,
      objectApiName: parts[0],
      name: parts[1],
    });
    if (!doc) return null;
    const snapshot = stripTenancy(doc);
    // Role ids belong to the source tenant; carry names and re-resolve on deploy.
    snapshot.assignedRoles = await _roleNames(tenantId, snapshot.assignedRoles);
    snapshot.buttons = (snapshot.buttons || []).map((button) => ({
      ...button,
      visibleRoles: [],
    }));
    const buttons = await Promise.all(
      (doc.buttons || []).map(async (button) => ({
        id: button.id,
        names: await _roleNames(tenantId, button.visibleRoles),
      })),
    );
    for (const entry of buttons) {
      const target = snapshot.buttons.find((b) => b.id === entry.id);
      if (target) target.visibleRoles = entry.names;
    }
    return snapshot;
  },

  // Key: "<objectApiName>:<role name>". Role and layout ids belong to the
  // source tenant, so the snapshot carries the role name and layout names and
  // the persister maps them back to ids in the target.
  layout_assignment: async (tenantId, key) => {
    const parts = _splitKey(key, ':');
    if (!parts) return null;
    const [objectApiName, roleName] = parts;
    const role = await Role.findOne({ tenantId, name: roleName }).select('_id').lean();
    if (!role) return null;
    const doc = await LayoutAssignment.findOne({ tenantId, objectApiName, roleId: role._id }).lean();
    if (!doc) return null;
    const layouts = await Layout.find({ tenantId, objectApiName }).select('name').lean();
    const nameOf = new Map(layouts.map((l) => [String(l._id), l.name]));
    return {
      objectApiName,
      roleName,
      defaultLayout: doc.defaultLayoutId ? nameOf.get(String(doc.defaultLayoutId)) || null : null,
      rules: (doc.rules || [])
        .filter((r) => nameOf.has(String(r.layoutId)))
        .map((r) => ({
          field: r.field,
          operator: r.operator,
          value: r.value,
          layout: nameOf.get(String(r.layoutId)),
        })),
    };
  },

  flow: async (tenantId, apiName) => {
    const doc = await Automation.findOne({ tenantId, apiName });
    if (!doc) return null;
    const snapshot = stripTenancy(doc);
    delete snapshot.externalObjectId; // integration-specific, not portable
    delete snapshot.stats; // per-tenant runtime counters
    return snapshot;
  },

  // Key: the group's name. Members travel as emails and roles as names.
  approver_group: async (tenantId, name) => {
    const doc = await ApproverGroup.findOne({ tenantId, name }).lean();
    if (!doc) return null;
    const [users, roles] = await Promise.all([
      User.find({ tenantId, _id: { $in: doc.memberIds || [] } }).select('email').lean(),
      Role.find({ tenantId, _id: { $in: doc.roleIds || [] } }).select('name').lean(),
    ]);
    return {
      name: doc.name,
      label: doc.label,
      description: doc.description || '',
      memberEmails: users.map((u) => u.email).filter(Boolean),
      roleNames: roles.map((r) => r.name),
    };
  },

  approval_process: async (tenantId, key) => {
    const parts = _splitKey(key, ':');
    if (!parts) return null;
    const doc = await ApprovalProcess.findOne({
      tenantId,
      objectApiName: parts[0],
      name: parts[1],
    });
    if (!doc) return null;
    const snapshot = stripTenancy(doc);
    for (const step of snapshot.steps || []) {
      if (step.approverRoleId) {
        const role = await Role.findById(step.approverRoleId)
          .select('name')
          .lean();
        step.approverRoleName = role?.name;
        delete step.approverRoleId;
      }
      if (step.approverUserId) {
        const user = await User.findById(step.approverUserId)
          .select('email')
          .lean();
        step.approverUserEmail = user?.email;
        delete step.approverUserId;
      }
      // Group ids belong to the source tenant; carry the name and re-resolve on deploy.
      if (step.approverGroupId) {
        const group = await ApproverGroup.findById(step.approverGroupId).select('name').lean();
        step.approverGroupName = group?.name;
        delete step.approverGroupId;
      }
    }
    // The flow a stage launches is carried by API name, for the same reason.
    for (const stage of Object.values(snapshot.actions || {})) {
      if (stage?.flowId) {
        const flow = await Automation.findById(stage.flowId).select('apiName').lean();
        stage.flowApiName = flow?.apiName;
        stage.flowId = null;
      }
    }
    return snapshot;
  },

  duplicate_rule: async (tenantId, key) => {
    const parts = _splitKey(key, ':');
    if (!parts) return null;
    const doc = await DuplicateRule.findOne({
      tenantId,
      objectApiName: parts[0],
      name: parts[1],
    });
    return doc ? stripTenancy(doc) : null;
  },

  tenant_config: async (tenantId, key) => {
    const doc = await TenantConfiguration.findOne({ key, tenantId }).lean();
    if (doc) {
      return {
        key: doc.key,
        value: doc.value,
        dataType: doc.dataType,
        category: doc.category,
        label: doc.label,
        description: doc.description,
        editableByTenant: doc.editableByTenant,
      };
    }
    const system = await TenantConfiguration.findOne({ key, tenantId: null }).lean();
    if (system) {
      return {
        key: system.key,
        value: system.value,
        dataType: system.dataType,
        category: system.category,
        label: system.label,
        description: system.description,
        editableByTenant: system.editableByTenant,
      };
    }
    return null;
  },
};

const build = async ({ tenantId, name, description, components, user }) => {
  if (!name) throw new AppError('A change set name is required.', 400);
  const comps = Array.isArray(components) ? components : [];
  // Allow empty change sets (shell) so admins can assemble components incrementally.

  const built = [];
  const notFound = [];
  for (const component of comps) {
    const { componentType, componentKey } = component || {};
    if (!COMPONENT_TYPES.includes(componentType)) {
      throw new AppError(`Unknown component type '${componentType}'.`, 400);
    }
    const snapshot = await SNAPSHOTTERS[componentType](tenantId, componentKey);
    if (!snapshot) notFound.push(`${componentType}:${componentKey}`);
    else built.push({ componentType, componentKey, snapshot });
  }
  if (notFound.length) {
    throw new AppError(`Components not found: ${notFound.join(', ')}`, 404);
  }

  return ChangeSet.create({
    tenantId,
    name,
    description,
    components: built,
    createdBy: user?._id,
  });
};

/* ── Dependency validation (§13.2) ───────────────────────────────────────── */

const _referencedObjects = (components) => {
  const refs = new Set();
  for (const component of components) {
    if (component.componentType === 'object') {
      refs.add(component.componentKey);
      continue;
    }
    const snapshot = component.snapshot || {};
    if (snapshot.objectApiName) refs.add(snapshot.objectApiName);
    if (component.componentType === 'flow' && snapshot.trigger?.objectApiName) {
      refs.add(snapshot.trigger.objectApiName);
    }
    // Layouts may pull in other objects via related lists.
    if (component.componentType === 'layout') {
      (snapshot.relatedLists || []).forEach((list) => {
        if (list?.objectApiName) refs.add(list.objectApiName);
      });
    }
  }
  return refs;
};

const _layoutFieldRefs = (snapshot) => {
  const refs = new Set();
  const addFields = (fields = []) =>
    fields.forEach((f) => f?.fieldApiName && refs.add(f.fieldApiName));
  const addSections = (sections = []) =>
    (sections || []).forEach((section) =>
      (section?.columnData || []).forEach((column) =>
        addFields(column?.fields || []),
      ),
    );
  (snapshot.tabs || []).forEach((tab) => addSections(tab.sections));
  addSections(snapshot.sections);
  (snapshot.relatedLists || []).forEach((list) => {
    if (list.relationshipField) refs.add(list.relationshipField);
    (list.columns || []).forEach((column) => column && refs.add(column));
    if (list.sortField) refs.add(list.sortField);
  });
  return refs;
};

const validate = async ({ changeSet, targetTenantId }) => {
  const components = changeSet.components || [];
  const missing = [];

  const referenced = _referencedObjects(components);
  const packaged = new Set(
    components
      .filter((c) => c.componentType === 'object')
      .map((c) => c.componentKey),
  );
  const targetObjects = await ObjectMeta.find({
    tenantId: targetTenantId,
    apiName: { $in: [...referenced] },
  })
    .select('apiName')
    .lean();
  const targetObjectSet = new Set(targetObjects.map((o) => o.apiName));

  for (const apiName of referenced) {
    if (!packaged.has(apiName) && !targetObjectSet.has(apiName)) {
      missing.push({ dependency: 'object', key: apiName });
    }
  }

  // Required fields: layouts must not reference fields absent from both the
  // target tenant and the package.
  const packagedFields = new Set(
    components
      .filter((c) => c.componentType === 'field')
      .map((c) => c.componentKey),
  );
  for (const component of components) {
    if (component.componentType !== 'layout') continue;
    const objectApiName = component.snapshot?.objectApiName;
    if (!objectApiName) continue;
    if (!packaged.has(objectApiName) && !targetObjectSet.has(objectApiName)) {
      continue; // reported as a missing object already
    }
    const refs = _layoutFieldRefs(component.snapshot);
    if (refs.size === 0) continue;
    const targetFields = await FieldMeta.find({
      tenantId: targetTenantId,
      objectApiName,
      apiName: { $in: [...refs] },
    })
      .select('apiName')
      .lean();
    const available = new Set(targetFields.map((f) => f.apiName));
    for (const field of refs) {
      const key = `${objectApiName}.${field}`;
      if (available.has(field) || packagedFields.has(key)) continue;
      missing.push({ dependency: 'field', key, via: `layout:${component.componentKey}` });
    }
  }

  // Layout assignments need their role in the target, and the layouts and
  // rule fields they name in the target or in the package.
  const packagedLayouts = new Set(
    components
      .filter((c) => c.componentType === 'layout')
      .map((c) => c.componentKey),
  );
  for (const component of components) {
    if (component.componentType !== 'layout_assignment') continue;
    const snapshot = component.snapshot || {};
    const { objectApiName, roleName } = snapshot;
    const via = `layout_assignment:${component.componentKey}`;
    if (!objectApiName) continue;
    if (!packaged.has(objectApiName) && !targetObjectSet.has(objectApiName)) {
      continue; // reported as a missing object already
    }

    const role = await Role.findOne({ tenantId: targetTenantId, name: roleName }).select('_id').lean();
    if (!role) missing.push({ dependency: 'role', key: roleName, via });

    const layoutNames = new Set(
      [snapshot.defaultLayout, ...(snapshot.rules || []).map((r) => r.layout)].filter(Boolean),
    );
    if (layoutNames.size > 0) {
      const targetLayouts = await Layout.find({
        tenantId: targetTenantId,
        objectApiName,
        name: { $in: [...layoutNames] },
      })
        .select('name')
        .lean();
      const available = new Set(targetLayouts.map((l) => l.name));
      for (const name of layoutNames) {
        const key = `${objectApiName}:${name}`;
        if (available.has(name) || packagedLayouts.has(key)) continue;
        missing.push({ dependency: 'layout', key, via });
      }
    }

    const ruleFields = new Set((snapshot.rules || []).map((r) => r.field).filter(Boolean));
    if (ruleFields.size > 0) {
      const targetFields = await FieldMeta.find({
        tenantId: targetTenantId,
        objectApiName,
        apiName: { $in: [...ruleFields] },
      })
        .select('apiName')
        .lean();
      const available = new Set(targetFields.map((f) => f.apiName));
      for (const field of ruleFields) {
        const key = `${objectApiName}.${field}`;
        if (available.has(field) || packagedFields.has(key)) continue;
        missing.push({ dependency: 'field', key, via });
      }
    }
  }

  // Approval processes whose steps name a public group need it in the target
  // or in the package.
  const packagedGroups = new Set(
    components.filter((c) => c.componentType === 'approver_group').map((c) => c.componentKey),
  );
  for (const component of components) {
    if (component.componentType !== 'approval_process') continue;
    const names = (component.snapshot?.steps || []).map((st) => st.approverGroupName).filter(Boolean);
    if (!names.length) continue;
    const existing = await ApproverGroup.find({ tenantId: targetTenantId, name: { $in: names } }).select('name').lean();
    const have = new Set(existing.map((g) => g.name));
    for (const name of new Set(names)) {
      if (!have.has(name) && !packagedGroups.has(name)) {
        missing.push({ dependency: 'approver_group', key: name, via: `approval_process:${component.componentKey}` });
      }
    }
  }

  return { valid: missing.length === 0, missing };
};

/* ── Deploy ─────────────────────────────────────────────────────────────── */

const PERSISTERS = {
  object: async (tenantId, snapshot) => {
    await ObjectMeta.findOneAndUpdate(
      { tenantId, apiName: snapshot.apiName },
      { $set: { ...snapshot, tenantId } },
      { upsert: true },
    );
  },

  field: async (tenantId, snapshot) => {
    const object = await ObjectMeta.findOne({
      tenantId,
      apiName: snapshot.objectApiName,
    })
      .select('_id')
      .lean();
    if (!object) {
      throw new AppError(
        `Object '${snapshot.objectApiName}' is missing in the target tenant.`,
        409,
      );
    }
    await FieldMeta.findOneAndUpdate(
      { tenantId, objectApiName: snapshot.objectApiName, apiName: snapshot.apiName },
      { $set: { ...snapshot, tenantId, objectId: object._id } },
      { upsert: true },
    );
  },

  layout: async (tenantId, snapshot, warnings) => {
    const object = await ObjectMeta.findOne({
      tenantId,
      apiName: snapshot.objectApiName,
    })
      .select('_id')
      .lean();
    if (!object) {
      throw new AppError(
        `Object '${snapshot.objectApiName}' is missing in the target tenant.`,
        409,
      );
    }
    const assignedRoles = await _roleIds(tenantId, snapshot.assignedRoles);
    if ((snapshot.assignedRoles || []).length !== assignedRoles.length) {
      warnings.push(
        `layout '${snapshot.name}': some assigned roles do not exist in the target tenant`,
      );
    }
    const buttons = await Promise.all(
      (snapshot.buttons || []).map(async (button) => ({
        ...button,
        visibleRoles: await _roleIds(tenantId, button.visibleRoles),
      })),
    );
    await Layout.findOneAndUpdate(
      { tenantId, objectApiName: snapshot.objectApiName, name: snapshot.name },
      {
        $set: {
          ...snapshot,
          tenantId,
          objectId: object._id,
          assignedRoles,
          buttons,
        },
      },
      { upsert: true },
    );
  },

  layout_assignment: async (tenantId, snapshot, warnings) => {
    const { objectApiName, roleName } = snapshot;
    const role = await Role.findOne({ tenantId, name: roleName }).select('_id').lean();
    // Deploy validation blocks a missing role; a sandbox clone (which only
    // seeds the default roles) skips the assignment rather than failing.
    if (!role) {
      warnings.push(
        `layout assignment '${objectApiName}:${roleName}' skipped: role '${roleName}' does not exist in the target tenant`,
      );
      return;
    }
    const layouts = await Layout.find({ tenantId, objectApiName }).select('name').lean();
    const idOf = new Map(layouts.map((l) => [l.name, l._id]));

    let defaultLayoutId = null;
    if (snapshot.defaultLayout) {
      defaultLayoutId = idOf.get(snapshot.defaultLayout) || null;
      if (!defaultLayoutId) {
        warnings.push(
          `layout assignment '${objectApiName}:${roleName}': default layout '${snapshot.defaultLayout}' does not exist in the target tenant`,
        );
      }
    }
    const rules = [];
    for (const rule of snapshot.rules || []) {
      const layoutId = idOf.get(rule.layout);
      if (!layoutId) {
        warnings.push(
          `layout assignment '${objectApiName}:${roleName}': rule skipped, layout '${rule.layout}' does not exist in the target tenant`,
        );
        continue;
      }
      rules.push({ field: rule.field, operator: rule.operator, value: rule.value, layoutId });
    }

    await LayoutAssignment.findOneAndUpdate(
      { tenantId, objectApiName, roleId: role._id },
      { $set: { defaultLayoutId, rules } },
      { upsert: true, runValidators: true },
    );
  },

  flow: async (tenantId, snapshot) => {
    const data = { ...snapshot };
    delete data.externalObjectId;
    delete data.stats;
    await Automation.findOneAndUpdate(
      { tenantId, apiName: data.apiName },
      { $set: { ...data, tenantId } },
      { upsert: true },
    );
  },

  approver_group: async (tenantId, snapshot, warnings) => {
    const [users, roles] = await Promise.all([
      User.find({ tenantId, email: { $in: snapshot.memberEmails || [] } }).select('_id email').lean(),
      Role.find({ tenantId, name: { $in: snapshot.roleNames || [] } }).select('_id name').lean(),
    ]);
    const foundEmails = new Set(users.map((u) => u.email));
    (snapshot.memberEmails || []).filter((e) => !foundEmails.has(e)).forEach((e) => warnings.push(
      `approver_group '${snapshot.name}': member '${e}' not found in the target tenant`,
    ));
    const foundRoles = new Set(roles.map((r) => r.name));
    (snapshot.roleNames || []).filter((n) => !foundRoles.has(n)).forEach((n) => warnings.push(
      `approver_group '${snapshot.name}': role '${n}' not found in the target tenant`,
    ));
    await ApproverGroup.findOneAndUpdate(
      { tenantId, name: snapshot.name },
      {
        $set: {
          label: snapshot.label,
          description: snapshot.description || '',
          memberIds: users.map((u) => u._id),
          roleIds: roles.map((r) => r._id),
        },
      },
      { upsert: true },
    );
  },

  approval_process: async (tenantId, snapshot, warnings) => {
    const targetRoles = await Role.find({ tenantId }).select('name').lean();
    const roleNameToId = new Map(targetRoles.map((r) => [r.name, String(r._id)]));
    const steps = [];
    for (const [index, step] of (snapshot.steps || []).entries()) {
      const next = { ...step };
      if (next.approverRoleName) {
        const roleId = roleNameToId.get(next.approverRoleName);
        if (roleId) next.approverRoleId = roleId;
        else {
          warnings.push(
            `approval_process '${snapshot.name}': approver queue '${next.approverRoleName}' not found in the target tenant`,
          );
        }
        delete next.approverRoleName;
      }
      if (next.approverUserEmail) {
        const user = await User.findOne({
          tenantId,
          email: next.approverUserEmail,
        })
          .select('_id')
          .lean();
        if (user) next.approverUserId = user._id;
        else {
          warnings.push(
            `approval_process '${snapshot.name}': step ${index + 1} approver '${next.approverUserEmail}' not found in the target tenant`,
          );
        }
        delete next.approverUserEmail;
      }
      if (next.approverGroupName) {
        const group = await ApproverGroup.findOne({ tenantId, name: next.approverGroupName }).select('_id').lean();
        if (group) next.approverGroupId = group._id;
        else {
          warnings.push(
            `approval_process '${snapshot.name}': step ${index + 1} approver group '${next.approverGroupName}' not found in the target tenant`,
          );
        }
        delete next.approverGroupName;
      }
      steps.push(next);
    }
    const actions = JSON.parse(JSON.stringify(snapshot.actions || {}));
    for (const stage of Object.values(actions)) {
      if (!stage?.flowApiName) continue;
      const flow = await Automation.findOne({ tenantId, apiName: stage.flowApiName }).select('_id').lean();
      if (flow) stage.flowId = flow._id;
      else {
        warnings.push(
          `approval_process '${snapshot.name}': flow '${stage.flowApiName}' not found in the target tenant`,
        );
      }
      delete stage.flowApiName;
    }
    await ApprovalProcess.findOneAndUpdate(
      {
        tenantId,
        objectApiName: snapshot.objectApiName,
        name: snapshot.name,
      },
      { $set: { ...snapshot, tenantId, steps, actions } },
      { upsert: true },
    );
  },

  duplicate_rule: async (tenantId, snapshot) => {
    await DuplicateRule.findOneAndUpdate(
      { tenantId, objectApiName: snapshot.objectApiName, name: snapshot.name },
      { $set: { ...snapshot, tenantId } },
      { upsert: true },
    );
  },

  tenant_config: async (tenantId, snapshot) => {
    await TenantConfiguration.findOneAndUpdate(
      { tenantId, key: snapshot.key },
      {
        $set: {
          value: snapshot.value,
          dataType: snapshot.dataType,
          category: snapshot.category,
          label: snapshot.label,
          description: snapshot.description,
          editableByTenant: snapshot.editableByTenant,
        },
      },
      { upsert: true, setDefaultsOnInsert: true },
    );
  },
};

const _DELETE_BY_KEY = {
  object: (tenantId, key) => ObjectMeta.deleteOne({ tenantId, apiName: key }),
  field: (tenantId, key) => {
    const parts = _splitKey(key, '.');
    return parts
      ? FieldMeta.deleteOne({ tenantId, objectApiName: parts[0], apiName: parts[1] })
      : null;
  },
  layout: (tenantId, key) => {
    const parts = _splitKey(key, ':');
    return parts
      ? Layout.deleteOne({ tenantId, objectApiName: parts[0], name: parts[1] })
      : null;
  },
  layout_assignment: async (tenantId, key) => {
    const parts = _splitKey(key, ':');
    if (!parts) return null;
    const role = await Role.findOne({ tenantId, name: parts[1] }).select('_id').lean();
    return role
      ? LayoutAssignment.deleteOne({ tenantId, objectApiName: parts[0], roleId: role._id })
      : null;
  },
  flow: (tenantId, key) => Automation.deleteOne({ tenantId, apiName: key }),
  approver_group: (tenantId, key) => ApproverGroup.deleteOne({ tenantId, name: key }),
  approval_process: (tenantId, key) => {
    const parts = _splitKey(key, ':');
    return parts
      ? ApprovalProcess.deleteOne({
          tenantId,
          objectApiName: parts[0],
          name: parts[1],
        })
      : null;
  },
  duplicate_rule: (tenantId, key) => {
    const parts = _splitKey(key, ':');
    return parts
      ? DuplicateRule.deleteOne({
          tenantId,
          objectApiName: parts[0],
          name: parts[1],
        })
      : null;
  },
  tenant_config: (tenantId, key) =>
    TenantConfiguration.deleteOne({ tenantId, key }),
};

const _ordered = (components) =>
  [...(components || [])].sort(
    (a, b) =>
      COMPONENT_ORDER.indexOf(a.componentType) -
      COMPONENT_ORDER.indexOf(b.componentType),
  );

/**
 * Apply packaged components to a target tenant, parents before children
 * (shared by cross-tenant deploy and sandbox cloning). Returns each component's
 * pre-application snapshot (or null) so a deployment can be rolled back (§13).
 */
const persistComponents = async (targetTenantId, components, warnings = []) => {
  const manifest = [];
  for (const component of _ordered(components)) {
    const before = await SNAPSHOTTERS[component.componentType](
      targetTenantId,
      component.componentKey,
    );
    await PERSISTERS[component.componentType](
      targetTenantId,
      component.snapshot,
      warnings,
    );
    manifest.push({
      componentType: component.componentType,
      componentKey: component.componentKey,
      before,
    });
  }
  return manifest;
};

/** Every metadata component a tenant currently owns (for cloning). */
const collectAll = async (tenantId) => {
  const [objects, fields, layouts, assignments, roles, flows, approvals, duplicateRules, configs, groups] =
    await Promise.all([
      ObjectMeta.find({ tenantId }).select('apiName').lean(),
      FieldMeta.find({ tenantId }).select('objectApiName apiName').lean(),
      Layout.find({ tenantId }).select('objectApiName name').lean(),
      LayoutAssignment.find({ tenantId }).select('objectApiName roleId').lean(),
      Role.find({ tenantId }).select('name').lean(),
      Automation.find({ tenantId }).select('apiName').lean(),
      ApprovalProcess.find({ tenantId }).select('objectApiName name').lean(),
      DuplicateRule.find({ tenantId }).select('objectApiName name').lean(),
      TenantConfiguration.find({ tenantId }).select('key').lean(),
      ApproverGroup.find({ tenantId }).select('name').lean(),
    ]);

  const seen = new Set();
  const components = [];
  const push = async (componentType, componentKey) => {
    const dedupe = `${componentType}:${componentKey}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    const snapshot = await SNAPSHOTTERS[componentType](tenantId, componentKey);
    if (snapshot) components.push({ componentType, componentKey, snapshot });
  };

  for (const doc of objects) await push('object', doc.apiName);
  for (const doc of fields)
    await push('field', `${doc.objectApiName}.${doc.apiName}`);
  for (const doc of layouts)
    await push('layout', `${doc.objectApiName}:${doc.name}`);
  const roleName = new Map(roles.map((r) => [String(r._id), r.name]));
  for (const doc of assignments) {
    const name = roleName.get(String(doc.roleId));
    if (name) await push('layout_assignment', `${doc.objectApiName}:${name}`);
  }
  for (const doc of flows) await push('flow', doc.apiName);
  for (const doc of groups) await push('approver_group', doc.name);
  for (const doc of approvals)
    await push('approval_process', `${doc.objectApiName}:${doc.name}`);
  for (const doc of duplicateRules)
    await push('duplicate_rule', `${doc.objectApiName}:${doc.name}`);
  for (const doc of configs) await push('tenant_config', doc.key);

  return components;
};

/**
 * Clone a tenant's configuration into a new isolated sandbox tenant with no
 * business data (Core BRD §13). Default roles are seeded so role references
 * remap by name.
 */
const cloneConfiguration = async ({ sourceTenantId, name, user }) => {
  const source = await Tenant.findById(sourceTenantId).lean();
  if (!source) throw new AppError('Source tenant not found.', 404);

  const components = await collectAll(sourceTenantId);

  const suffix = Math.random().toString(36).slice(2, 8);
  const clone = await Tenant.create({
    name: name || `${source.name} (Sandbox ${suffix})`,
    hub: source.hub,
    plan: source.plan,
    status: 'active',
    isSandbox: true,
    clonedFromTenantId: source._id,
    ownerEmail: source.ownerEmail || user?.email,
  });
  await seedDefaultRoles(clone._id);

  const warnings = [];
  await persistComponents(String(clone._id), components, warnings);

  logger.info(
    `Cloned ${components.length} components from tenant ${sourceTenantId} into sandbox tenant ${clone._id}`,
  );
  return { tenant: clone, componentCount: components.length, warnings };
};

/**
 * Undo a deployment by restoring each component to its pre-deployment state
 * (recreate the previous snapshot, or delete if it did not exist). Reverse
 * order removes children before the objects they hang off (§13).
 */
const rollback = async ({ log, user }) => {
  if (!log) throw new AppError('Deployment log not found.', 404);
  if (log.status !== 'deployed') {
    throw new AppError(
      `Only a deployed change set can be rolled back (status: ${log.status}).`,
      409,
    );
  }

  const tenantId = log.tenantId;
  const warnings = [];
  for (const entry of [...(log.rollback || [])].reverse()) {
    const remove = _DELETE_BY_KEY[entry.componentType];
    if (entry.before == null) await remove(tenantId, entry.componentKey);
    else await PERSISTERS[entry.componentType](tenantId, entry.before, warnings);
  }

  log.status = 'rolled_back';
  log.rolledBackAt = new Date();
  log.rolledBackBy = user?._id;
  log.warnings = [...(log.warnings || []), ...warnings];
  await log.save();

  logger.info(
    `Change set '${log.changeSetName}' rolled back on tenant ${tenantId}`,
  );
  return { log, warnings };
};

const deploy = async ({ changeSet, targetTenantId, user }) => {
  if (String(targetTenantId) === String(changeSet.tenantId)) {
    throw new AppError('Source and target tenant must differ.', 400);
  }

  const { valid, missing } = await validate({ changeSet, targetTenantId });

  if (!valid) {
    await DeploymentLog.create({
      tenantId: targetTenantId,
      sourceTenantId: changeSet.tenantId,
      changeSetId: changeSet._id,
      changeSetName: changeSet.name,
      status: 'blocked',
      componentCount: (changeSet.components || []).length,
      missing,
      message: 'Required dependencies are missing in the target tenant.',
      by: user?._id,
    });
    changeSet.validations.push({
      by: user?._id,
      targetTenantId,
      valid: false,
      missing,
    });
    changeSet.status = 'failed';
    await changeSet.save();
    throw new AppError(
      `Deployment blocked: missing dependencies (${missing
        .map((m) => m.key)
        .join(', ')})`,
      409,
    );
  }

  const warnings = [];
  const rollbackManifest = await persistComponents(
    targetTenantId,
    changeSet.components,
    warnings,
  );

  const log = await DeploymentLog.create({
    tenantId: targetTenantId,
    sourceTenantId: changeSet.tenantId,
    changeSetId: changeSet._id,
    changeSetName: changeSet.name,
    status: 'deployed',
    componentCount: rollbackManifest.length,
    warnings,
    rollback: rollbackManifest,
    message: 'Deployment succeeded.',
    by: user?._id,
  });

  changeSet.validations.push({
    by: user?._id,
    targetTenantId,
    valid: true,
    missing: [],
  });
  changeSet.status = 'deployed';
  await changeSet.save();

  logger.info(
    `Change set '${changeSet.name}' deployed to tenant ${targetTenantId} (${rollbackManifest.length} components)`,
  );
  return { log, warnings, componentCount: rollbackManifest.length };
};

const listDeploymentLog = async ({ tenantId, limit, skip }) => {
  const size = Math.min(Number(limit) || 50, 200);
  const offset = Number(skip) || 0;
  const filter = { tenantId };
  const [items, total] = await Promise.all([
    DeploymentLog.find(filter).sort({ at: -1 }).skip(offset).limit(size).lean(),
    DeploymentLog.countDocuments(filter),
  ]);
  return { items, total, limit: size, skip: offset };
};

export default {
  COMPONENT_TYPES,
  build,
  validate,
  deploy,
  rollback,
  cloneConfiguration,
  collectAll,
  listDeploymentLog,
};
