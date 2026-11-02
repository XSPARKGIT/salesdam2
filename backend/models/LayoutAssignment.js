import mongoose from 'mongoose';

/**
 * LayoutAssignment - which page layout a Role (Profile) sees for an object.
 *
 * One document per Role/object pair:
 *  - defaultLayoutId: the layout the Role sees by default.
 *  - rules: optional "use layout X instead when <condition on the record>"
 *    overrides, checked in array order; the first matching rule wins and the
 *    default applies when none match. A new record has no stored values yet,
 *    so it always gets the default until it is saved.
 *
 * Without an assignment the Role falls back to a layout listing it in
 * Layout.assignedRoles, then to the object's default layout.
 */
const ruleSchema = new mongoose.Schema({
  field: { type: String, required: true },
  operator: { type: String, enum: ['eq', 'neq', 'is_set', 'is_blank'], default: 'eq' },
  value: { type: String },
  layoutId: { type: mongoose.Schema.Types.ObjectId, ref: 'Layout', required: true },
}, { _id: false });

const layoutAssignmentSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
    index: true,
  },
  objectApiName: { type: String, required: true },
  roleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Role', required: true },
  defaultLayoutId: { type: mongoose.Schema.Types.ObjectId, ref: 'Layout', default: null },
  rules: [ruleSchema],
  lastModifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, {
  timestamps: true,
});

layoutAssignmentSchema.index({ tenantId: 1, objectApiName: 1, roleId: 1 }, { unique: true });

export default mongoose.model('LayoutAssignment', layoutAssignmentSchema);
