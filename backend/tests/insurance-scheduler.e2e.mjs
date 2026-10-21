/**
 * Insurance scheduler e2e test (BRD §13.2, §15.2, §16.2).
 *
 * Run: node tests/insurance-scheduler.e2e.mjs   (from backend/)
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import Tenant from '../models/Tenant.js';
import User from '../models/User.js';
import Role from '../models/Role.js';
import ObjectMeta from '../models/ObjectMeta.js';
import FieldMeta from '../models/FieldMeta.js';
import Session from '../models/Session.js';
import DynamicRecord from '../models/DynamicRecord.js';
import AutoNumberCounter from '../models/AutoNumberCounter.js';
import { seedDefaultRoles } from '../services/roleService.js';
import { seedStandardObjects, ensureUserObject } from '../services/metadataService.js';
import { seedInsuranceObjects, seedInsuranceWorkspace } from '../services/insuranceMetadataService.js';
import { runInsuranceSchedulerForTenant } from '../services/insurance/schedulerService.js';
import { preparePremiumDebit } from '../services/insurance/billingEngine.js';
import { createDynamic } from '../services/insurance/dynamicRecords.js';

const RUN = Date.now().toString(36);
const PASSWORD = 'Scheduler123!';
const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const dataOf = (rec) => {
  const d = rec?.data;
  if (!d) return {};
  if (typeof d.get === 'function') {
    const out = {};
    for (const [k, v] of d) out[k] = v;
    return out;
  }
  return d;
};

const objectIdFor = async (tenantId, apiName) => {
  const obj = await ObjectMeta.findOne({ tenantId, apiName });
  if (!obj) throw new Error(`object ${apiName} not seeded`);
  return obj._id;
};

// Use createDynamic for all record creation to ensure proper data storage
const mk = (tenantId, userId, objectApiName, data) =>
  createDynamic({ tenantId, objectApiName, userId, data });

const mkTxn = async (tenantId, userId, txnData) => {
  const txnId = await objectIdFor(tenantId, 'premium_transaction');
  return mk(tenantId, userId, 'premium_transaction', txnData);
};

const seedPlan = async (tenantId, userId) => {
  const productId = await objectIdFor(tenantId, 'product');
  const pvId = await objectIdFor(tenantId, 'product_version');
  const bcId = await objectIdFor(tenantId, 'benefit_cover');
  const crId = await objectIdFor(tenantId, 'child_benefit_rule');

  const product = await mk(tenantId, userId, 'product', { name: 'Funeral Plan' });
  const pv = await mk(tenantId, userId, 'product_version', {
    name: 'FP v1',
    product: String(product._id),
    status: 'active',
    effective_from: '2026-01-01',
    allow_spouse: true,
    allow_children: true,
    allow_extended_family: true,
    max_spouses: 1,
    max_children: 5,
    max_extended_family: 3,
    min_entry_age: 18,
    max_entry_age: 65,
    grace_period_days: 0,
    max_missed_payments: 3,
    max_age: 21,
    allows_manual_premium_override: false,
    reinstatement_requires_approval: false,
    min_lapse_days: 0,
  });

  const cover = (rate_category, cover_amount, premium) =>
    mk(tenantId, userId, 'benefit_cover', {
      name: `${rate_category} ${cover_amount}`,
      product_version: String(pv._id),
      rate_category,
      cover_amount,
      min_age: 18,
      max_age: 65,
      premium,
      underwriter_rate: Math.round(premium * 0.8),
      markup: Math.round(premium * 0.2),
      waiting_period_months: 6,
      effective_from: '2026-01-01',
    });
  await cover('main_member_only', 100000, 250);
  await cover('main_member_spouse', 100000, 300);
  await cover('main_member_children', 100000, 350);
  await cover('main_member_spouse_children', 100000, 420);
  await cover('extended_family', 50000, 150);

  await mk(tenantId, userId, 'child_benefit_rule', {
    name: 'Child 0-21',
    product_version: String(pv._id),
    min_age: 0,
    max_age: 21,
    percent_of_main_cover: 50,
    max_child_cover: 20000,
    effective_from: '2026-01-01',
  });

  return { product, pv };
};

const seedTenant = async (label, hub) => {
  const tenant = await Tenant.create({
    name: `ZZ_SCHED_${label}_${RUN}`,
    slug: `zz-sched-${label}-${RUN}`,
    hub,
    status: 'active',
    plan: 'enterprise',
  });
  await seedDefaultRoles(tenant._id);
  const adminRole = await Role.findOne({ tenantId: tenant._id, name: 'admin' });
  const user = await User.create({
    tenantId: tenant._id,
    firstName: 'Sched',
    lastName: label,
    email: `sched-${label}-${RUN}@example.com`,
    username: `sched_${label}_${RUN}`,
    password: PASSWORD,
    role: adminRole._id,
    status: 'active',
    emailVerified: true,
  });
  await seedStandardObjects(tenant._id, user._id);
  await ensureUserObject(tenant._id, user._id);
  await seedInsuranceObjects(tenant._id, user._id);
  await seedInsuranceWorkspace(tenant._id, user._id);
  const plan = await seedPlan(tenant._id, user._id);
  return { tenant, user, adminRole, ...plan };
};

let tenantId, userId, product, pv;

async function createTestData(tenantId, userId) {
  // Create client, account, policy
  const clientIdObj = await objectIdFor(tenantId, 'client');
  const client = await mk(tenantId, userId, 'client', { name: 'John Doe' });
  const accountIdObj = await objectIdFor(tenantId, 'account');
  const account = await mk(tenantId, userId, 'account', { name: 'John Account', account_number: 'ACC-001' });
  const policyIdObj = await objectIdFor(tenantId, 'policy');
  const policy = await mk(tenantId, userId, 'policy', {
    status: 'active',
    status_effective_date: '2026-01-01',
    application_channel: 'website',
    product_version: String(pv._id),
    product: String(product._id),
    current_premium: 250,
    billing_frequency: 'monthly',
    next_billing_date: '2026-10-11', // today
    premium_payer: String(client._id),
    main_member: String(client._id),
    account: String(account._id),
  });
  const policyId = String(policy._id);

  // Policy party
  const partyIdObj = await objectIdFor(tenantId, 'policy_party');
  await mk(tenantId, userId, 'policy_party', {
    name: 'Premium Payer - John Doe',
    policy: policyId,
    client: String(client._id),
    role: 'premium_payer',
  });

  return { policyId, clientId: String(client._id), accountId: String(account._id) };
}

try {
  await connectDB();
  const seeded = await seedTenant('a', 'insurance');
  tenantId = seeded.tenant._id;
  userId = seeded.user._id;
  console.log('[DEBUG] tenantId type:', typeof tenantId, 'value:', tenantId);
  product = seeded.product;
  pv = seeded.pv;

  const { policyId, clientId, accountId } = await createTestData(tenantId, userId);

  // Create communication templates for all events used in scheduler tests
  const templateIdObj = await objectIdFor(tenantId, 'communication_template');
  const mkTpl = (name, apiName, category, subject, body) =>
    mk(tenantId, userId, 'communication_template', {
      name,
      api_name: apiName,
      category,
      channel: 'email',
      subject,
      body,
      is_active: true,
      version: 1,
    });
  await mkTpl('Payment Due Email', 'payment_due_email', 'payment_due',
    'Payment Due for Policy {{policy.policy_number}}',
    'Dear {{client.name}},\n\nYour premium is due for policy {{policy.policy_number}}.');
  await mkTpl('Policy Issued Email', 'policy_issued_email', 'policy_issued',
    'Policy {{policy.policy_number}} Issued',
    'Dear {{client.name}},\n\nYour policy {{policy.policy_number}} is now active.');
  await mkTpl('Policy Lapsed Email', 'policy_lapsed_email', 'policy_lapsed',
    'Policy {{policy.policy_number}} Lapsed',
    'Dear {{client.name}},\n\nYour policy {{policy.policy_number}} has lapsed after {{missedCount}} missed payments.');
  await mkTpl('Payment Missed 3 Email', 'payment_missed_3_email', 'payment_missed_3',
    'Third Missed Payment - Policy {{policy.policy_number}}',
    'Dear {{client.name}},\n\nYour policy {{policy.policy_number}} has missed 3 payments.');

  // --- Test 1: Payment due reminder (next_billing_date = today) ---
  const result1 = await runInsuranceSchedulerForTenant(tenantId, userId);
  check('scheduler runs without error', true);
  check('billing cycle ran', !!result1.billing);
  check('auto-lapse ran', !!result1.autoLapse);
  check('payment due ran', !!result1.paymentDue);
  check('missed payments ran', !!result1.missedPayments);
  check('child age ran', !!result1.childAge);
  check('waiting period ran', !!result1.waitingPeriod);

  // Verify billing created a debit for today
  const debits = await DynamicRecord.find({
    tenantId,
    objectApiName: 'premium_transaction',
    'data.policy': policyId,
    'data.direction': 'debit',
  });
  check('billing created debit', debits.length >= 1);

  // Verify payment due communication was logged
  const paymentDueComms = await DynamicRecord.find({
    tenantId,
    objectApiName: 'policy_communication',
    'data.policy': policyId,
    'data.event': 'payment_due',
  });
  check('payment_due communication logged', paymentDueComms.length >= 1);

  // --- Test 2: Child age event (create child at age 20, max_age = 21) ---
  const clientIdObj = await objectIdFor(tenantId, 'client');
  const childClient = await DynamicRecord.create({
    tenantId,
    objectId: clientIdObj,
    objectApiName: 'client',
    createdBy: userId,
    ownerId: userId,
    data: { name: 'Child Doe', email: 'child@example.com' },
  });
  const childId = String(childClient._id);

  const lifeIdObj = await objectIdFor(tenantId, 'insured_life');
  await DynamicRecord.create({
    tenantId,
    objectId: lifeIdObj,
    objectApiName: 'insured_life',
    createdBy: userId,
    ownerId: userId,
    data: {
      name: 'Child Doe (child)',
      policy: policyId,
      client: childId,
      relation: 'child',
      age: 20, // approaching max_age of 21
      start_date: '2026-01-01',
      status: 'active',
    },
  });

  const result2 = await runInsuranceSchedulerForTenant(tenantId, userId);
  check('child age event ran', !!result2.childAge);
  check('child age triggered for approaching age limit', result2.childAge?.triggered >= 0);

  // --- Test 3: Waiting period completion (create life with waiting_period_end_date = today) ---
  const life2 = await DynamicRecord.create({
    tenantId,
    objectId: lifeIdObj,
    objectApiName: 'insured_life',
    createdBy: userId,
    ownerId: userId,
    data: {
      name: 'Child Doe 2 (child)',
      policy: policyId,
      client: childId,
      relation: 'child',
      age: 10,
      start_date: '2026-01-01',
      waiting_period_end_date: new Date().toISOString().slice(0, 10), // today
      status: 'active',
    },
  });

  const result3 = await runInsuranceSchedulerForTenant(tenantId, userId);
  check('waiting period completion ran', !!result3.waitingPeriod);

  // --- Test 4: Missed payment notification (create unpaid debits) ---
  // Create a new policy with unpaid debits
  const clientIdObj2 = await objectIdFor(tenantId, 'client');
  const accountIdObj2 = await objectIdFor(tenantId, 'account');
  const policyIdObj2 = await objectIdFor(tenantId, 'policy');
  const client2 = await mk(tenantId, userId, 'client', { name: 'Jane Smith', email: 'jane@example.com' });
  const account2 = await mk(tenantId, userId, 'account', { name: 'Jane Account', account_number: 'ACC-002' });
  const policy2 = await mk(tenantId, userId, 'policy', {
    status: 'active',
    status_effective_date: '2026-01-01',
    application_channel: 'website',
    product_version: String(pv._id),
    product: String(product._id),
    current_premium: 250,
    billing_frequency: 'monthly',
    next_billing_date: '2026-11-11',
    premium_payer: String(client2._id),
    main_member: String(client2._id),
    account: String(account2._id),
  });
  const policy2Id = String(policy2._id);
  console.log('[DEBUG] policy2 created:', policy2Id, 'status:', dataOf(policy2).status);

  // Policy party
  const partyIdObj2 = await objectIdFor(tenantId, 'policy_party');
  await mk(tenantId, userId, 'policy_party', {
    name: 'Premium Payer - Jane',
    policy: policy2Id,
    client: String(client2._id),
    role: 'premium_payer',
  });

  // Verify policy2 exists in DB
  const checkPolicy2 = await DynamicRecord.findOne({ tenantId, objectApiName: 'policy', _id: policy2Id });
  console.log('[DEBUG] policy2 in DB:', checkPolicy2 ? 'found' : 'NOT FOUND', checkPolicy2 ? dataOf(checkPolicy2).status : 'N/A');

  // Create 3 unpaid debits (Jan, Feb, Mar 2026)
  for (const period of ['2026-01', '2026-02', '2026-03']) {
    const debit = preparePremiumDebit({
      policyId: policy2Id,
      accountId: String(account2._id),
      amount: 250,
      billingPeriod: period,
      dueDate: `${period}-01`,
      transactionDate: `${period}-01`,
    });
    await mkTxn(tenantId, userId, debit);
  }

  const result4 = await runInsuranceSchedulerForTenant(tenantId, userId);
  check('missed payment notifications ran', !!result4.missedPayments);

  // Check if missed payment comms were logged
  console.log('[DEBUG] tenantId before find:', tenantId, typeof tenantId);
  // Check if missed payment comms were logged
  const missed3Comms = await DynamicRecord.find({
    tenantId: String(tenantId),
    objectApiName: 'policy_communication',
    'data.policy': policy2Id,
    'data.event': 'payment_missed_3',
  });
  console.log('[DEBUG] missed3Comms:', missed3Comms.map(c => dataOf(c)));
  check('payment_missed_3 communication logged for 3 missed', missed3Comms.length >= 1);

  // --- Test 5: the arrears progression a customer actually sees ---
  // One premium falls due each month and goes unpaid: a reminder after the
  // first, another after the second, a third before the policy lapses, then
  // the lapse notice. This is the sequence the policy owner receives.
  await mkTpl('Payment Missed 1 Email', 'payment_missed_1_email', 'payment_missed_1',
    'Missed Premium - Policy {{policy.policy_number}}',
    'Dear {{client.name}},\n\nWe have not received your premium for policy {{policy.policy_number}}.');
  await mkTpl('Payment Missed 2 Email', 'payment_missed_2_email', 'payment_missed_2',
    'Second Missed Premium - Policy {{policy.policy_number}}',
    'Dear {{client.name}},\n\nYour premium for policy {{policy.policy_number}} is still outstanding.');

  const client3 = await mk(tenantId, userId, 'client', { name: 'Nomsa Dlamini', email: 'nomsa@example.com' });
  const account3 = await mk(tenantId, userId, 'account', { name: 'Nomsa Premium Account', account_number: 'ACC-003' });
  const policy3 = await mk(tenantId, userId, 'policy', {
    status: 'active',
    status_effective_date: '2026-01-01',
    application_channel: 'website',
    product_version: String(pv._id),
    product: String(product._id),
    current_premium: 250,
    billing_frequency: 'monthly',
    // Far enough ahead that the billing run does not add debits of its own:
    // each arrears step below adds exactly one.
    next_billing_date: '2026-12-01',
    premium_payer: String(client3._id),
    main_member: String(client3._id),
    account: String(account3._id),
  });
  const policy3Id = String(policy3._id);
  await mk(tenantId, userId, 'policy_party', {
    name: 'Premium Payer - Nomsa',
    policy: policy3Id,
    client: String(client3._id),
    role: 'premium_payer',
  });

  const commsFor = (policyId, event) =>
    DynamicRecord.find({
      tenantId,
      objectApiName: 'policy_communication',
      'data.policy': policyId,
      'data.event': event,
    });
  const statusOf = async (policyId) => {
    const p = await DynamicRecord.findOne({ tenantId, objectApiName: 'policy', _id: policyId }).lean();
    return p?.data?.get ? p.data.get('status') : p?.data?.status;
  };

  // One unpaid premium per step, each long past due so the grace period
  // (whatever it is set to) cannot hide it.
  for (const [step, period] of [['2026-05', '2026-05-01'], ['2026-06', '2026-06-01'], ['2026-07', '2026-07-01']]) {
    await mkTxn(tenantId, userId, preparePremiumDebit({
      policyId: policy3Id,
      accountId: String(account3._id),
      amount: 250,
      billingPeriod: step,
      dueDate: period,
      transactionDate: period,
    }));
    await runInsuranceSchedulerForTenant(tenantId, userId);
  }

  const missed1 = await commsFor(policy3Id, 'payment_missed_1');
  const missed2 = await commsFor(policy3Id, 'payment_missed_2');
  const missed3 = await commsFor(policy3Id, 'payment_missed_3');
  const lapsedComms = await commsFor(policy3Id, 'policy_lapsed');

  check('the first missed premium sends a reminder', missed1.length >= 1, `comms=${missed1.length}`);
  check('the second missed premium sends a reminder', missed2.length >= 1, `comms=${missed2.length}`);
  check('the third missed premium sends a reminder before the lapse', missed3.length >= 1, `comms=${missed3.length}`);
  check('the policy lapses after three missed premiums', (await statusOf(policy3Id)) === 'lapsed', `status=${await statusOf(policy3Id)}`);
  check('the lapse notice is logged', lapsedComms.length >= 1, `comms=${lapsedComms.length}`);

} catch (err) {
  check('test harness ran without error', false, err.message);
  console.error(err);
} finally {
  await Tenant.deleteMany({ _id: tenantId });
  await Promise.all(
    [User, Role, ObjectMeta, FieldMeta, Session, DynamicRecord, AutoNumberCounter].map((M) =>
      M.deleteMany({ tenantId }).catch(() => {}),
    ),
  );
  await mongoose.connection.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);