import Joi from 'joi';

// ─── Password Requirements (used everywhere) ──────────────────────────────────
// Core BRD §21.3: password policy is tenant-configurable (see
// services/authSecurityService.js), so the actual rules are enforced there,
// against the right tenant, with a message naming exactly what's missing.
// This Joi-level check only guards against an empty/absurd value reaching
// that service.
const passwordSchema = Joi.string().min(1).max(200).required();

// ─── Auth ─────────────────────────────────────────────────────────────────────
const registerSchema = Joi.object({
  firstName: Joi.string().min(1).max(50).required(),
  lastName: Joi.string().min(1).max(50).required(),
  email: Joi.string().email().required(),
  password: passwordSchema,
  tenantName: Joi.string().min(2).max(100).required(),
  industry: Joi.string().max(100),
  useCase: Joi.string().max(100),
});

const loginSchema = Joi.object({
  username: Joi.string().required(),
  password: Joi.string().required(),
  tenantId: Joi.string(),
});

// ─── Tenant ───────────────────────────────────────────────────────────────────
const createTenantSchema = Joi.object({
  name: Joi.string().min(2).max(100).required(),
  slug: Joi.string().alphanum().min(3).max(50).lowercase().required(),
  domain: Joi.string().domain().allow('', null),
  plan: Joi.string().valid('free', 'starter', 'professional', 'enterprise'),
  industry: Joi.string().max(100),
  useCase: Joi.string().max(100),
});

// ─── User ─────────────────────────────────────────────────────────────────────
const createUserSchema = Joi.object({
  firstName: Joi.string().min(1).max(50).required(),
  lastName: Joi.string().min(1).max(50).required(),
  email: Joi.string().email().required(),
  username: Joi.string().email().optional(),
  password: passwordSchema,
  title: Joi.string().max(100).allow(''),
  department: Joi.string().max(100).allow(''),
  phone: Joi.string().max(20).allow(''),
});

// ─── Custom Object ────────────────────────────────────────────────────────────
const createObjectSchema = Joi.object({
  name: Joi.string().min(2).max(80).required(),
  label: Joi.string().min(1).max(80).required(),
  pluralLabel: Joi.string().min(1).max(80).required(),
  apiName: Joi.string()
    .min(2)
    .max(40)
    .lowercase()
    .pattern(/^[a-z][a-z0-9_]*$/)
    .required(),
  description: Joi.string().max(500).allow(''),
  icon: Joi.string().max(50).default('Box'),
  color: Joi.string()
    .pattern(/^#[0-9A-Fa-f]{6}$/)
    .default('#6366f1'),

  // ── Name field configuration ────────────────────────────────────────────
  // Empty strings are allowed and fall back to the defaults in the controller,
  // so a user who leaves these blank still gets a usable "Name" field.
  nameFieldApiName: Joi.string()
    .min(2)
    .max(40)
    .lowercase()
    .pattern(/^[a-z][a-z0-9_]*$/)
    .allow('')
    .default('name'),
  nameFieldLabel: Joi.string().max(80).allow('').default('Name'),
  nameFieldType: Joi.string()
    .valid('text', 'auto_number')
    .allow('')
    .default('text'),
  autoNumberPrefix: Joi.string().max(20).allow('').default(''),
  autoNumberPadding: Joi.number().integer().min(1).max(10).default(5),
  autoNumberStartAt: Joi.number().integer().min(1).default(1),
  enableHistory: Joi.boolean().default(false),
  showInNav: Joi.boolean().default(true),
  navOrder: Joi.number().integer().min(0).default(100),
  sharingModel: Joi.string()
    .valid('public_read_write', 'public_read_only', 'private')
    .default('private'),
  kanbanConfig: Joi.object({
    enabled: Joi.boolean().default(false),
    fieldApiName: Joi.string().allow('').default(''),
  }).default({ enabled: false, fieldApiName: '' }),
});

// ─── Custom Field ─────────────────────────────────────────────────────────────
const createFieldSchema = Joi.object({
  name: Joi.string().min(1).max(80), // optional - defaults to label in controller
  label: Joi.string().min(1).max(80).required(),
  apiName: Joi.string()
    .min(2)
    .max(40)
    .lowercase()
    .pattern(/^[a-z][a-z0-9_]*$/)
    .required(),
  type: Joi.string()
    .valid(
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
      'auto_number',
      'formula',
      'rollup_summary',
    )
    .required(),
  isRequired: Joi.boolean().default(false),
  isUnique: Joi.boolean().default(false),
  isReadOnly: Joi.boolean().default(false),
  maxLength: Joi.number().integer().min(1).max(131072),
  minLength: Joi.number().integer().min(0),
  precision: Joi.number().integer().min(1).max(18),
  scale: Joi.number().integer().min(0).max(18),
  minValue: Joi.number(),
  maxValue: Joi.number(),
  defaultValue: Joi.any(),
  picklistValues: Joi.array().items(
    Joi.object({
      label: Joi.string().required(),
      value: Joi.string().required(),
      isDefault: Joi.boolean().default(false),
      isActive: Joi.boolean().default(true),
      color: Joi.string().allow(''),
    }),
  ),
  // Lookup / relation
  lookupObjectApiName: Joi.string().allow(''),
  lookupDisplayField: Joi.string().default('name'),
  cascadeDelete: Joi.boolean().default(false),
  deleteBehavior: Joi.string().valid('cascade', 'block', 'nullify', 'none'),
  // Auto-number
  autoNumberPrefix: Joi.string().allow(''),
  autoNumberPadding: Joi.number().integer().min(1).max(10),
  autoNumberStartAt: Joi.number().integer().min(1),
  // Formula — `formula` is the model path; `formulaExpression` is a legacy alias
  // the controller normalises. Both must be declared or stripUnknown drops them.
  formula: Joi.string().allow(''),
  formulaExpression: Joi.string().allow(''),
  formulaReturnType: Joi.string().valid(
    'text',
    'number',
    'currency',
    'percent',
    'date',
    'boolean',
  ),
  // Rollup summary
  rollupObjectApiName: Joi.string().allow(''),
  rollupRelationField: Joi.string().allow(''),
  rollupType: Joi.string()
    .valid('COUNT', 'SUM', 'MIN', 'MAX', 'AVG')
    .allow('', null),
  rollupField: Joi.string().allow(''),
  rollupFilter: Joi.string().allow(''),
  // Structured validation
  validations: Joi.object().unknown(true),
  // Legacy validation rule
  validationRule: Joi.object({
    pattern: Joi.string(),
    message: Joi.string(),
  }),
  helpText: Joi.string().max(500).allow(''),
  section: Joi.string().max(80).default('Information'),
  column: Joi.number().valid(1, 2).default(1),
  displayOrder: Joi.number().integer().min(0).default(100),
  isIndexed: Joi.boolean().default(false),
  isSearchable: Joi.boolean(),
  isFilterable: Joi.boolean(),
  isSortable: Joi.boolean(),
});

// ─── Generic validator helper ─────────────────────────────────────────────────
const validate = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true,
  });
  if (error) {
    return res.status(400).json({
      success: false,
      message: error.details.map((d) => d.message).join('; '),
    });
  }
  req.body = value;
  next();
};

