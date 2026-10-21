/**
 * Unified insurance scheduler (BRD §13.2, §15.2, §16.2).
 *
 * Runs all periodic insurance tasks:
 * - Billing cycle (create premium debits for policies due today)
 * - Auto-lapse evaluation (check arrears, transition eligible policies to Lapsed)
 * - Child age events (identify children approaching/reaching max age, trigger comms)
 * - Waiting period completions (notify when waiting period ends)
 * - Payment due reminders (trigger payment_due communications)
 * - Missed payment notifications (1st, 2nd, 3rd missed)
 *
 * Designed to be invoked daily via cron/systemd/Cloud Scheduler:
 *   node scripts/run-insurance-scheduler.js
 *
 * Or imported and called programmatically.
 */

import DynamicRecord from '../../models/DynamicRecord.js';
import { runBillingCycle } from './billingRunService.js';
import { runAutoLapseEvaluation, runAutoLapseAllTenants } from './autoLapseService.js';
import { triggerChildAgeEvent, triggerWaitingPeriodComplete, triggerMissedPayment1, triggerMissedPayment2, triggerMissedPayment3, triggerPaymentDue } from './communicationTriggers.js';
import { findOne, findMany, updateDynamic } from './dynamicRecords.js';
import { dataOf } from './pricingService.js';
import { evaluateArrears } from './billingEngine.js';
import { AppError } from '../../utils/errors.js';

const POLICY_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  ARREARS: 'in_arrears',
  LAPSED: 'lapsed',
  CANCELLED: 'cancelled',
  CLOSED: 'closed',
};

const now = () => new Date().toISOString().slice(0, 10);
const addDays = (isoDate, days) => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(days));
  return d.toISOString().slice(0, 10);
};

/**
 * Run child age event detection for a tenant.
 * Checks all active insured lives with relation 'child' or 'extended_family'
 * against Product Version max_age rules and triggers age limit action communications.
 */
export const runChildAgeEvents = async (tenantId, systemUserId) => {
  // Find active policies with active insured lives that are children/extended family
  const policies = await findMany(
    tenantId,
    'policy',
    { 'data.status': { $in: [POLICY_STATUS.ACTIVE, POLICY_STATUS.INACTIVE, POLICY_STATUS.ARREARS] } },
  );

  if (!policies.length) return { processed: 0, triggered: 0, results: [] };

  const results = [];
  let triggered = 0;

  for (const policy of policies) {
    const pData = dataOf(policy);
    if (!pData.product_version) continue;

    const pv = await findOne(tenantId, 'product_version', { _id: pData.product_version });
    if (!pv) continue;
    const pvData = dataOf(pv);
    const maxChildAge = Number(pvData.max_age) || 21; // Default to 21 per BRD

    const lives = await findMany(tenantId, 'insured_life', {
      'data.policy': String(policy._id),
      'data.status': 'active',
      'data.relation': { $in: ['child', 'extended_family'] },
    });

    for (const life of lives) {
      const lData = dataOf(life);
      const age = Number(lData.age);
      if (isNaN(age)) continue;

      // Check if approaching max age (within 90 days) or at max age
      const ageLimit = maxChildAge;
      const approaching = age >= ageLimit - 1 && age < ageLimit; // within ~1 year (simplified)
      const atLimit = age >= ageLimit;

      if (approaching || atLimit) {
        const action = atLimit ? 'age_limit_reached' : 'approaching_age_limit';
        try {
          await triggerChildAgeEvent({
            tenantId,
            userId: systemUserId,
            policyId: String(policy._id),
            childId: String(life._id),
            age,
            action: atLimit ? 'end_cover' : 'amendment_required',
          });
          triggered++;
          results.push({ policyId: String(policy._id), lifeId: String(life._id), age, action, triggered: true });
        } catch (e) {
          results.push({ policyId: String(policy._id), lifeId: String(life._id), age, action, triggered: false, error: e.message });
        }
      }
    }
  }

  return { processed: policies.length, triggered, results };
};

