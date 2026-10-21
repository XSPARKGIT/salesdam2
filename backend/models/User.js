import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    username: { type: String, trim: true, lowercase: true, sparse: true },
    password: { type: String, select: false },
    avatar: { type: String },
    phone: { type: String, trim: true },
    title: { type: String, trim: true },
    department: { type: String, trim: true },
    gender: { type: String, trim: true },
    bio: { type: String, trim: true, maxlength: 500 },

    // Workspaces this user is a member of (within their tenant)
    workspaceIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Workspace',
      },
    ],

    // Tenant-level role (RBAC) - single role per user
    role: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Role',
    },

    // Direct permission overrides (field-level overrides)
    permissionOverrides: [
      {
        objectApiName: String,
        fieldName: String,
        canView: { type: Boolean, default: true },
        canEdit: { type: Boolean, default: false },
      },
    ],

    status: {
      type: String,
      enum: [
        'active',
        'inactive',
        'pending',
        'pending_verification',
        'pending_payment',
        'suspended',
      ],
      default: 'active',
    },

    preferences: {
      theme: {
        type: String,
        enum: ['light', 'dark', 'system'],
        default: 'light',
      },
      language: { type: String, default: 'en' },
      timezone: { type: String, default: 'UTC' },
      notifications: {
        email: { type: Boolean, default: true },
        inApp: { type: Boolean, default: true },
      },
      homeDashboardId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Dashboard',
        default: null,
      },
      // First-login welcome modal and guided tour progress
      // (frontend OnboardingProvider). Must be declared here: strict mode
      // drops unknown keys, which made the welcome modal reappear on reload.
      onboarding: {
        welcomeSeenAt: { type: Date },
        tourStatus: {
          type: String,
          enum: ['in_progress', 'skipped', 'completed', 'dismissed'],
        },
      },
    },

    lastLogin: { type: Date },
    lastActivity: { type: Date },
    loginCount: { type: Number, default: 0 },
    failedLoginAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date },

    // Custom profile fields added by admins (stored as key-value pairs)
    profileData: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
      default: {},
    },

    emailVerified: { type: Boolean, default: false },
    emailVerificationToken: { type: String, select: false },
    passwordResetToken: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },

    manager: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Compound unique index: email per tenant
userSchema.index({ tenantId: 1, email: 1 }, { unique: true });
userSchema.index({ email: 1 });
// Compound unique index: username per tenant (sparse allows null)
userSchema.index({ tenantId: 1, username: 1 }, { unique: true, sparse: true });
userSchema.index({ status: 1 });

// Virtual: full name
userSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`;
});

// Validation: prevent self-assignment as manager
userSchema.pre('save', function (next) {
  if (this.manager && this.manager.equals(this._id)) {
    return next(new Error('A user cannot be their own manager.'));
  }
  next();
});

// Hash password before save
userSchema.pre('save', async function (next) {
  if (!this.isModified('password') || !this.password) return next();
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare password
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Check if account is locked
userSchema.methods.isLocked = function () {
  return this.lockedUntil && this.lockedUntil > Date.now();
};

// Increment failed login attempts
userSchema.methods.incrementFailedLogins = async function () {
  this.failedLoginAttempts += 1;
  if (this.failedLoginAttempts >= 5) {
    this.lockedUntil = new Date(Date.now() + 30 * 60 * 1000); // lock 30 min
  }
  return this.save();
};

// Reset failed logins
userSchema.methods.resetFailedLogins = async function () {
  this.failedLoginAttempts = 0;
  this.lockedUntil = undefined;
  this.lastLogin = new Date();
  this.loginCount += 1;
  return this.save();
};

userSchema.methods.isSuperuser = function () {
  if (!this.role || typeof this.role !== 'object') return false;
  return this.role.name?.toLowerCase() === 'superuser';
};

userSchema.methods.isAdmin = function () {
  if (!this.role || typeof this.role !== 'object') return false;

  const roleName = this.role.name?.toLowerCase();

  return roleName === 'superuser' || roleName === 'admin';
};

export default mongoose.model('User', userSchema);
