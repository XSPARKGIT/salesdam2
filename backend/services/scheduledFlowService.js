import Automation from '../models/Automation.js';
import DynamicRecord from '../models/DynamicRecord.js';
import FlowScheduleRun from '../models/FlowScheduleRun.js';
import { runAutomation } from './automationService.js';
import logger from '../utils/logger.js';

/**
 * Scheduled / time-based flows (BRD 7.1) — generalises the insurance
 * notification scheduler to any object and any flow.
 *
 *  - relative_date: "N days before / after / on <date field>". Each day, from
 *    the flow's time of day, it runs once for every record whose date field
 *    falls on the matching day (e.g. Due Date = today + 3).
 *  - cron: at the times a cron expression gives, for every record of the
 *    flow's object (or once with no record when no object is set).
 *
 * Entry conditions apply as for every flow (runAutomation checks them).
 * FlowScheduleRun records each run so a record is never processed twice for
 * the same day (or cron minute), however often the scheduler ticks.
 */

const MAX_RECORDS_PER_RUN = 5000;
const RESCAN_MS = 15 * 60 * 1000; // relative-date flows are re-scanned at most every 15 min

// ── Time helpers ─────────────────────────────────────────────────────────────

/** Date/time parts of `date` in an IANA time zone (falls back to UTC). */
export const zonedParts = (date, timeZone = 'UTC') => {
  let fmt;
  try {
    fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
    });
  } catch {
    return zonedParts(date, 'UTC');
  }
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    year: Number(p.year), month: Number(p.month), day: Number(p.day),
    hour: Number(p.hour), minute: Number(p.minute), weekday,
  };
};

const shiftDate = (isoDate, days) => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

// ── Cron ─────────────────────────────────────────────────────────────────────

const CRON_RANGES = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];

/** Parse one cron field into a Set of allowed numbers, or throw. */
const parseCronField = (field, [min, max]) => {
  const allowed = new Set();
  for (const part of String(field).split(',')) {
    const m = part.match(/^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/);
    if (!m) throw new Error(`"${part}" is not a valid cron value`);
    const step = m[4] ? Number(m[4]) : 1;
    const lo = m[1] === '*' ? min : Number(m[2]);
    const hi = m[1] === '*' ? max : m[3] !== undefined ? Number(m[3]) : m[4] ? max : lo;
    if (step < 1 || lo < min || hi > max || lo > hi) throw new Error(`"${part}" is out of range (${min}–${max})`);
    for (let v = lo; v <= hi; v += step) allowed.add(v);
  }
  return allowed;
};

/** Parse a 5-field cron expression; throws with a readable message. */
export const parseCron = (expr) => {
  const fields = String(expr || '').trim().split(/\s+/);
  if (fields.length !== 5) throw new Error('A cron schedule has 5 parts: minute hour day month weekday');
  const sets = fields.map((f, i) => parseCronField(f, CRON_RANGES[i]));
  if (sets[4].has(7)) sets[4].add(0); // 7 = Sunday too
  return { sets, domAny: fields[2] === '*', dowAny: fields[4] === '*' };
};

/** Does the cron expression fire at the minute of `date` in `timeZone`? */
export const cronMatches = (expr, date, timeZone = 'UTC') => {
  const { sets, domAny, dowAny } = parseCron(expr);
  const t = zonedParts(date, timeZone);
  const [mins, hours, doms, months, dows] = sets;
  if (!mins.has(t.minute) || !hours.has(t.hour) || !months.has(t.month)) return false;
  // Standard cron: when both day-of-month and weekday are restricted, either may match.
  const domOk = doms.has(t.day);
  const dowOk = dows.has(t.weekday);
  if (domAny && dowAny) return true;
  if (domAny) return dowOk;
  if (dowAny) return domOk;
  return domOk || dowOk;
};

// ── Running ──────────────────────────────────────────────────────────────────

