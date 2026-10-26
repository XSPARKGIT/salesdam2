import mongoose from 'mongoose';
import FieldMeta from './FieldMeta.js';
import DynamicRecord from './DynamicRecord.js';

/**
 * Length caps for object-level validation rules. Exported so the controller and
 * the frontend inputs enforce exactly the same limits as the schema.
 */
export const VALIDATION_RULE_LIMITS = {
  name: 80,
  description: 255,
  expression: 1000,
  errorMessage: 255,
};

/**
 * ObjectMeta - Metadata definition for custom CRM objects.
 * Each document represents one CRM object type (like a Salesforce object).
 */
const objectMetaSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
    index: true,
  },
  name: { type: String, required: true, trim: true },          // "Contact"
  label: { type: String, required: true, trim: true },         // "Contact"
  pluralLabel: { type: String, required: true, trim: true },   // "Contacts"
  apiName: { type: String, required: true, trim: true, lowercase: true }, // "contact"
  description: { type: String, trim: true },

  // Is this a built-in standard object or user-created?
  isCustom: { type: Boolean, default: true },
  isSystem: { type: Boolean, default: false }, // System objects cannot be deleted
  isActive: { type: Boolean, default: true },

  // Icon from Lucide React icon name
  icon: { type: String, default: 'Box' },
  color: { type: String, default: '#6366f1' },

  // Which field to use as the record title/name
  nameFieldApiName: { type: String, default: 'name' },

  // Tracking fields enabled?
  enableHistory: { type: Boolean, default: false },
  enableActivities: { type: Boolean, default: true },
  enableNotes: { type: Boolean, default: true },
  enableFiles: { type: Boolean, default: true },

  // Search
  searchable: { type: Boolean, default: true },
  searchFields: [{ type: String }], // field api names to include in search

  // Tabs/navigation
  showInNav: { type: Boolean, default: true },
  navOrder: { type: Number, default: 100 },

  // Sharing model
  sharingModel: {
    type: String,
    enum: ['public_read_write', 'public_read_only', 'private'],
    default: 'private',
  },

  // Record type support
  hasRecordTypes: { type: Boolean, default: false },

  // REL-006: Junction objects are allowed two master-detail fields (exempted from REL-005).
  isJunctionObject: { type: Boolean, default: false },

  // Object-level validation rules (cross-field / formula-based)
  validationRules: [{
    id:           { type: String, maxlength: 64 },
    name:         { type: String, required: true, trim: true, maxlength: VALIDATION_RULE_LIMITS.name },
    description:  { type: String, trim: true, maxlength: VALIDATION_RULE_LIMITS.description },
    // JS-style expression evaluated against record data
    expression:   { type: String, required: true, trim: true, maxlength: VALIDATION_RULE_LIMITS.expression },
    errorMessage: { type: String, required: true, trim: true, maxlength: VALIDATION_RULE_LIMITS.errorMessage },
    // Which field to pin the inline error to; empty = banner at top of record
    errorField:   { type: String, trim: true, default: '' },
    isActive:     { type: Boolean, default: true },
  }],

  // Action buttons — appear on record detail, record list, or both
  actionButtons: [{
    id:             { type: String },
    label:          { type: String, required: true },
    icon:           { type: String, default: 'Zap' },
    variant:        { type: String, enum: ['primary', 'secondary', 'ghost', 'danger', 'success'], default: 'secondary' },
    color:          { type: String },                 // custom hex color override
    size:           { type: String, enum: ['xs', 'sm', 'md', 'lg'], default: 'sm' },
    location:       { type: String, enum: ['record_detail', 'record_list', 'both'], default: 'record_detail' },
    automationId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Automation' },
    confirmMessage: { type: String },                 // optional confirmation dialog text
    resultMode:     { type: String, enum: ['popup', 'inline', 'toast_only'], default: 'popup' },
    order:          { type: Number, default: 0 },
  }],

  // Kanban view configuration
  kanbanConfig: {
    enabled: { type: Boolean, default: false },
    fieldApiName: { type: String }, // which picklist field to group by
  },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  lastModifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, {
  timestamps: true,
});

objectMetaSchema.index({ tenantId: 1, apiName: 1 }, { unique: true });
objectMetaSchema.index({ tenantId: 1, isActive: 1 });
objectMetaSchema.index({ tenantId: 1, showInNav: 1, navOrder: 1 });

/**
 * Cascade on delete. Removes everything the object owns (fields, records,
 * layouts, counters, screens, config) and strips every reference to it that
 * lives on another document, so no stale API name is left pointing at an
 * object that no longer exists.
 *
 * Models are resolved via mongoose.model() rather than imported at the top of
 * this file to avoid circular-import cycles between models.
 */
objectMetaSchema.pre('deleteOne', { document: true, query: false }, async function () {
  const { _id, tenantId, apiName } = this;
  const model = (name) => mongoose.model(name);

  // Owned data — meaningless without the object.
  await Promise.all([
    FieldMeta.deleteMany({ objectId: _id, tenantId }),
    DynamicRecord.deleteMany({ tenantId, objectApiName: apiName }),
    model('Layout').deleteMany({ tenantId, objectApiName: apiName }),
    model('AutoNumberCounter').deleteMany({ tenantId, objectApiName: apiName }),
    model('CustomScreen').deleteMany({ tenantId, objectApiName: apiName }),
    model('ObjectTypeConfig').deleteMany({ tenantId, objectApiName: apiName }),
  ]);

  // References held elsewhere — workspace visibility and sidebar groups, the
  // tenant allow-list, and role / user permission entries.
  await Promise.all([
    model('Workspace').updateMany(
      { tenantId },
      {
        $pull: {
          allowedObjects: apiName,
          'objectGroups.$[].objectApiNames': apiName,
        },
      },
    ),
    model('Tenant').updateOne(
      { _id: tenantId },
      { $pull: { allowedObjects: apiName } },
    ),
    model('Role').updateMany(
      { tenantId },
      { $pull: { objectPermissions: { objectApiName: apiName } } },
    ),
    model('User').updateMany(
      { tenantId },
      { $pull: { permissionOverrides: { objectApiName: apiName } } },
    ),
  ]);
});

export default mongoose.model('ObjectMeta', objectMetaSchema);
