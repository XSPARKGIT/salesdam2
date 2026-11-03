/**
 * approval-builder.e2e.mjs — Core BRD §8 Approval Process Builder (the parts
 * that generalise today's Lead-to-Deal approval).
 *
 * Boots the real Express app and verifies, through the API:
 *  - Entry Criteria is a true/false formula (CONFIG("…") for tenant thresholds)
 *    and invalid definitions are rejected when saved
 *  - Approver determination: a named user; the record OWNER's manager (their
 *    assigned manager, else the role above theirs in the role hierarchy); a
 *    user referenced in a field; a role; and a PUBLIC GROUP of approvers
 *  - Actions: emails to the approver on submit and to the submitter on
 *    approve / reject; reason capture (required or optional) and the field it
 *    is stored in; the approver written onto the record
 *  - Multi-step sequential approvals that include a group
 *  - Lead-to-Deal runs as an ordinary one-step process, through the existing
 *    Lead endpoints, with the same emails and deal link
 *
 * Run: node tests/approval-builder.e2e.mjs   (from backend/)
 * Exits non-zero if any check fails.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import app from '../app.js';
import Tenant from '../models/Tenant.js';
import User from '../models/User.js';
import Role from '../models/Role.js';
import Session from '../models/Session.js';
import ObjectMeta from '../models/ObjectMeta.js';
import FieldMeta from '../models/FieldMeta.js';
import DynamicRecord from '../models/DynamicRecord.js';
import Notification from '../models/Notification.js';
import ApprovalProcess from '../models/ApprovalProcess.js';
import ApprovalRequest from '../models/ApprovalRequest.js';
import ApproverGroup from '../models/ApproverGroup.js';
import TenantConfiguration from '../models/TenantConfiguration.js';
import AuditLog from '../models/AuditLog.js';
import Workspace from '../models/Workspace.js';
import configurationService from '../services/configurationService.js';
import approvalProcessService from '../services/approvalProcessService.js';
import leadApprovalService from '../services/leadApprovalService.js';
import { setMailSender } from '../services/mailer.js';
import { seedDefaultRoles } from '../services/roleService.js';
import { seedWorkspace } from './helpers/workspace.mjs';

const RUN = Date.now().toString(36);
const PASSWORD = 'ApprBuild123!';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

const req = async (path, { method = 'GET', cookie, body } = {}) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
};

const loginCookie = async (username) => {
  const res = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  const setCookie = res.headers.getSetCookie?.() || [];
  return setCookie.map((c) => c.split(';')[0]).find((c) => c.startsWith('crm.sid=')) || '';
};

// Capture outgoing email instead of sending it.
let outbox = [];
setMailSender(async (mail) => { outbox.push(mail); });
const mailTo = (email) => outbox.filter((m) => m.to === email);

const tenantIds = [];
const models = [User, Role, Session, ObjectMeta, FieldMeta, DynamicRecord, Notification, ApprovalProcess, ApprovalRequest, ApproverGroup, AuditLog, Workspace];

try {
  await connectDB();

  const tenant = await Tenant.create({ name: `ZZ_AB_${RUN}`, slug: `zz-ab-${RUN}`, status: 'active', plan: 'enterprise' });
  const other = await Tenant.create({ name: `ZZ_AB_OTHER_${RUN}`, slug: `zz-ab-o-${RUN}`, status: 'active', plan: 'enterprise' });
  tenantIds.push(tenant._id, other._id);
  const tenantId = tenant._id;
  await seedDefaultRoles(tenantId);
  await seedDefaultRoles(other._id);

  // Role hierarchy: staff → manager role → executive role
  const roleExec = await Role.create({ tenantId, name: `exec_${RUN}`, label: 'Executive', dataAccess: 'all' });
  const roleMgr = await Role.create({ tenantId, name: `mgr_${RUN}`, label: 'Manager', dataAccess: 'all', parentRole: roleExec._id });
  const roleStaff = await Role.create({ tenantId, name: `staff_${RUN}`, label: 'Staff', dataAccess: 'all', parentRole: roleMgr._id });
  const roleLoner = await Role.create({ tenantId, name: `loner_${RUN}`, label: 'Loner', dataAccess: 'all' }); // no role above
  const roleAdmin = await Role.findOne({ tenantId, name: 'admin' });
  const roleAdminOther = await Role.findOne({ tenantId: other._id, name: 'admin' });

  const mk = (key, role, extra = {}, tId = tenantId) => User.create({
    tenantId: tId, firstName: key, lastName: 'User', email: `ab-${key}-${RUN}@example.com`,
    username: `ab_${key}_${RUN}`, password: PASSWORD, role: role._id, status: 'active', emailVerified: true, ...extra,
  });
  const admin = await mk('admin', roleAdmin);
  const boss = await mk('boss', roleMgr);                         // assigned manager of `owner`
  const owner = await mk('owner', roleStaff, { manager: boss._id });
  const submitter = await mk('submitter', roleStaff);            // no assigned manager; staff role → manager role
  const mgrA = await mk('mgra', roleMgr);                         // holds the role above staff
  const mgrB = await mk('mgrb', roleMgr);
  const loner = await mk('loner', roleLoner);                    // no manager, no role above
  const loneSubmitter = await mk('lonesub', roleLoner, { manager: mgrA._id });
  const gm1 = await mk('gm1', roleStaff);                         // direct group member
  const gm2 = await mk('gm2', roleStaff);
  const roleGroupHolder = await mk('groupholder', roleExec);      // in the group via its role
  const outsider = await mk('outsider', roleStaff);
  const otherAdmin = await mk('otheradmin', roleAdminOther, {}, other._id);

  const everyone = [admin, boss, owner, submitter, mgrA, mgrB, loner, loneSubmitter, gm1, gm2, roleGroupHolder, outsider];
  await seedWorkspace(tenantId, everyone.map((u) => u._id), ['claim', 'lead', 'deal']);
  // Login is rate-limited (10 per window), so only the users who act are logged in.
  const C = {};
  for (const [k, u] of Object.entries({ admin, boss, owner, submitter, mgrA, loneSubmitter, gm1, roleGroupHolder, outsider })) {
    C[k] = await loginCookie(u.email);
  }
  check('users can log in', Object.values(C).every(Boolean));

  // Objects: claim (generic), lead and deal (for the Lead-to-Deal process)
  const mkObject = async (apiName, label, fields) => {
    const obj = await ObjectMeta.create({ tenantId, name: label, label, pluralLabel: `${label}s`, apiName, nameFieldApiName: 'name', isActive: true });
    await FieldMeta.create(fields.map(([a, l, t]) => ({ tenantId, objectId: obj._id, objectApiName: apiName, name: a, apiName: a, label: l, type: t })));
    return obj;
  };
  const claimObj = await mkObject('claim', 'Claim', [
    ['name', 'Name', 'text'], ['amount', 'Amount', 'number'], ['status', 'Status', 'text'],
    ['approver_user', 'Approver', 'lookup'], ['assigned_to', 'Assigned To', 'lookup'],
    ['reject_note', 'Reject Note', 'text'],
  ]);
  const leadObj = await mkObject('lead', 'Lead', [
    ['name', 'Name', 'text'], ['first_name', 'First Name', 'text'], ['last_name', 'Last Name', 'text'],
    ['approval_status', 'Approval Status', 'text'], ['assigned_approver', 'Assigned Approver', 'lookup'],
    ['rejection_reason', 'Rejection Reason', 'text'], ['is_converted', 'Converted', 'boolean'],
    ['related_deal_id', 'Related Deal', 'text'], ['client', 'Client', 'text'], ['product_name', 'Product', 'text'],
  ]);
  await mkObject('deal', 'Deal', [
    ['name', 'Name', 'text'], ['client', 'Client', 'text'], ['converted_lead', 'Converted Lead', 'text'],
    ['first_name', 'First Name', 'text'], ['last_name', 'Last Name', 'text'], ['product_name', 'Product', 'text'],
  ]);

  const mkRecord = (objectApiName, obj, data, ownerUser, creator = ownerUser) => DynamicRecord.create({
    tenantId, objectId: obj._id, objectApiName, data, createdBy: creator._id, ownerId: ownerUser._id,
  });
  const claim = (data, ownerUser = owner) => mkRecord('claim', claimObj, data, ownerUser);

  await configurationService.set({ key: 'approvals.threshold_amount', tenantId, value: 1000 });

  const createProcess = (body, cookie = C.admin) => req('/api/v1/approval-processes', {
    method: 'POST', cookie, body: { objectApiName: 'claim', active: true, ...body },
  });
  const submit = (cookie, recordId, processId, objectApiName = 'claim') => req('/api/v1/approval-processes/submit', {
    method: 'POST', cookie, body: { objectApiName, recordId, processId },
  });
  const decide = (cookie, id, verb, comment) => req(`/api/v1/approval-processes/${id}/${verb}`, { method: 'POST', cookie, body: comment === undefined ? {} : { comment } });

  // ── Entry criteria as a formula ──────────────────────────────────────────
  let r = await createProcess({ name: 'Bad formula', entryCondition: 'amount * 2', steps: [{ order: 1, approverType: 'manager' }] });
  check('entry criteria must be a true/false formula', r.status === 400 && /true\/false/.test(r.json?.message || ''), r.json?.message);
  r = await createProcess({ name: 'Bad config', entryCondition: 'amount > CONFIG("nope.key")', steps: [{ order: 1, approverType: 'manager' }] });
  check('entry criteria CONFIG("…") must name a real setting', r.status === 400 && /not a configuration setting/.test(r.json?.message || ''), r.json?.message);
  r = await createProcess({ name: 'Bad state', entryCondition: 'ISCHANGED(amount)', steps: [{ order: 1, approverType: 'manager' }] });
  check('ISCHANGED is rejected in entry criteria', r.status === 400, r.json?.message);

  r = await createProcess({
    name: 'Over threshold', entryCondition: 'amount > CONFIG("approvals.threshold_amount") AND NOT(ISBLANK(name))',
    steps: [{ order: 1, name: 'Owner manager', approverType: 'manager' }],
  });
  const thresholdId = r.json?.data?._id;
  check('a formula with a tenant threshold saves', r.status === 201, `HTTP ${r.status} ${r.json?.message || ''}`);
  const big = await claim({ name: 'Big claim', amount: 5000 });
  const small = await claim({ name: 'Small claim', amount: 500 });
  r = await submit(C.owner, small._id, thresholdId);
  check('a record below the tenant threshold does not enter the process', r.status === 400, `HTTP ${r.status}`);
  r = await submit(C.owner, big._id, thresholdId);
  check('a record above it does', r.status === 201, `HTTP ${r.status} ${r.json?.message || ''}`);

  // ── Definition checks ────────────────────────────────────────────────────
  const bad = async (label, body) => {
    const res = await createProcess({ name: 'Bad', steps: [{ order: 1, approverType: 'manager' }], ...body });
    check(`rejects ${label}`, res.status === 400, `HTTP ${res.status} ${res.json?.message || ''}`);
  };
  await bad('a field update on an unknown field', { actions: { onApprove: { fieldUpdates: [{ field: 'nope', value: 'x' }] } } });
  await bad('an approver user from another company', { steps: [{ order: 1, approverType: 'user', approverUserId: otherAdmin._id }] });
  await bad('an approver group that does not exist', { steps: [{ order: 1, approverType: 'group', approverGroupId: new mongoose.Types.ObjectId() }] });
  await bad('Lead→Deal conversion on a non-lead object', { actions: { onApprove: { platformAction: 'convert_lead_to_deal' } } });
  await bad('a reason field that is not on the object', { actions: { onReject: { reasonField: 'nope' } } });

  // ── Manager of the record OWNER ──────────────────────────────────────────
  r = await createProcess({ name: 'Owner manager', steps: [{ order: 1, approverType: 'manager' }] });
  const ownerMgrId = r.json?.data?._id;
  const c1 = await claim({ name: 'C1', amount: 10 }, owner);
  r = await submit(C.submitter, c1._id, ownerMgrId);
  check(
    "manager step goes to the record OWNER's manager, not the submitter's",
    r.status === 201 && String(r.json?.data?.steps?.[0]?.approverUserId) === String(boss._id),
    `HTTP ${r.status} approver=${r.json?.data?.steps?.[0]?.approverUserId} ${r.json?.message || ''}`,
  );

  // Role hierarchy: the owner has no assigned manager; the role above theirs (Manager) has users
  const c2 = await claim({ name: 'C2', amount: 10 }, submitter);
  r = await submit(C.submitter, c2._id, ownerMgrId);
  const hierRequest = r.json?.data;
  check(
    'with no assigned manager the step goes to the role above in the role hierarchy',
    r.status === 201 && String(hierRequest?.steps?.[0]?.approverRoleId) === String(roleMgr._id) && !hierRequest?.steps?.[0]?.approverUserId,
    `HTTP ${r.status} ${r.json?.message || ''}`,
  );
  r = await decide(C.outsider, hierRequest?._id, 'approve');
  check('someone not in that role cannot decide it', r.status === 403, `HTTP ${r.status}`);
  r = await decide(C.boss, hierRequest?._id, 'approve'); // holds the Manager role
  check('anyone holding the role above can', r.status === 200 && r.json?.data?.status === 'approved', `HTTP ${r.status} ${r.json?.message || ''}`);

  // Fallback to the submitter's manager when the owner has nobody above them
  const c3 = await claim({ name: 'C3', amount: 10 }, loner);
  r = await submit(C.loneSubmitter, c3._id, ownerMgrId);
  check(
    "an owner with no manager and no role above falls back to the submitter's manager",
    r.status === 201 && String(r.json?.data?.steps?.[0]?.approverUserId) === String(mgrA._id),
    `HTTP ${r.status} ${r.json?.message || ''}`,
  );
  const c4 = await claim({ name: 'C4', amount: 10 }, loner);
  await User.updateOne({ _id: loneSubmitter._id }, { $unset: { manager: 1 } }); // now nobody above either of them
  r = await submit(C.loneSubmitter, c4._id, ownerMgrId);
  check('and with nobody at all it explains what to fix', r.status === 400 && /manager/i.test(r.json?.message || ''), `HTTP ${r.status} ${r.json?.message || ''}`);
  await User.updateOne({ _id: loneSubmitter._id }, { $set: { manager: mgrA._id } });

  r = await createProcess({ name: 'Submitter manager', steps: [{ order: 1, approverType: 'manager', managerOf: 'submitter' }] });
  const c5 = await claim({ name: 'C5', amount: 10 }, owner);
  const sm = await submit(C.loneSubmitter, c5._id, r.json?.data?._id);
  check("a step can be set to the SUBMITTER's manager instead", sm.status === 201 && String(sm.json?.data?.steps?.[0]?.approverUserId) === String(mgrA._id), `HTTP ${sm.status} ${sm.json?.message || ''}`);

  // ── Public group of approvers ────────────────────────────────────────────
  r = await req('/api/v1/approver-groups', { method: 'POST', cookie: C.outsider, body: { label: 'Nope' } });
  check('only admins manage approver groups', r.status === 403, `HTTP ${r.status}`);
  r = await req('/api/v1/approver-groups', { method: 'POST', cookie: C.admin, body: { label: 'Claims Panel', description: 'Senior claims reviewers', memberIds: [gm1._id, gm2._id], roleIds: [roleExec._id] } });
  const groupId = r.json?.data?._id;
  check('admin creates a public group of approvers', r.status === 201 && r.json?.data?.name === 'claims_panel', `HTTP ${r.status} ${r.json?.message || ''}`);
  r = await req('/api/v1/approver-groups', { method: 'POST', cookie: C.admin, body: { label: 'Claims Panel' } });
  check('group names are unique', r.status === 409, `HTTP ${r.status}`);
  r = await req('/api/v1/approver-groups', { method: 'POST', cookie: C.admin, body: { label: 'Bad', memberIds: [otherAdmin._id] } });
  check("a group can't include another company's users", r.status === 400, `HTTP ${r.status}`);

  r = await createProcess({
    name: 'Panel review', steps: [{ order: 1, name: 'Panel', approverType: 'group', approverGroupId: groupId }],
    actions: { onSubmit: { notifyByEmail: true }, onApprove: { notifyByEmail: true } },
  });
  const panelId = r.json?.data?._id;
  check('a step can name a public group', r.status === 201, `HTTP ${r.status} ${r.json?.message || ''}`);
  const g1 = await claim({ name: 'G1', amount: 10 });
  outbox = [];
  r = await submit(C.owner, g1._id, panelId);
  const groupReq = r.json?.data;
  check('submitting to a group records the group on the step', r.status === 201 && String(groupReq?.steps?.[0]?.approverGroupId) === String(groupId), `HTTP ${r.status} ${r.json?.message || ''}`);
  check(
    'every member of the group is emailed, whether listed or holding a group role',
    [gm1, gm2, roleGroupHolder].every((u) => mailTo(u.email).length === 1) && mailTo(outsider.email).length === 0,
    outbox.map((m) => m.to).join(', '),
  );
  const notifiedIds = (await Notification.find({ tenantId, 'data.approvalRequestId': String(groupReq?._id) }).select('userId').lean()).map((n) => String(n.userId)).sort();
  check('…and notified in the app', notifiedIds.join() === [gm1, gm2, roleGroupHolder].map((u) => String(u._id)).sort().join(), notifiedIds.length);
  const pending = await req('/api/v1/approval-processes/pending/mine', { cookie: C.gm1 });
  check("it appears in a group member's pending queue, not an outsider's", (pending.json?.data || []).some((x) => String(x._id) === String(groupReq?._id)) && ((await req('/api/v1/approval-processes/pending/mine', { cookie: C.outsider })).json?.data || []).length === 0, `queue=${(pending.json?.data || []).length}`);
  r = await decide(C.outsider, groupReq?._id, 'approve');
  check('someone outside the group cannot decide', r.status === 403, `HTTP ${r.status}`);
  r = await decide(C.roleGroupHolder, groupReq?._id, 'approve', 'fine');
  check('a member through the group role can', r.status === 200 && r.json?.data?.status === 'approved', `HTTP ${r.status} ${r.json?.message || ''}`);
  r = await req(`/api/v1/approver-groups/${groupId}`, { method: 'DELETE', cookie: C.admin });
  check('a group used by a process cannot be deleted', r.status === 409 && /Panel review/.test(r.json?.message || ''), `HTTP ${r.status} ${r.json?.message || ''}`);

  // ── Emails to the submitter ──────────────────────────────────────────────
  check(
    'approval emails the submitter with a link to the record',
    mailTo(owner.email).some((m) => /Approved/.test(m.subject) && m.html.includes(`/o/claim/${g1._id}`)),
    mailTo(owner.email).map((m) => m.subject).join(' | '),
  );

  // ── Rejection: required reason, reason field, approver field, emails ─────
  r = await createProcess({
    name: 'Strict review', steps: [{ order: 1, approverType: 'user', approverUserId: mgrA._id }],
    actions: {
      onSubmit: { approverField: 'assigned_to', fieldUpdates: [{ field: 'status', value: 'Pending' }] },
      onReject: { captureReason: true, reasonField: 'reject_note', fieldUpdates: [{ field: 'status', value: 'Rejected' }] },
    },
  });
  const strictId = r.json?.data?._id;
  const s1 = await claim({ name: 'S1', amount: 10, status: 'Draft' });
  r = await submit(C.owner, s1._id, strictId);
  const strictReq = r.json?.data;
  const afterSubmit = (await DynamicRecord.findById(s1._id)).toDataObject();
  check('the approver is written onto the record field the process names', String(afterSubmit.assigned_to) === String(mgrA._id) && afterSubmit.status === 'Pending', JSON.stringify(afterSubmit));
  r = await decide(C.mgrA, strictReq?._id, 'reject');
  check('a rejection without a reason is refused when the process requires one', r.status === 400 && /reason/i.test(r.json?.message || ''), `HTTP ${r.status} ${r.json?.message || ''}`);
  outbox = [];
  r = await decide(C.mgrA, strictReq?._id, 'reject', 'Missing the police report');
  const afterReject = (await DynamicRecord.findById(s1._id)).toDataObject();
  check('with a reason it is rejected, and the reason is stored in its field', r.status === 200 && afterReject.reject_note === 'Missing the police report' && afterReject.status === 'Rejected', JSON.stringify(afterReject));
  const rejMail = mailTo(owner.email).find((m) => /Rejected/.test(m.subject));
  check('the submitter is emailed the rejection with the reason', Boolean(rejMail) && rejMail.html.includes('Missing the police report'), outbox.map((m) => m.subject).join(' | '));

  // optional reason + email switched off
  r = await createProcess({
    name: 'Quiet review', steps: [{ order: 1, approverType: 'user', approverUserId: mgrA._id }],
    actions: { onSubmit: { notifyByEmail: false }, onReject: { captureReason: false, notifyByEmail: false } },
  });
  const quietId = r.json?.data?._id;
  const q1 = await claim({ name: 'Q1', amount: 10 });
  outbox = [];
  r = await submit(C.owner, q1._id, quietId);
  const quietReq = r.json?.data;
  r = await decide(C.mgrA, quietReq?._id, 'reject');
  check('a process can make the reason optional, and turn emails off', r.status === 200 && outbox.length === 0, `HTTP ${r.status} emails=${outbox.length}`);

  // ── Recall restores the approver field ───────────────────────────────────
  const rc = await claim({ name: 'RC', amount: 10, status: 'Draft' });
  r = await submit(C.owner, rc._id, strictId);
  r = await req(`/api/v1/approval-processes/${r.json?.data?._id}/recall`, { method: 'POST', cookie: C.owner });
  const afterRecall = (await DynamicRecord.findById(rc._id)).toDataObject();
  check('recall returns the record to its pre-submission state, approver field included', r.status === 200 && afterRecall.status === 'Draft' && !afterRecall.assigned_to, JSON.stringify(afterRecall));

  // ── Multi-step including a group ─────────────────────────────────────────
  r = await createProcess({
    name: 'Two steps', steps: [
      { order: 1, name: 'Manager', approverType: 'user', approverUserId: mgrA._id },
      { order: 2, name: 'Panel', approverType: 'group', approverGroupId: groupId },
    ],
  });
  const twoId = r.json?.data?._id;
  const t1 = await claim({ name: 'T1', amount: 10 });
  r = await submit(C.owner, t1._id, twoId);
  const twoReq = r.json?.data;
  r = await decide(C.gm1, twoReq?._id, 'approve');
  check('step 2 (a group) cannot decide before step 1', r.status === 403, `HTTP ${r.status}`);
  outbox = [];
  r = await decide(C.mgrA, twoReq?._id, 'approve');
  check('approving step 1 activates the group step and emails the group', r.status === 200 && r.json?.data?.currentStep === 1 && mailTo(gm1.email).length === 1, `HTTP ${r.status} step=${r.json?.data?.currentStep}`);
  r = await decide(C.gm1, twoReq?._id, 'approve');
  check('a group member then completes the process', r.status === 200 && r.json?.data?.status === 'approved', `HTTP ${r.status}`);

  // ── Lead-to-Deal as an ordinary process ──────────────────────────────────
  // (the old workflow's own mail is stubbed; the engine's mail is captured)
  leadApprovalService.sendEmail = async () => {};
  const seeded = await approvalProcessService.ensureLeadApprovalProcess(tenantId);
  const leadProcess = await ApprovalProcess.findOne({ tenantId, systemKey: 'lead_approval' });
  check(
    'every tenant with leads gets a built-in one-step Lead Approval process',
    seeded === true && leadProcess?.steps?.length === 1 && leadProcess?.steps?.[0]?.approverType === 'manager' && leadProcess?.actions?.onApprove?.platformAction === 'convert_lead_to_deal',
    `seeded=${seeded}`,
  );
  check('seeding is idempotent', (await approvalProcessService.ensureLeadApprovalProcess(tenantId)) === false);
  r = await req(`/api/v1/approval-processes/${leadProcess._id}`, { method: 'DELETE', cookie: C.admin });
  check('the built-in process cannot be deleted', r.status === 409, `HTTP ${r.status} ${r.json?.message || ''}`);

  const lead = await mkRecord('lead', leadObj, { name: 'Acme tender', first_name: 'Acme', product_name: 'Pumps' }, owner);
  let info = await req(`/api/v1/leads/${lead._id}/approval-info`, { cookie: C.owner });
  check('a new lead can be submitted', info.json?.data?.canSubmitForApproval === true);

  outbox = [];
  r = await req(`/api/v1/leads/${lead._id}/submit-for-approval`, { method: 'POST', cookie: C.owner });
  const afterLeadSubmit = (await DynamicRecord.findById(lead._id)).toDataObject();
  check(
    'the Lead endpoint submits through the engine: status set, approver recorded',
    r.status === 200 && afterLeadSubmit.approval_status === 'Submitted for Approval' && String(afterLeadSubmit.assigned_approver) === String(boss._id) && (await ApprovalRequest.countDocuments({ tenantId, objectApiName: 'lead', recordId: lead._id, status: 'pending' })) === 1,
    `HTTP ${r.status} ${r.json?.message || ''}`,
  );
  const leadMail = mailTo(boss.email).find((m) => /Lead Approval Request/.test(m.subject));
  check("the owner's manager is emailed, as before", Boolean(leadMail) && leadMail.html.includes(`/o/lead/${lead._id}`) && /Review Lead/.test(leadMail.html), outbox.map((m) => `${m.to}: ${m.subject}`).join(' | '));

  info = await req(`/api/v1/leads/${lead._id}/approval-info`, { cookie: C.boss });
  const infoOther = await req(`/api/v1/leads/${lead._id}/approval-info`, { cookie: C.outsider });
  check('approval-info tells the manager they can decide, and others they cannot', info.json?.data?.canApprove === true && infoOther.json?.data?.canApprove === false, JSON.stringify(info.json?.data));
  r = await req(`/api/v1/leads/${lead._id}/approve`, { method: 'POST', cookie: C.outsider, body: {} });
  check('only the approver can approve a lead', r.status === 403, `HTTP ${r.status}`);

  const clientRecordId = new mongoose.Types.ObjectId().toString();
  outbox = [];
  r = await req(`/api/v1/leads/${lead._id}/approve`, { method: 'POST', cookie: C.boss, body: { clientId: clientRecordId } });
  const approvedLead = (await DynamicRecord.findById(lead._id)).toDataObject();
  const deal = await DynamicRecord.findOne({ tenantId, objectApiName: 'deal' });
  check(
    'approving converts the lead to a deal (same response shape as before)',
    r.status === 200 && approvedLead.approval_status === 'Approved' && approvedLead.is_converted === true && String(approvedLead.related_deal_id) === String(deal?._id) && Boolean(r.json?.data?.lead) && Boolean(r.json?.data?.deal) && String(deal?.toDataObject().client) === clientRecordId,
    `HTTP ${r.status} ${r.json?.message || ''}`,
  );
  const approvedMail = mailTo(owner.email).find((m) => /Lead Approved/.test(m.subject));
  check('the owner is emailed with a link to the new deal', Boolean(approvedMail) && approvedMail.html.includes(`/o/deal/${deal?._id}`) && /View Deal/.test(approvedMail.html), outbox.map((m) => `${m.to}: ${m.subject}`).join(' | '));

  const lead2 = await mkRecord('lead', leadObj, { name: 'Beta tender', first_name: 'Beta' }, owner);
  await req(`/api/v1/leads/${lead2._id}/submit-for-approval`, { method: 'POST', cookie: C.owner });
  outbox = [];
  r = await req(`/api/v1/leads/${lead2._id}/reject`, { method: 'POST', cookie: C.boss, body: { reason: 'Out of scope' } });
  const rejectedLead = (await DynamicRecord.findById(lead2._id)).toDataObject();
  check('rejecting stores the reason and emails the owner', r.status === 200 && rejectedLead.approval_status === 'Rejected' && rejectedLead.rejection_reason === 'Out of scope' && mailTo(owner.email).some((m) => /Lead Rejected/.test(m.subject) && m.html.includes('Out of scope')), `HTTP ${r.status}`);

  const lead3 = await mkRecord('lead', leadObj, { name: 'Gamma tender', first_name: 'Gamma' }, owner);
  await req(`/api/v1/leads/${lead3._id}/submit-for-approval`, { method: 'POST', cookie: C.owner });
  r = await req(`/api/v1/leads/${lead3._id}/reject`, { method: 'POST', cookie: C.boss, body: {} });
  check('the reason stays optional for leads', r.status === 200, `HTTP ${r.status} ${r.json?.message || ''}`);

  // A lead submitted under the old workflow is still decided
  const legacy = await mkRecord('lead', leadObj, { name: 'Old tender', first_name: 'Old', approval_status: 'Submitted for Approval', assigned_approver: boss._id }, owner);
  r = await req(`/api/v1/leads/${legacy._id}/reject`, { method: 'POST', cookie: C.boss, body: { reason: 'legacy' } });
  check('a lead already waiting under the old workflow can still be decided', r.status === 200 && (await DynamicRecord.findById(legacy._id)).toDataObject().approval_status === 'Rejected', `HTTP ${r.status} ${r.json?.message || ''}`);

  // Switched off
  await req(`/api/v1/approval-processes/${leadProcess._id}`, { method: 'PUT', cookie: C.admin, body: { active: false } });
  const lead4 = await mkRecord('lead', leadObj, { name: 'Delta tender' }, owner);
  r = await req(`/api/v1/leads/${lead4._id}/submit-for-approval`, { method: 'POST', cookie: C.owner });
  check('switching the Lead Approval process off stops submissions', r.status === 400 && /switched off/.test(r.json?.message || ''), `HTTP ${r.status} ${r.json?.message || ''}`);
} catch (err) {
  check('test harness ran without error', false, err.stack || err.message);
} finally {
  setMailSender(null);
  if (tenantIds.length) {
    await Tenant.deleteMany({ _id: { $in: tenantIds } });
    await Promise.all(models.map((M) => M.deleteMany({ tenantId: { $in: tenantIds } }).catch(() => {})));
    await TenantConfiguration.deleteMany({ tenantId: { $in: tenantIds } });
  }
  server.close();
  await mongoose.connection.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
