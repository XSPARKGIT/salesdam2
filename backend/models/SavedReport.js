import mongoose from 'mongoose';

const filterSchema = new mongoose.Schema(
  {
    field: { type: String, required: true },
    operator: {
      type: String,
      enum: [
        'eq', 'neq', 'gt', 'gte', 'lt', 'lte',
        'contains', 'not_contains', 'starts_with', 'ends_with',
        'in', 'not_in',
        'is_null', 'is_not_null',
        'between',
      ],
      default: 'eq',
    },
    value: { type: mongoose.Schema.Types.Mixed },
    value2: { type: mongoose.Schema.Types.Mixed },
  },
  { _id: false },
);

const aggregationSchema = new mongoose.Schema(
  {
    field: { type: String },
    func: {
      type: String,
      enum: ['count', 'sum', 'avg', 'min', 'max'],
      required: true,
    },
    alias: { type: String },
  },
  { _id: false },
);

const savedReportSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    objectApiName: { type: String, required: true },
    groupBy: { type: String },
    aggregations: [aggregationSchema],
    filters: [filterSchema],
    dateRange: {
      field: { type: String },
      from: { type: String },
      to: { type: String },
    },
    chartType: {
      type: String,
      enum: ['table', 'bar', 'line', 'pie', 'metric', 'donut'],
      default: 'table',
    },
    columns: [{ type: String }],
    sortField: { type: String },
    sortOrder: { type: String, enum: ['asc', 'desc'], default: 'desc' },
    limit: { type: Number, default: 100 },
    crossObject: {
      lookupField: { type: String },
      relatedObject: { type: String },
      relatedGroupBy: { type: String },
    },
    sharing: {
      access: {
        type: String,
        enum: ['private', 'workspace', 'roles', 'users'],
        default: 'private',
      },
      sharedWithRoles: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Role' }],
      sharedWithUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    },
    folderId: { type: mongoose.Schema.Types.ObjectId, default: null },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    lastModifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    lastRunAt: { type: Date },
  },
  { timestamps: true },
);

savedReportSchema.index({ tenantId: 1, createdBy: 1 });
savedReportSchema.index({ tenantId: 1, objectApiName: 1 });

export default mongoose.model('SavedReport', savedReportSchema);
