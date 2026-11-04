import express from 'express';
import {
  register,
  login,
  logout,
  getMe,
  changePassword,
  listSessions,
  revokeSession,
  forgotPassword,
  verifyResetToken,
  resetPassword,
  switchTenant,
  getPasswordPolicyRoute,
  mfaVerifyLogin,
  mfaStatus,
  mfaEnroll,
  mfaEnrollVerify,
  mfaDisable,
} from '../controllers/authController.js';
import ssoController from '../controllers/ssoController.js';
import {
  registerWithFreePlan,
  registerWithPaystack,
  verifyEmail,
  getVerificationStatus,
  verifyPayment,
} from '../controllers/registrationController.js';
import { requireAuth } from '../middleware/auth.js';
import { enforceTenant } from '../middleware/tenant.js';
import { authLimiter, authIpLimiter } from '../middleware/rateLimiter.js';
import { validate, schemas } from '../utils/validators.js';

const router = express.Router();

// Legacy registration (for existing users)
router.post('/register', authIpLimiter, authLimiter, validate(schemas.register), register);

// New registration flows
router.post('/register-free', authIpLimiter, authLimiter, validate(schemas.freeRegistration), registerWithFreePlan);
router.post('/register-paystack', authIpLimiter, authLimiter, validate(schemas.paystackRegistration), registerWithPaystack);
router.post('/verify-email', validate(schemas.verifyEmail), verifyEmail);
router.get('/verification-status', getVerificationStatus);
router.post('/verify-payment', validate(schemas.verifyPayment), verifyPayment);

// Login & auth
router.post('/login', authIpLimiter, authLimiter, validate(schemas.login), login);
router.post('/logout', requireAuth, logout);
router.post('/switch-tenant', requireAuth, switchTenant);
router.get('/me', requireAuth, enforceTenant, getMe);

// Password reset flow
router.post('/forgot-password', authIpLimiter, authLimiter, validate(schemas.forgotPassword), forgotPassword);
router.post('/verify-reset-token', validate(schemas.verifyResetToken), verifyResetToken);
router.post('/reset-password', authIpLimiter, authLimiter, validate(schemas.resetPassword), resetPassword);

// Password management
router.get('/password-policy', getPasswordPolicyRoute);
router.post('/change-password', requireAuth, enforceTenant, changePassword);

// Multi-Factor Authentication (Core BRD §21.4)
// mfa/verify completes a login left pending by login() — it runs on the
// session the password step created, not a fresh one, so it only needs the
// rate limiter, not requireAuth (requireAuth would reject a pending session).
router.post('/mfa/verify', authIpLimiter, authLimiter, mfaVerifyLogin);
router.get('/mfa/status', requireAuth, enforceTenant, mfaStatus);
router.post('/mfa/enroll', requireAuth, enforceTenant, mfaEnroll);
router.post('/mfa/enroll/verify', requireAuth, enforceTenant, mfaEnrollVerify);
router.post('/mfa/disable', requireAuth, enforceTenant, mfaDisable);

// Single Sign-On (Core BRD §21.6) — see controllers/ssoController.js for
// exactly what is and isn't implemented.
router.get('/sso/:tenantId/status', ssoController.getStatus);
router.get('/sso/:tenantId/login', ssoController.initiate);
router.get('/sso/:tenantId/callback', ssoController.callback);

// Session management
router.get('/sessions', requireAuth, listSessions);
router.delete('/sessions/:sessionId', requireAuth, revokeSession);

export default router;
