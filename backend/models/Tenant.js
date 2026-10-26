import mongoose from 'mongoose';

const tenantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    hub: { type: String, enum: ['sales', 'insurance'], default: 'sales' },
    // slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    domain: { type: String, trim: true, lowercase: true },
    logo: { type: String },
    phone: { type: String, trim: true },
    ownerEmail: { type: String, trim: true, lowercase: true },
    numberOfEmployees: { type: String, trim: true },
    plan: {
      type: String,
      enum: ['free', 'starter', 'basic', 'standard', 'enterprise'],
      default: 'free',
    },
    debitOrderDay: { type: Number, min: 1, max: 28 },
    status: {
      type: String,
      enum: [
        'active',
        'inactive',
        'suspended',
        'deleted',
        'pending_payment',
        'pending_verification',
      ],
      default: 'active',
    },
    registrationSource: {
      type: String,
      enum: ['marketplace', 'paystack', 'manual'],
      default: 'manual',
    },
    // Marks a cloned, isolated configuration tenant (Core BRD §13).
    isSandbox: { type: Boolean, default: false, index: true },
    clonedFromTenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant' },
    settings: {
      timezone: { type: String, default: 'UTC' },
      dateFormat: { type: String, default: 'MM/DD/YYYY' },
      currency: { type: String, default: 'ZAR' },
      language: { type: String, default: 'en' },
      primaryColor: { type: String, default: '#0066FF' },
    },
    operatingCurrency: {
      code: { type: String, default: 'ZAR' }, // ISO 4217 code
      name: { type: String, default: 'South African Rand' },
      symbol: { type: String, default: 'R' },
    },
    limits: {
      maxUsers: { type: Number, default: 10 },
      maxRecords: { type: Number, default: 10000 },
      maxObjects: { type: Number, default: 500 },
      maxAutomations: { type: Number, default: 10 },
      storageGB: { type: Number, default: 1 },
    },
    usage: {
      users: { type: Number, default: 0 },
      records: { type: Number, default: 0 },
      objects: { type: Number, default: 0 },
      automations: { type: Number, default: 0 },
      storageUsedMB: { type: Number, default: 0 },
    },
    features: {
      aiOnboarding: { type: Boolean, default: true },
      customObjects: { type: Boolean, default: true },
      automations: { type: Boolean, default: true },
      analytics: { type: Boolean, default: true },
      apiAccess: { type: Boolean, default: false },
      webhooks: { type: Boolean, default: false },
      enableSalesdamFeatures: { type: Boolean, default: true },
      salesdamFindTenders: { type: Boolean, default: true },
      salesdamHomeDashboard: { type: Boolean, default: true },
      salesdamOrdersDashboard: { type: Boolean, default: true },
      salesdamAccountDashboard: { type: Boolean, default: true },
      salesdamDealsDashboard: { type: Boolean, default: true },
      salesdamLeadsDashboard: { type: Boolean, default: true },
      salesdamRevenueDashboard: { type: Boolean, default: true },
      salesdamSalesDashboard: { type: Boolean, default: true },
      salesdamROIDashboard: { type: Boolean, default: true },
    },
    salesdamDashboardConfig: {
      annualTargetFromDate: { type: String, default: '' },
      annualTargetToDate: { type: String, default: '' },
    },
    tendersConfig: {
      fromDate: { type: String, default: '' },
      toDate: { type: String, default: '' },
      departments: [{ type: String }],
      provinces: [{ type: String }],
      categories: [{ type: String }],
    },
    leadApprovalSettings: {
      leadApprovalsRequired: { type: Boolean, default: true },
      approvers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    },
    companyProfile: {
      companyName: { type: String, default: '' },
      namePrefix: { type: String, default: '' },
      email: { type: String, default: '' },
      phone: { type: String, default: '' },
      vatNumber: { type: String, default: '' },
      description: { type: String, default: '' },
      website: { type: String, default: '' },
      address: {
        street: { type: String, default: '' },
        city: { type: String, default: '' },
        province: { type: String, default: '' },
        zipCode: { type: String, default: '' },
        country: { type: String, default: '' },
      },
      financialYearStartMonth: { type: Number, min: 1, max: 12, default: 1 },
    },
    revenueTargets: {
      q1: { type: Number, default: 100000 },
      q2: { type: Number, default: 100000 },
      q3: { type: Number, default: 100000 },
      q4: { type: Number, default: 100000 },
    },
    salesTargets: {
      q1: { type: Number, default: 100000 },
      q2: { type: Number, default: 100000 },
      q3: { type: Number, default: 100000 },
      q4: { type: Number, default: 100000 },
    },
    invoiceQuoteSettings: {
      companyName: { type: String, default: '' },
      website: { type: String, default: '' },
      emailAddress: { type: String, default: '' },
      phoneNumber: { type: String, default: '' },
      companyLogo: { type: String, default: '' },
      street: { type: String, default: '' },
      city: { type: String, default: '' },
      stateProvince: { type: String, default: '' },
      zipPostalCode: { type: String, default: '' },
      country: { type: String, default: '' },
      bankName: { type: String, default: '' },
      accountName: { type: String, default: '' },
      accountNumber: { type: String, default: '' },
      invoicePrefix: { type: String, default: 'INV' },
      invoiceStartingNumber: { type: Number, default: 1 },
      invoiceNumberingFormat: { type: String, default: '' },
      defaultTaxRate: { type: Number, default: 0 },
      quotePrefix: { type: String, default: 'QUO' },
      quoteStartingNumber: { type: Number, default: 1 },
      quoteValidityDays: { type: Number, default: 30 },
      invoiceTerms: { type: String, default: '' },
      quoteTerms: { type: String, default: '' },
      paymentInstructions: { type: String, default: '' },
      cancellationPolicy: { type: String, default: '' },
      invoiceFooter: { type: String, default: '' },
      showLogoOnDocuments: { type: Boolean, default: true },
      showBankingDetailsOnInvoices: { type: Boolean, default: true },
      showBankingDetailsOnQuotes: { type: Boolean, default: false },
      showTaxBreakdown: { type: Boolean, default: true },
      showDiscountField: { type: Boolean, default: false },
    },
    onboarding: {
      completed: { type: Boolean, default: false },
      industry: { type: String },
      useCase: { type: String },
      companySize: { type: String },
      completedAt: { type: Date },
    },
    // Which objects are available in this workspace (empty = all)
    allowedObjects: [{ type: String, trim: true }],
    billing: {
      customerId: { type: String },
      subscriptionId: { type: String },
      currentPeriodEnd: { type: Date },
      paystackReference: { type: String },
      authorizationCode: { type: String },
      lastPaymentDate: { type: Date },
      planActivatedDate: { type: Date },
      nextBillingDate: { type: Date },
      checkoutUrl: { type: String },
      checkoutUrlGeneratedAt: { type: Date },
      verificationPaymentRefunded: { type: Boolean, default: false },
      status: {
        type: String,
        enum: [
          'active',
          'payment_failed',
          'suspended',
          'disabled',
          'cancelled',
        ],
        default: 'active',
      },
      failureCount: { type: Number, default: 0 },
      lastFailedPaymentDate: { type: Date },
      lastFailureReason: { type: String },
      paymentMethod: {
        type: {
          type: String,
          enum: ['card', 'bank_account', 'paypal'],
          default: 'card',
        },
        cardLast4: { type: String },
        cardBrand: { type: String },
        accountName: { type: String },
        accountNumber: { type: String },
        bankCode: { type: String },
      },
      cancelledAt: { type: Date },
      cancellationReason: { type: String },
    },
    suspendedAt: { type: Date },
    suspendedReason: { type: String },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    deletedAt: { type: Date },
  },
  {
    timestamps: true,
  },
);

tenantSchema.index({ slug: 1 });
// tenantSchema.index({ name: 1 });
tenantSchema.index({ status: 1 });
tenantSchema.index({ 'billing.customerId': 1 });

tenantSchema.methods.isActive = function () {
  return this.status === 'active';
};

tenantSchema.methods.canAddUser = function () {
  return this.usage.users < this.limits.maxUsers;
};

tenantSchema.methods.canAddRecord = function () {
  return this.usage.records < this.limits.maxRecords;
};

export default mongoose.model('Tenant', tenantSchema);
