import configurationService from './configurationService.js';
import { AppError } from '../utils/errors.js';

/**
 * Authentication & Session Security (Core BRD §21).
 * Resolves tenant-configurable password/lockout/session/MFA policy from the
 * existing TenantConfiguration system (platform default → tenant override),
 * and enforces it. A platform default saved with editableByTenant:false
 * cannot be overridden by any tenant — that is how "platform-required MFA"
 * is expressed, reusing the configuration system's own access rule rather
 * than inventing a second one.
 */

const POLICY_KEYS = [
  'auth.password_min_length',
  'auth.password_require_uppercase',
  'auth.password_require_lowercase',
  'auth.password_require_number',
  'auth.password_require_symbol',
];

const LOCKOUT_KEYS = [
  'auth.max_failed_login_attempts',
  'auth.lockout_duration_minutes',
];

export const getPasswordPolicy = async (tenantId = null) => {
  const resolved = await configurationService.resolveMany(POLICY_KEYS, tenantId);
  return {
    minLength: Number(resolved['auth.password_min_length'] ?? 8),
    requireUppercase: Boolean(resolved['auth.password_require_uppercase']),
    requireLowercase: Boolean(resolved['auth.password_require_lowercase']),
    requireNumber: Boolean(resolved['auth.password_require_number']),
    requireSymbol: Boolean(resolved['auth.password_require_symbol']),
  };
};

/**
 * Throws an AppError naming every rule the password fails, so both the
 * backend and a frontend consuming the same /auth/password-policy endpoint
 * can show one consistent message.
 */
export const validatePassword = (password, policy) => {
  const problems = [];
  if (!password || password.length < policy.minLength) {
    problems.push(`at least ${policy.minLength} characters`);
  }
  if (policy.requireUppercase && !/[A-Z]/.test(password || '')) problems.push('an uppercase letter');
  if (policy.requireLowercase && !/[a-z]/.test(password || '')) problems.push('a lowercase letter');
  if (policy.requireNumber && !/\d/.test(password || '')) problems.push('a number');
  if (policy.requireSymbol && !/[^A-Za-z0-9]/.test(password || '')) problems.push('a special character');
  if (problems.length > 0) {
    throw new AppError(`Password must contain ${problems.join(', ')}.`, 400);
  }
};

export const validatePasswordForTenant = async (password, tenantId = null) => {
  const policy = await getPasswordPolicy(tenantId);
  validatePassword(password, policy);
  return policy;
};

export const getLockoutPolicy = async (tenantId = null) => {
  const resolved = await configurationService.resolveMany(LOCKOUT_KEYS, tenantId);
  return {
    maxAttempts: Number(resolved['auth.max_failed_login_attempts'] ?? 5),
    lockoutMinutes: Number(resolved['auth.lockout_duration_minutes'] ?? 30),
  };
};

/**
 * Records a failed login against the tenant's own lockout policy. Returns
 * { justLocked } so the caller can emit a distinct account_lockout audit
 * event only the moment the lock is newly applied, not on every attempt.
 */
export const recordFailedLogin = async (user, tenantId) => {
  const policy = await getLockoutPolicy(tenantId);
  const wasLocked = user.isLocked();
  user.failedLoginAttempts += 1;
  let justLocked = false;
  if (!wasLocked && user.failedLoginAttempts >= policy.maxAttempts) {
    user.lockedUntil = new Date(Date.now() + policy.lockoutMinutes * 60 * 1000);
    justLocked = true;
  }
  await user.save();
  return { justLocked, policy };
};

export const recordSuccessfulLogin = async (user) => {
  user.failedLoginAttempts = 0;
  user.lockedUntil = undefined;
  user.lastLogin = new Date();
  user.loginCount += 1;
  await user.save();
};

/**
 * Whether this user must complete MFA to sign in: platform-wide (a system
 * default the tenant cannot override), this tenant's own setting, this
 * user's Role ("administrative Profile"), or the user record itself.
 */
export const isMfaRequiredFor = async (user) => {
  if (user.mfaRequired === true) return true;
  if (user.role && typeof user.role === 'object' && user.role.mfaRequired === true) return true;
  const tenantRequired = await configurationService.resolve('auth.mfa_required', user.tenantId, false);
  return Boolean(tenantRequired);
};

export default {
  getPasswordPolicy,
  validatePassword,
  validatePasswordForTenant,
  getLockoutPolicy,
  recordFailedLogin,
  recordSuccessfulLogin,
  isMfaRequiredFor,
};