/** Records of `objectApiName` whose date field falls on `isoDate`. */
const recordsOnDate = (tenantId, objectApiName, dateField, isoDate) => {
  const start = new Date(`${isoDate}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const path = `data.${dateField}`;
  return DynamicRecord.find({
    tenantId,
    objectApiName,
    isDeleted: false,
    $or: [
      { [path]: { $gte: start, $lt: end } },
      { [path]: { $regex: `^${isoDate}` } },
    ],
  }).limit(MAX_RECORDS_PER_RUN);
};

/** Run the flow for one record at most once per slot. */
const runOnce = async (automation, record, slot, tally) => {
  let entry;
  try {
    entry = await FlowScheduleRun.create({
      tenantId: automation.tenantId,
      automationId: automation._id,
      recordId: record?._id || null,
      slot,
    });
  } catch (err) {
    if (err?.code === 11000) {
      tally.alreadyRun++;
      return;
    }
    throw err;
  }
  const status = await runAutomation(automation._id, record, automation.tenantId);
  if (status === 'skipped') {
    // Entry condition not met (yet) — let a later tick check again today.
    await FlowScheduleRun.deleteOne({ _id: entry._id });
    tally.skipped++;
  } else {
    if (status === 'failed') await FlowScheduleRun.updateOne({ _id: entry._id }, { status: 'failed' });
    tally[status === 'failed' ? 'failed' : 'ran']++;
  }
};

const lastScan = new Map(); // automationId → ms, for relative-date flows

/**
 * Run one scheduled flow for `now`. With `force` the time-of-day / cron check
 * is skipped ("Run now"); each record still runs at most once per day or
 * cron minute. Returns a tally.
 */
export const runScheduledFlow = async (automation, now = new Date(), { force = false } = {}) => {
  const tally = { matched: 0, ran: 0, skipped: 0, failed: 0, alreadyRun: 0 };
  const schedule = automation.trigger?.schedule || {};
  const tz = schedule.timezone || 'UTC';
  const t = zonedParts(now, tz);
  const objectApiName = automation.trigger?.objectApiName;

  if (schedule.mode === 'relative_date') {
    if (!objectApiName || !schedule.dateField) return { ...tally, note: 'No object or date field set.' };
    const [hh, mm] = String(schedule.time || '08:00').split(':').map(Number);
    if (!force && t.hour * 60 + t.minute < (hh || 0) * 60 + (mm || 0)) return { ...tally, note: 'Not time yet today.' };
    const days = Number(schedule.days) || 0;
    // "3 days before Due Date" runs today for records due 3 days from now.
    const target = schedule.when === 'after' ? shiftDate(t.date, -days) : schedule.when === 'on' ? t.date : shiftDate(t.date, days);
    const records = await recordsOnDate(automation.tenantId, objectApiName, schedule.dateField, target);
    tally.matched = records.length;
    tally.targetDate = target;
    for (const record of records) await runOnce(automation, record, t.date, tally);
    return tally;
  }

  // cron
  if (!schedule.cron) return { ...tally, note: 'No cron schedule set.' };
  if (!force && !cronMatches(schedule.cron, now, tz)) return { ...tally, note: 'Not scheduled for this minute.' };
  const slot = `${t.date}T${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`;
  if (!objectApiName) {
    tally.matched = 1;
    await runOnce(automation, { _id: null, objectApiName: null, data: {} }, slot, tally);
    return tally;
  }
  const records = await DynamicRecord.find({ tenantId: automation.tenantId, objectApiName, isDeleted: false })
    .limit(MAX_RECORDS_PER_RUN);
  tally.matched = records.length;
  for (const record of records) await runOnce(automation, record, slot, tally);
  return tally;
};

/** One scheduler tick: every active scheduled flow (optionally one tenant's). */
export const runScheduledFlows = async ({ now = new Date(), tenantId = null } = {}) => {
  const flows = await Automation.find({
    ...(tenantId ? { tenantId } : {}),
    type: 'scheduled',
    isActive: true,
  });
  const results = [];
  for (const flow of flows) {
    const id = String(flow._id);
    if (flow.trigger?.schedule?.mode === 'relative_date') {
      const last = lastScan.get(id) || 0;
      if (now.getTime() - last < RESCAN_MS) continue;
      lastScan.set(id, now.getTime());
    }
    try {
      results.push({ automationId: id, ...(await runScheduledFlow(flow, now)) });
    } catch (err) {
      logger.error(`Scheduled flow "${flow.name}" failed: ${err.message}`);
      results.push({ automationId: id, error: err.message });
    }
  }
  return results;
};

let timer = null;
let running = false;

/** Start the in-process scheduler (once a minute). Set FLOW_SCHEDULER=off to disable. */
export const startFlowScheduler = () => {
  if (timer || process.env.FLOW_SCHEDULER === 'off') return;
  timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await runScheduledFlows();
    } catch (err) {
      logger.error(`Flow scheduler tick failed: ${err.message}`);
    } finally {
      running = false;
    }
  }, 60 * 1000);
  timer.unref?.();
  logger.info('Flow scheduler started (checks scheduled flows every minute).');
};