/**
 * Run waiting period completion detection.
 * Finds insured lives whose waiting_period_end_date is today and triggers completion communication.
 */
export const runWaitingPeriodCompletions = async (tenantId, systemUserId) => {
  const today = now();

  // Find insured lives with waiting_period_end_date == today and status active
  const lives = await DynamicRecord.find({
    tenantId,
    objectApiName: 'insured_life',
    'data.waiting_period_end_date': today,
    'data.status': 'active',
    isDeleted: false,
  }).lean();

  if (!lives.length) return { processed: 0, triggered: 0, results: [] };

  let triggered = 0;
  const results = [];

  for (const life of lives) {
    const lData = dataOf(life);
    const policyId = lData.policy;
    try {
      await triggerWaitingPeriodComplete({
        tenantId,
        userId: systemUserId,
        policyId,
        insuredLifeId: String(life._id),
      });
      triggered++;
      results.push({ policyId, lifeId: String(life._id), triggered: true });
    } catch (e) {
      results.push({ policyId, lifeId: String(life._id), triggered: false, error: e.message });
    }
  }

  return { processed: lives.length, triggered, results };
};

/**
 * Run missed payment notifications (1st, 2nd, 3rd missed).
 * Uses the auto-lapse evaluation logic to determine which policies have
 * reached their 1st, 2nd, or 3rd missed payment and triggers the appropriate communication.
 */
export const runMissedPaymentNotifications = async (tenantId, systemUserId) => {
  const policies = await findMany(
    tenantId,
    'policy',
    { 'data.status': { $in: [POLICY_STATUS.ACTIVE, POLICY_STATUS.INACTIVE, POLICY_STATUS.ARREARS] } },
  );

  if (!policies.length) return { processed: 0, triggered: 0, results: [] };

  let triggered = 0;
  const results = [];

  for (const policy of policies) {
    const pData = dataOf(policy);
    if (!pData.product_version) continue;

    const pv = await findOne(tenantId, 'product_version', { _id: pData.product_version });
    if (!pv) continue;
    const pvData = dataOf(pv);
    const graceDays = Number(pvData.grace_period_days) || 0;

    // Load premium transactions
    const txns = await findMany(tenantId, 'premium_transaction', { 'data.policy': String(policy._id) });
    // evaluateArrears reads flat fields (status, type, due_date, amount), but a
    // DynamicRecord keeps them in its `data` map — pass the field values, not
    // the record, or every debit is filtered out and nothing is ever missed.
    const debits = txns
      .filter((t) => dataOf(t).direction === 'debit' && dataOf(t).status === 'posted')
      .map((t) => ({ _id: String(t._id), ...dataOf(t) }));

    if (!debits.length) continue;

    // Evaluate arrears
    const evaluation = evaluateArrears({
      debits,
      allowedMissed: Number(pvData.max_missed_payments) || 3,
      graceDays,
      asOfDate: new Date(),
    });

    // Check if we just crossed a missed payment threshold (1, 2, or 3)
    const missedCount = evaluation.missedCount;
    if ([1, 2, 3].includes(missedCount)) {
      const triggerFn = missedCount === 1 ? triggerMissedPayment1 :
                        missedCount === 2 ? triggerMissedPayment2 :
                        triggerMissedPayment3;

      try {
        await triggerFn({ tenantId, userId: systemUserId, policyId: String(policy._id) });
        triggered++;
        results.push({ policyId: String(policy._id), missedCount, triggered: true });
      } catch (e) {
        results.push({ policyId: String(policy._id), missedCount, triggered: false, error: e.message });
      }
    }
  }

  return { processed: policies.length, triggered, results };
};

/**
 * Run payment due reminders for policies with premium debits due today.
 */
