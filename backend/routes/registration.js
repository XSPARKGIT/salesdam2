import express from 'express';
import {
  registerWithFreePlan,
  registerWithPaystack,
  verifyEmail,
  getVerificationStatus,
  verifyPayment,
} from '../controllers/registrationController.js';
import { validate, schemas } from '../utils/validators.js';
import { authLimiter, authIpLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

/**
 * POST /api/registration/free
 * Register user with free plan (no payment required)
 */
router.post(
  '/free',
  authIpLimiter,
  authLimiter,
  validate(schemas.freeRegistration),
  registerWithFreePlan,
);

/**
 * POST /api/registration/paystack
 * Register user with Paystack payment
 */
router.post(
  '/paystack',
  authIpLimiter,
  authLimiter,
  validate(schemas.paystackRegistration),
  registerWithPaystack,
);

/**
 * POST /api/registration/verify-email
 * Verify email with token
 */
router.post('/verify-email', validate(schemas.verifyEmail), verifyEmail);

/**
 * GET /api/registration/verification-status
 * Check verification status
 */
router.get('/verification-status', getVerificationStatus);

/**
 * POST /api/registration/verify-payment
 * Verify Paystack payment
 */
router.post('/verify-payment', validate(schemas.verifyPayment), verifyPayment);

export default router;
