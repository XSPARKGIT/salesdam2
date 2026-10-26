import mongoose from 'mongoose';

/**
 * Layout - Page layout definitions for record views.
 * Supports sections, columns, tabs, and role-based assignment.
 */

// A single condition that controls whether a section or field is visible.
// The section/field is shown when the condition evaluates to true.
const visibilityRuleSchema = new mongoose.Schema({
  field:    { type: String, required: true },
  operator: { type: String, enum: ['eq', 'neq', 'is_set', 'is_blank'], default: 'eq' },
  value:    { type: String },
}, { _id: false });

const fieldItemSchema = new mongoose.Schema({
  fieldApiName: { type: String, required: true },
  label: { type: String },
  colspan: { type: Number, default: 1, enum: [1, 2] },
  required: { type: Boolean },   // override field required
  readonly: { type: Boolean },   // override field readonly
  hidden: { type: Boolean, default: false },
  visibilityRule: { type: visibilityRuleSchema, default: null },
}, { _id: false });

const columnSchema = new mongoose.Schema({
  fields: [fieldItemSchema],
}, { _id: false });

const sectionSchema = new mongoose.Schema({
  id: { type: String, required: true },
  label: { type: String, required: true },
  columns: { type: Number, enum: [1, 2], default: 2 },
  collapsible: { type: Boolean, default: false },
  collapsed: { type: Boolean, default: false },
  columnData: [columnSchema],
  visibilityRule: { type: visibilityRuleSchema, default: null },
}, { _id: false });

const tabSchema = new mongoose.Schema({
  id: { type: String, required: true },
  label: { type: String, required: true },
  icon: { type: String },
  sections: [sectionSchema],
}, { _id: false });

const buttonSchema = new mongoose.Schema({
  id: { type: String, required: true },
  label: { type: String, required: true },
  icon: { type: String },
  type: { type: String, enum: ['button', 'menu_item'], default: 'button' },
  behavior: { type: String, enum: ['navigate', 'api_call', 'automation', 'custom_js'], required: true },
  target: { type: String }, // URL, automation ID, route
  position: { type: String, enum: ['header', 'record_header', 'detail_panel'], default: 'header' },
  visibleRoles: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Role' }],
  requiresConfirmation: { type: Boolean, default: false },
  confirmMessage: { type: String },
}, { _id: false });

const layoutSchema = new mongoose.Schema({
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
  },
  objectApiName: { type: String, required: true, index: true },

  name: { type: String, required: true, trim: true },
  description: { type: String },
  isDefault: { type: Boolean, default: false },

  // Roles this layout is assigned to
  assignedRoles: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Role' }],

  // Layout type
  type: {
    type: String,
    enum: ['detail', 'edit', 'compact', 'list', 'related'],
    default: 'detail',
  },

  // Layout structure
  tabs: [tabSchema],    // If using tabs
  sections: [sectionSchema], // If not using tabs (flat layout)
  useTabs: { type: Boolean, default: false },

  // Buttons/actions
  buttons: [buttonSchema],

  // Related lists (objects to show at the bottom)
  relatedLists: [{
    objectApiName: { type: String, required: true },
    relationshipField: { type: String, required: true },
    label: { type: String },
    columns: [{ type: String }], // field api names to display
    sortField: { type: String },
    sortOrder: { type: String, enum: ['asc', 'desc'], default: 'desc' },
    limit: { type: Number, default: 5 },
  }],

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  lastModifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, {
  timestamps: true,
});

layoutSchema.index({ tenantId: 1, objectApiName: 1 });
layoutSchema.index({ tenantId: 1, objectApiName: 1, isDefault: 1 });

export default mongoose.model('Layout', layoutSchema);