export const runPaymentDueReminders = async (tenantId, systemUserId) => {
  const today = now();

  const debits = await DynamicRecord.find({
    tenantId,
    objectApiName: 'premium_transaction',
    'data.direction': 'debit',
    'data.status': 'posted',
    'data.due_date': today,
    isDeleted: false,
  }).lean();

  if (!debits.length) return { processed: 0, triggered: 0, results: [] };

  let triggered = 0;
  const results = [];

  for (const debit of debits) {
    const dData = dataOf(debit);
    const policyId = dData.policy;
    try {
      await triggerPaymentDue({
        tenantId,
        userId: systemUserId,
        policyId,
        transactionId: String(debit._id),
      });
      triggered++;
      results.push({ policyId, debitId: String(debit._id), triggered: true });
    } catch (e) {
      results.push({ policyId, debitId: String(debit._id), triggered: false, error: e.message });
    }
  }

  return { processed: debits.length, triggered, results };
};

/**
 * Run all scheduled insurance tasks for a single tenant.
 */
export const runInsuranceSchedulerForTenant = async (tenantId, systemUserId) => {
  const results = {};

  // 1. Billing cycle (create premium debits)
  try {
    results.billing = await runBillingCycle(tenantId, systemUserId);
  } catch (e) {
    results.billing = { error: e.message };
    console.error(`Billing run failed for tenant ${tenantId}:`, e.message);
  }

  // 2. Missed payment notifications
  //    Before auto-lapse on purpose: auto-lapse lapses a policy that has just
  //    crossed the three-missed threshold, and the missed-payment job only
  //    looks at active/inactive/arrears policies — so the "3rd missed payment"
  //    notice was never sent, the customer only ever got the lapse notice.
  try {
    results.missedPayments = await runMissedPaymentNotifications(tenantId, systemUserId);
  } catch (e) {
    results.missedPayments = { error: e.message };
    console.error(`Missed payment notifications failed for tenant ${tenantId}:`, e.message);
  }

  // 3. Auto-lapse evaluation
  try {
    results.autoLapse = await runAutoLapseEvaluation(tenantId, systemUserId);
  } catch (e) {
    results.autoLapse = { error: e.message };
    console.error(`Auto-lapse failed for tenant ${tenantId}:`, e.message);
  }

  // 4. Payment due reminders
  try {
    results.paymentDue = await runPaymentDueReminders(tenantId, systemUserId);
  } catch (e) {
    results.paymentDue = { error: e.message };
    console.error(`Payment due reminders failed for tenant ${tenantId}:`, e.message);
  }

  // 5. Child age events
  try {
    results.childAge = await runChildAgeEvents(tenantId, systemUserId);
  } catch (e) {
    results.childAge = { error: e.message };
    console.error(`Child age events failed for tenant ${tenantId}:`, e.message);
  }

  // 6. Waiting period completions
  try {
    results.waitingPeriod = await runWaitingPeriodCompletions(tenantId, systemUserId);
  } catch (e) {
    results.waitingPeriod = { error: e.message };
    console.error(`Waiting period completions failed for tenant ${tenantId}:`, e.message);
  }

  return results;
};

/**
 * Run all scheduled insurance tasks across all insurance tenants.
 */
export const runInsuranceSchedulerAllTenants = async (systemUserId) => {
  const tenants = await DynamicRecord.db.db
    .collection('tenants')
    .find({ status: 'active', hub: 'insurance' })
    .toArray();

  const allResults = {};
  for (const tenant of tenants) {
    try {
      allResults[String(tenant._id)] = await runInsuranceSchedulerForTenant(String(tenant._id), systemUserId);
    } catch (e) {
      console.error(`Scheduler failed for tenant ${tenant.name}:`, e.message);
      allResults[String(tenant._id)] = { error: e.message };
    }
  }
  return allResults;
};

export default {
  runInsuranceSchedulerForTenant,
  runInsuranceSchedulerAllTenants,
  runChildAgeEvents,
  runWaitingPeriodCompletions,
  runMissedPaymentNotifications,
  runPaymentDueReminders,
};