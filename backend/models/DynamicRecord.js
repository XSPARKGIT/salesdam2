import mongoose from 'mongoose';

/**
 * DynamicRecord - Stores actual CRM data for any custom object.
 * Uses a flexible `data` map to accommodate any field schema.
 * All records are isolated by tenantId + objectApiName.
 */
const dynamicRecordSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
    index: true,
  },
  objectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ObjectMeta',
    required: true,
    index: true,
  },
  objectApiName: { type: String, required: true, index: true },

  // The actual field data - dynamic key/value store
  data: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {},
  },

  // Record type (if object supports record types)
  recordTypeId: { type: mongoose.Schema.Types.ObjectId, ref: 'RecordType' },

  // Owner of the record
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },

  // Soft delete
  isDeleted: { type: Boolean, default: false, index: true },
  deletedAt: { type: Date },
  deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  // Duplicate merge (Core BRD §3.4). A merged-away record points at its
  // survivor; the survivor keeps an append-only history so a wrong merge can
  // be traced and, if needed, un-picked.
  mergedIntoId: { type: mongoose.Schema.Types.ObjectId, ref: 'DynamicRecord' },
  mergeHistory: {
    type: [
      {
        _id: false,
        mergedAt: { type: Date },
        mergedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        sourceIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'DynamicRecord' }],
      },
    ],
    default: [],
  },

  // System fields
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  lastModifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  // For search indexing - denormalized text blob
  _searchText: { type: String, select: false },

  // Version for optimistic locking
  __v: { type: Number, default: 0 },
}, {
  timestamps: true,
  // Allow extra fields in data map
});

// Compound indexes for fast tenant-scoped queries
dynamicRecordSchema.index({ tenantId: 1, objectApiName: 1, isDeleted: 1 });
dynamicRecordSchema.index({ tenantId: 1, objectApiName: 1, createdAt: -1 });
dynamicRecordSchema.index({ tenantId: 1, objectApiName: 1, ownerId: 1 });
dynamicRecordSchema.index({ tenantId: 1, isDeleted: 1 });

// Full-text search index on searchText
dynamicRecordSchema.index({ _searchText: 'text', tenantId: 1 });

// Keep the search text current for every writer (flows, custom code, inbox, conversions,
// insurance services), not only the record controller. Skips saves where the caller already
// rebuilt it; searchable fields come from field metadata, so no per-object code is involved.
dynamicRecordSchema.pre('save', async function () {
  if (!this.isNew && !this.isModified('data')) return;
  if (this.isModified('_searchText')) return;
  const FieldMeta = mongoose.model('FieldMeta');
  const fields = await FieldMeta.find({ tenantId: this.tenantId, objectApiName: this.objectApiName }).lean();
  const { buildSearchText } = await import('../services/searchService.js');
  this._searchText = await buildSearchText(this, fields);
});

// Retrieve a specific field from data map
dynamicRecordSchema.methods.getField = function (apiName) {
  return this.data.get(apiName);
};

// Set a field in data map
dynamicRecordSchema.methods.setField = function (apiName, value) {
  this.data.set(apiName, value);
};

// Convert data map to plain object for API responses
dynamicRecordSchema.methods.toDataObject = function () {
  const obj = {
    id: this._id,
    objectApiName: this.objectApiName,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
    createdBy: this.createdBy,
    lastModifiedBy: this.lastModifiedBy,
    ownerId: this.ownerId,
  };
  if (this.data) {
    for (const [key, value] of this.data) {
      obj[key] = value;
    }
  }
  return obj;
};

export default mongoose.model('DynamicRecord', dynamicRecordSchema);
