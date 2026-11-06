import mongoose from 'mongoose';

/**
 * Automation - Workflow/Flow definitions.
 * Supports record-triggered, scheduled, and screen flows.
 */

// A single node in the flow graph
const flowNodeSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    type: {
      type: String,
      required: true,
      enum: [
        'trigger',
        'condition',
        'action_create_record',
        'action_update_record',
        'action_delete_record',
        'action_send_email',
        'action_send_message_template', // WhatsApp/Messenger/Instagram/SMS template, provider-approval gated
        'action_send_notification',
        'action_webhook',
        'action_http_request', // call an ExternalObject or arbitrary endpoint
        'action_toast', // show a toast notification in the browser
        'action_generate_pdf', // render a PDF template and optionally
        'action_update_related_records', // bulk-update child records via a lookup field
        'action_wait',
        'screen',
        'loop',
        'decision',
        'assignment',
        'navigate', // navigate user to a record or list view (screen flows)
        'end',
        'custom_code',
        'formula',
        'transform',
        'collection_filter',
        'collection_sort',
        'get_records',
        'delete_records',
        'pause',
        'subflow',
      ],
    },
    label: { type: String, required: true },
    description: { type: String },
    position: {
      x: { type: Number, default: 0 },
      y: { type: Number, default: 0 },
    },
    config: { type: mongoose.Schema.Types.Mixed, default: {} },
    // Next node(s) - supports branching
    nextNodes: [
      {
        nodeId: { type: String },
        condition: { type: mongoose.Schema.Types.Mixed }, // evaluated to determine branch
        label: { type: String }, // "Yes" / "No" etc.
      },
    ],
  },
  { _id: false },
);

const automationSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },

    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    apiName: { type: String, required: true, trim: true, lowercase: true },

    type: {
      type: String,
      required: true,
      enum: [
        'record_triggered', // fires on record create/update/delete
        'scheduled', // runs on a schedule (cron)
        'screen_flow', // interactive user-facing flow
        'autolaunched', // triggered programmatically
      ],
      default: 'record_triggered',
    },

    // Which external object this automation can call / is triggered by
    externalObjectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ExternalObject',
    },

    isActive: { type: Boolean, default: false },
    isValid: { type: Boolean, default: false },

    // Execution control
    order: { type: Number, default: 0 }, // lower fires first
    maxDepth: { type: Number, default: 1 }, // max re-entry depth (1 = no recursion)
    allowRecursion: { type: Boolean, default: false }, // explicit opt-in

    // Trigger configuration
    trigger: {
      objectApiName: { type: String }, // which object triggers this
      events: [{ type: String, enum: ['create', 'update', 'delete', 'all', 'incoming_call', 'outgoing_call', 'missed_call', 'recording_available', 'call_outcome'] }],
      runWhen: {
        type: String,
        enum: ['always', 'conditions_met'],
        default: 'always',
      },
      conditions: [{ type: mongoose.Schema.Types.Mixed }], // older list-style conditions
      // BRD 7.1: Entry Condition — a true/false formula, same builder as
      // Validation Rules (ISCHANGED, CONFIG, AND/OR/NOT). The flow only runs
      // for a record when it is true. Empty = always.
      entryCondition: { type: String, trim: true, default: '' },
      schedule: {
        // for scheduled flows
        // 'relative_date': once per record, N days before/after/on a date
        //   field (e.g. 3 days before Due Date), at `time` (UTC) each day.
        // 'cron': on a cron schedule, for every matching record (or once with
        //   no record when no object is set).
        mode: { type: String, enum: ['cron', 'relative_date'], default: 'cron' },
        cron: { type: String },
        timezone: { type: String, default: 'UTC' },
        dateField: { type: String },
        days: { type: Number, default: 0, min: 0, max: 3650 },
        when: { type: String, enum: ['before', 'after', 'on'], default: 'before' },
        time: { type: String, default: '08:00' }, // HH:MM, UTC
      },
    },

    // The flow graph - list of nodes
    nodes: [flowNodeSchema],

    // Variables used within the flow
    variables: [
      {
        name: { type: String, required: true },
        dataType: {
          type: String,
          enum: ['text', 'number', 'boolean', 'date', 'record', 'collection'],
        },
        isInput: { type: Boolean, default: false },
        isOutput: { type: Boolean, default: false },
        defaultValue: { type: mongoose.Schema.Types.Mixed },
      },
    ],

    // Execution stats
    stats: {
      totalRuns: { type: Number, default: 0 },
      successRuns: { type: Number, default: 0 },
      failedRuns: { type: Number, default: 0 },
      lastRunAt: { type: Date },
      lastRunStatus: { type: String, enum: ['success', 'failed', 'skipped'] },
    },

    version: { type: Number, default: 1 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    lastModifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  {
    timestamps: true,
  },
);

/**
 * BRD 7.1 Trigger Type, as the admin sees it, derived from the flow's type and
 * events: record_created | record_updated | record_created_or_updated |
 * record_deleted | scheduled | manual.
 */
automationSchema.virtual('triggerType').get(function triggerType() {
  if (this.type === 'scheduled') return 'scheduled';
  if (this.type !== 'record_triggered') return 'manual';
  const ev = new Set(this.trigger?.events || []);
  if (ev.has('all') || (ev.has('create') && ev.has('update'))) return 'record_created_or_updated';
  if (ev.has('create')) return 'record_created';
  if (ev.has('update')) return 'record_updated';
  if (ev.has('delete')) return 'record_deleted';
  return 'record_created';
});
automationSchema.set('toJSON', { virtuals: true });
automationSchema.set('toObject', { virtuals: true });

automationSchema.index({ tenantId: 1, apiName: 1 }, { unique: true });
automationSchema.index({ tenantId: 1, isActive: 1, type: 1 });
automationSchema.index({
  tenantId: 1,
  'trigger.objectApiName': 1,
  isActive: 1,
});

export default mongoose.model('Automation', automationSchema);
