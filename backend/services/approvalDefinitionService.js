import mongoose from 'mongoose';
import ObjectMeta from '../models/ObjectMeta.js';
import FieldMeta from '../models/FieldMeta.js';
import User from '../models/User.js';
import Role from '../models/Role.js';
import ApproverGroup from '../models/ApproverGroup.js';
import Automation from '../models/Automation.js';
import { validateFormula, configKeysIn } from './formulaParser.js';
import { buildSampleContext, buildFieldKindMap } from './validationEngine.js';
import configurationService from './configurationService.js';
import { AppError } from '../utils/errors.js';

/**
 * Check an approval process definition before it is saved (BRD §8): its object,
 * entry criteria formula, every step's approver and the field updates, flow
 * and platform action on each stage. Throws one 400 listing every problem.
 */
export const validateApprovalDefinition = async (tenantId, def) => {
  const problems = [];
  const objectApiName = def.objectApiName;

  if (!String(def.name || '').trim()) problems.push('Give the process a name.');
  const obj = objectApiName ? await ObjectMeta.exists({ tenantId, apiName: objectApiName }) : null;
  if (!obj) {
    problems.push(`Object "${objectApiName || ''}" does not exist.`);
    throw new AppError(problems.join('\n'), 400);
  }
  const fields = await FieldMeta.find({ tenantId, objectApiName }).lean();
  const fieldNames = new Set(fields.map((f) => f.apiName));

  // Entry criteria — a true/false formula, same builder as validation rules.
  const expression = String(def.entryCondition || '').trim();
  if (expression) {
    const result = validateFormula(expression, buildSampleContext(fields), {
      asCondition: true,
      fieldKinds: buildFieldKindMap(fields),
      allowRecordState: false, // ISCHANGED has no meaning when a record is submitted
      allowConfig: true, // …but tenant thresholds are the point: amount > CONFIG("…")
    });
    if (!result.valid) problems.push(`Entry criteria: ${result.error}`);
    else {
      const keys = configKeysIn(expression);
      if (keys.length) {
        const found = await configurationService.resolveMany(keys, tenantId);
        keys.filter((k) => !(k in found)).forEach((k) => problems.push(`Entry criteria: CONFIG("${k}") is not a configuration setting.`));
      }
    }
  }

  // Steps
  const steps = def.steps || [];
  if (!steps.length) problems.push('Add at least one approval step.');
  const orders = new Set();
  for (const [i, step] of steps.entries()) {
    const at = `Step ${i + 1}`;
    if (orders.has(step.order)) problems.push(`${at}: step order ${step.order} is used twice.`);
    orders.add(step.order);
    switch (step.approverType) {
      case 'user':
        if (!step.approverUserId || !mongoose.isValidObjectId(String(step.approverUserId))) problems.push(`${at}: choose the approver.`);
        else if (!(await User.exists({ _id: step.approverUserId, tenantId }))) problems.push(`${at}: the approver is not a user of this company.`);
        break;
      case 'manager':
        if (step.managerOf && !['owner', 'submitter'].includes(step.managerOf)) problems.push(`${at}: choose whose manager approves.`);
        break;
      case 'field':
        if (!step.approverFieldApiName) problems.push(`${at}: choose the user field on the record.`);
        else if (!fieldNames.has(step.approverFieldApiName)) problems.push(`${at}: "${step.approverFieldApiName}" is not a field on ${objectApiName}.`);
        break;
      case 'queue':
        if (!step.approverRoleId || !mongoose.isValidObjectId(String(step.approverRoleId))) problems.push(`${at}: choose the role.`);
        else if (!(await Role.exists({ _id: step.approverRoleId, tenantId }))) problems.push(`${at}: that role does not exist.`);
        break;
      case 'group':
        if (!step.approverGroupId || !mongoose.isValidObjectId(String(step.approverGroupId))) problems.push(`${at}: choose the approver group.`);
        else if (!(await ApproverGroup.exists({ _id: step.approverGroupId, tenantId }))) problems.push(`${at}: that approver group does not exist.`);
        break;
      default:
        problems.push(`${at}: choose who approves.`);
    }
  }

  // Actions on submit / approve / reject
  const stages = [['onSubmit', 'On submit'], ['onApprove', 'On approve'], ['onReject', 'On reject']];
  for (const [key, label] of stages) {
    const action = def.actions?.[key] || {};
    for (const u of action.fieldUpdates || []) {
      if (u?.field && !fieldNames.has(u.field)) problems.push(`${label}: "${u.field}" is not a field on ${objectApiName}.`);
    }
    for (const prop of ['reasonField', 'approverField']) {
      if (action[prop] && !fieldNames.has(action[prop])) problems.push(`${label}: "${action[prop]}" is not a field on ${objectApiName}.`);
    }
    if (action.flowId) {
      if (!mongoose.isValidObjectId(String(action.flowId)) || !(await Automation.exists({ _id: action.flowId, tenantId }))) {
        problems.push(`${label}: the selected flow does not exist.`);
      }
    }
    if (action.platformAction && action.platformAction !== 'none') {
      if (key !== 'onApprove') problems.push(`${label}: platform actions can only run on approval.`);
      else if (action.platformAction === 'convert_lead_to_deal' && objectApiName !== 'lead') problems.push('On approve: "Convert lead to deal" only applies to leads.');
    }
  }

  if (problems.length) throw new AppError(problems.join('\n'), 400);
};
