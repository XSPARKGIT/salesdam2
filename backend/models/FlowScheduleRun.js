import mongoose from 'mongoose';

/**
 * FlowScheduleRun — one scheduled-flow run for one record on one day, so a
 * time-based flow ("3 days before Due Date") runs once per record however
 * often the scheduler ticks (BRD 7.1). `recordId` is null for a cron flow with
 * no object; `slot` is the day (YYYY-MM-DD) or, for cron, the minute run.
 */
const flowScheduleRunSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    automationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Automation', required: true },
    recordId: { type: mongoose.Schema.Types.ObjectId, default: null },
    slot: { type: String, required: true },
    status: { type: String, enum: ['success', 'failed', 'skipped'], default: 'success' },
  },
  { timestamps: true },
);

flowScheduleRunSchema.index({ automationId: 1, recordId: 1, slot: 1 }, { unique: true });

export default mongoose.model('FlowScheduleRun', flowScheduleRunSchema);
