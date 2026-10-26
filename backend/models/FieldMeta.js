import mongoose from 'mongoose';

/**
 * FieldMeta - Metadata definition for fields on custom objects.
 * Defines type, validation, display, and relationship info.
 */
const fieldMetaSchema = new mongoose.Schema(
  {
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

    name: { type: String, required: true, trim: true }, // "First Name"
    label: { type: String, required: true, trim: true }, // "First Name"
    apiName: { type: String, required: true, trim: true }, // "first_name"
    description: { type: String, trim: true },
    helpText: { type: String, trim: true },

    // Field type
    type: {
      type: String,
      required: true,
      enum: [
        'text',
        'textarea',
        'richtext',
        'number',
        'currency',
        'percent',
        'date',
        'datetime',
        'time',
        'boolean',
        'picklist',
        'multipicklist',
        'lookup',
        'master_detail',
        'email',
        'phone',
        'url',
        'address',
        'formula',
        'auto_number',
        'rollup_summary',
      ],
    },

    // Validation
    isRequired: { type: Boolean, default: false },
    isUnique: { type: Boolean, default: false },
    isReadOnly: { type: Boolean, default: false },
    isSystem: { type: Boolean, default: false }, // built-in fields can't be deleted

    // Helper ("utility") field. The value is stored and can be referenced by
    // formulas and rollup summaries, but the field is never rendered on a page
    // layout, a record form, or offered in a column/layout picker. Used for
    // intermediate values that only exist to feed another calculation.
    isHidden: { type: Boolean, default: false },

    // Text field properties
    maxLength: { type: Number },
    minLength: { type: Number },

    // Number field properties
    precision: { type: Number, default: 18 },
    scale: { type: Number, default: 0 },
    minValue: { type: Number },
    maxValue: { type: Number },

    // Default value
    defaultValue: { type: mongoose.Schema.Types.Mixed },

    // Picklist options — either inline values or linked to a GlobalValueSet.
    // When globalValueSetId is set the picklistValues are a synced copy of the
    // set's values; they are overwritten on every GlobalValueSet update.
    globalValueSetId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'GlobalValueSet',
      default: null,
    },
    picklistValues: [
      {
        label: { type: String, required: true },
        value: { type: String, required: true },
        isDefault: { type: Boolean, default: false },
        isActive: { type: Boolean, default: true },
        color: { type: String },
      },
    ],

    // Lookup/relation properties
    lookupObjectApiName: { type: String }, // which object this lookup points to
    lookupDisplayField: { type: String, default: 'name' }, // field to display
    relationshipName: { type: String },
    cascadeDelete: { type: Boolean, default: false },
    // REL-003: deletion behaviour when the parent record is deleted.
    // 'cascade' deletes child records; 'block' prevents parent deletion when children exist;
    // 'nullify' sets the lookup field to null; 'none' takes no action.
    deleteBehavior: {
      type: String,
      enum: ['cascade', 'block', 'nullify', 'none'],
      default: 'none',
    },

    // Formula field
    formula: { type: String },
    // Declares how the computed value is stored and rendered. `percent` was
    // accepted by the Joi request schema but missing here, so saving a percent
    // formula field failed Mongoose enum validation — the two now agree.
    formulaReturnType: {
      type: String,
      enum: ['text', 'number', 'currency', 'percent', 'date', 'boolean'],
    },

    // Auto-number field configuration
    autoNumberPrefix: { type: String, default: '' }, // e.g. "CASE-"
    autoNumberPadding: { type: Number, default: 4 }, // zero-pad to N digits  → "0001"
    autoNumberStartAt: { type: Number, default: 1 }, // first generated value

    // Rollup Summary field configuration
    rollupObjectApiName: { type: String }, // child object to aggregate (e.g. 'contact')
    rollupRelationField: { type: String }, // lookup field on child pointing back to this object (e.g. 'client_id')
    rollupType: {
      type: String,
      enum: ['COUNT', 'SUM', 'MIN', 'MAX', 'AVG', '', null],
    },
    rollupField: { type: String }, // field on child to aggregate (ignored for COUNT)
    rollupFilter: { type: String }, // optional formula-style filter expression

    // Legacy single-rule validation (backward-compat)
    validationRule: {
      pattern: { type: String }, // regex
      message: { type: String }, // error message if validation fails
    },

    // ── Rich structured validations (engine-driven) ───────────────────────────
    validations: {
      // Common
      required: { type: Boolean },
      unique: { type: Boolean },
      // Text / Textarea
      minLength: { type: Number },
      maxLength: { type: Number },
      regex: { type: String },
      regexMessage: { type: String },
      trim: { type: Boolean },
      // Number / Currency / Percent
      min: { type: Number },
      max: { type: Number },
      precision: { type: Number },
      positiveOnly: { type: Boolean },
      allowNegative: { type: Boolean },
      // Date / Datetime
      minDate: { type: Date },
      maxDate: { type: Date },
      disablePast: { type: Boolean },
      disableFuture: { type: Boolean },
      // Picklist / Multipicklist
      allowedValues: [{ type: String }],
      minSelections: { type: Number },
      maxSelections: { type: Number },
      // Email
      domainWhitelist: [{ type: String }],
      domainBlacklist: [{ type: String }],
      // URL
      mustBeHttps: { type: Boolean },
      // Lookup
      allowMultiple: { type: Boolean },
      cascadeDelete: { type: Boolean },
    },

    // ── Formula-based validation ──────────────────────────────────────────────
    formulaValidation: {
      expression: { type: String }, // e.g. "amount > discount"
      errorMessage: { type: String }, // shown when formula returns false
    },

    // Display/layout
    displayOrder: { type: Number, default: 100 },
    isIndexed: { type: Boolean, default: false },
    isSearchable: { type: Boolean, default: true },
    isFilterable: { type: Boolean, default: true },
    isSortable: { type: Boolean, default: true },

    // Section in the auto-generated layout
    section: { type: String, default: 'Information' },
    column: { type: Number, enum: [1, 2], default: 1 },

    // Related List configuration (for lookup/master-detail fields)
    relatedListConfig: {
      columns: [
        {
          fieldApiName: { type: String, required: true },
          order: { type: Number, default: 0 },
        },
      ],
      maxColumns: { type: Number, default: 6 },
    },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    lastModifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  {
    timestamps: true,
  },
);

fieldMetaSchema.index(
  { tenantId: 1, objectId: 1, apiName: 1 },
  { unique: true },
);
fieldMetaSchema.index({ tenantId: 1, objectApiName: 1 });
fieldMetaSchema.index({ tenantId: 1, type: 1 });

export default mongoose.model('FieldMeta', fieldMetaSchema);