// ─── Registration ─────────────────────────────────────────────────────────────
const freeRegistrationSchema = Joi.object({
  firstName: Joi.string().min(1).max(50).required(),
  lastName: Joi.string().min(1).max(50).required(),
  email: Joi.string().email().required(),
  username: Joi.string().email().required(),
  password: passwordSchema,
  phone: Joi.string().max(20).required(),
  companyName: Joi.string().min(2).max(100).required(),
  employees: Joi.number().integer().min(1).optional(),
});

const paystackRegistrationSchema = Joi.object({
  firstName: Joi.string().min(1).max(50).required(),
  lastName: Joi.string().min(1).max(50).required(),
  email: Joi.string().email().required(),
  username: Joi.string().email().required(),
  password: passwordSchema,
  phone: Joi.string().max(20).required(),
  companyName: Joi.string().min(2).max(100).required(),
  employees: Joi.number().integer().min(1).required(),
  planId: Joi.string().required(),
  debitOrderDay: Joi.number().integer().min(1).max(28).required(),
});

const verifyEmailSchema = Joi.object({
  token: Joi.string().required(),
});

const verifyPaymentSchema = Joi.object({
  reference: Joi.string().required(),
});

// ─── Password Reset ───────────────────────────────────────────────────────────
// Email is the sole login identifier (see authController.login); `username`
// is accepted only as a legacy alias, same pattern as the login schema.
const forgotPasswordSchema = Joi.object({
  email: Joi.string().email(),
  username: Joi.string(),
}).or('email', 'username');

const verifyResetTokenSchema = Joi.object({
  token: Joi.string().required(),
});

const resetPasswordSchema = Joi.object({
  token: Joi.string().required(),
  newPassword: passwordSchema,
});

const schemas = {
  register: registerSchema,
  login: loginSchema,
  createTenant: createTenantSchema,
  createUser: createUserSchema,
  createObject: createObjectSchema,
  createField: createFieldSchema,
  freeRegistration: freeRegistrationSchema,
  paystackRegistration: paystackRegistrationSchema,
  verifyEmail: verifyEmailSchema,
  verifyPayment: verifyPaymentSchema,
  forgotPassword: forgotPasswordSchema,
  verifyResetToken: verifyResetTokenSchema,
  resetPassword: resetPasswordSchema,
};

export { validate, schemas };
