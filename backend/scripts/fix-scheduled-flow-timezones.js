/**
 * One-time migration: set timezone on all scheduled automations that have
 * no timezone or the placeholder 'UTC' default.
 *
 * Usage:
 *   node scripts/fix-scheduled-flow-timezones.js [--timezone Africa/Johannesburg] [--dry-run]
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import Automation from '../models/Automation.js';

const args = process.argv.slice(2);
const tzArg = args.indexOf('--timezone');
const TARGET_TZ = tzArg !== -1 ? args[tzArg + 1] : 'Africa/Johannesburg';
const DRY_RUN = args.includes('--dry-run');

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB');

  // Find all scheduled automations where timezone is missing or 'UTC'
  const flows = await Automation.find({ type: 'scheduled' });

  const toFix = flows.filter((f) => {
    const tz = f.trigger?.schedule?.timezone;
    return !tz || tz === 'UTC';
  });

  console.log(`Found ${flows.length} scheduled flow(s) total.`);
  console.log(`Found ${toFix.length} flow(s) with no timezone or UTC:\n`);

  for (const flow of toFix) {
    const current = flow.trigger?.schedule?.timezone || '(none)';
    console.log(`  ${DRY_RUN ? '[DRY RUN] Would update' : 'Updating'}: "${flow.name}" (${flow._id})  ${current} → ${TARGET_TZ}`);

    if (!DRY_RUN) {
      await Automation.updateOne(
        { _id: flow._id },
        { $set: { 'trigger.schedule.timezone': TARGET_TZ } },
      );
    }
  }

  if (toFix.length === 0) {
    console.log('Nothing to update.');
  } else if (DRY_RUN) {
    console.log(`\nDry run complete. Re-run without --dry-run to apply.`);
  } else {
    console.log(`\nDone. Updated ${toFix.length} flow(s) to timezone "${TARGET_TZ}".`);
  }

  await mongoose.disconnect();
}

run().catch((err) => { console.error(err); process.exit(1); });
