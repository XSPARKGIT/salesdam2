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
} from '../controllers/authController.js';
import {
  registerWithFreePlan,
  registerWithPaystack,
  verifyEmail,
  getVerificationStatus,
  verifyPayment,
} from '../controllers/registrationController.js';
import { requireAuth } from '../middleware/auth.js';
import { enforceTenant } from '../middleware/tenant.js';
import { authLimiter } from '../middleware/rateLimiter.js';
import { validate, schemas } from '../utils/validators.js';

const router = express.Router();

// Legacy registration (for existing users)
router.post('/register', authLimiter, validate(schemas.register), register);

// New registration flows
router.post('/register-free', authLimiter, validate(schemas.freeRegistration), registerWithFreePlan);
router.post('/register-paystack', authLimiter, validate(schemas.paystackRegistration), registerWithPaystack);
router.post('/verify-email', validate(schemas.verifyEmail), verifyEmail);
router.get('/verification-status', getVerificationStatus);
router.post('/verify-payment', validate(schemas.verifyPayment), verifyPayment);

// Login & auth
router.post('/login', authLimiter, validate(schemas.login), login);
router.post('/logout', requireAuth, logout);
router.post('/switch-tenant', requireAuth, switchTenant);
router.get('/me', requireAuth, enforceTenant, getMe);

// Password reset flow
router.post('/forgot-password', authLimiter, validate(schemas.forgotPassword), forgotPassword);
router.post('/verify-reset-token', validate(schemas.verifyResetToken), verifyResetToken);
router.post('/reset-password', authLimiter, validate(schemas.resetPassword), resetPassword);

// Password management
router.post('/change-password', requireAuth, enforceTenant, changePassword);

// Session management
router.get('/sessions', requireAuth, listSessions);
router.delete('/sessions/:sessionId', requireAuth, revokeSession);

export default router;
