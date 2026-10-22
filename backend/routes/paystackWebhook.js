import express from 'express';
import nodemailer from 'nodemailer';
import paystackService from '../services/paystackService.js';
import User from '../models/User.js';
import Tenant from '../models/Tenant.js';
import Notification from '../models/Notification.js';
import { sendSuccess, AppError } from '../utils/errors.js';
import { audit } from '../utils/auditLogger.js';
import logger from '../utils/logger.js';

const router = express.Router();

// Initialize email transporter
let emailTransporter;
const initEmailTransporter = () => {
  if (emailTransporter) return emailTransporter;

  if (process.env.SMTP_HOST === 'smtp.ethereal.email') {
    emailTransporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  } else {
    emailTransporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  return emailTransporter;
};

/**
 * POST /api/paystack-webhook
 * Public webhook endpoint for Paystack payment notifications
 */
router.post('/', async (req, res) => {
  try {
    const signature = req.headers['x-paystack-signature'];

    // Verify webhook signature against the raw request bytes.
    if (!paystackService.verifyWebhookSignature(signature, req.rawBody)) {
      logger.warn('Invalid Paystack webhook signature');
      return res.status(401).json({ success: false, message: 'Invalid signature' });
    }

    const { event, data } = req.body;
    logger.info(`Received Paystack webhook event: ${event}`, { reference: data?.reference });

    // Handle different Paystack events
    switch (event) {
      case 'charge.success':
        await handleChargeSuccess(data);
        break;
      case 'charge.failed':
        await handleChargeFailed(data);
        break;
      case 'subscription.create':
        await handleSubscriptionCreate(data);
        break;
      case 'subscription.disable':
        await handleSubscriptionDisable(data);
        break;
      case 'invoice.payment_requested':
        await handleInvoicePaymentRequested(data);
        break;
      default:
        logger.info(`Unhandled Paystack event: ${event}`);
    }

    // Always respond with 200 OK to Paystack
    res.status(200).json({ success: true });
  } catch (error) {
    logger.error('Error processing Paystack webhook:', error);
    res.status(200).json({ success: true, processed: false });
  }
});

/**
 * Helper: Send email notification
 */
async function sendEmailNotification(toEmail, subject, htmlContent) {
  try {
    const transporter = initEmailTransporter();
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.EMAIL_FROM || 'noreply@salesdam.com',
      to: toEmail,
      subject,
      html: htmlContent,
    });
    logger.info(`Email sent successfully to ${toEmail}`);
  } catch (error) {
    logger.error(`Error sending email to ${toEmail}:`, error);
  }
}

/**
 * Handle successful charge
 */
async function handleChargeSuccess(data) {
  try {
    const reference = data.reference;
    const email = data.customer?.email || data.metadata?.email;
    const amount = data.amount / 100;
    const isVerificationCharge = data.metadata?.isVerificationCharge === true ||
                                 data.metadata?.isVerificationCharge === 'true';

    logger.info(`Processing successful charge for email: ${email}, amount: ${amount}, isVerification: ${isVerificationCharge}`);

    if (!email) {
      logger.warn('No email found in charge.success webhook data');
      return;
    }

    const user = await User.findOne({ email }).populate('tenantId');
    if (!user) {
      logger.warn(`User not found for email: ${email}`);
      return;
    }

    const tenant = await Tenant.findById(user.tenantId);
    if (!tenant) {
      logger.warn(`Tenant not found for user: ${user._id}`);
      return;
    }

    const hasAuthorizationCode = data.authorization && data.authorization.authorization_code;
    const customerId = data.customer?.customer_code;
    const previousFailureCount = tenant.billing?.failureCount || 0;

    // Update tenant billing info and clear failure flags
    const billingUpdate = {
      'billing.lastPaymentDate': new Date(),
      'billing.paystackReference': reference,
      'billing.status': 'active',
      'billing.lastFailedPaymentDate': null,
      'billing.lastFailureReason': null,
      'billing.failureCount': 0,
    };

    if (hasAuthorizationCode) {
      billingUpdate['billing.customerId'] = customerId;
      billingUpdate['billing.authorizationCode'] = data.authorization.authorization_code;
    }

    // If tenant was suspended, reactivate it
    let shouldReactivate = false;
    if (tenant.status === 'suspended') {
      shouldReactivate = true;
      billingUpdate.status = 'active';
      billingUpdate.suspendedAt = null;
      billingUpdate.suspendedReason = null;
    }

    // Update tenant
    await Tenant.findByIdAndUpdate(user.tenantId, { $set: billingUpdate });

    // Activate user if not already active
    if (user.status !== 'active') {
      user.status = 'active';
      await user.save();
      logger.info(`User activated: ${user._id}`);
    }

    // Also ensure tenant status is active (if it wasn't already)
    if (tenant.status !== 'active') {
      await Tenant.findByIdAndUpdate(user.tenantId, { $set: { status: 'active' } });
      logger.info(`Tenant activated: ${tenant._id}`);
    }

    // Create Paystack subscription after initial verification charge
    if (isVerificationCharge && hasAuthorizationCode && customerId) {
      try {
        logger.info(`Creating Paystack subscription for verification charge, tenant: ${tenant._id}`);
        await createPaystackSubscription(tenant, customerId, data.authorization.authorization_code);
      } catch (subscriptionError) {
        logger.error('Error creating subscription after verification charge:', subscriptionError);
        // Don't fail the webhook, but log for retry
      }
    }

    // Create in-app notification
    try {
      const notificationTitle = shouldReactivate ? 'Account Reactivated' : 'Payment Successful';
      const notificationMessage = shouldReactivate
        ? `Your account has been reactivated. Payment of R${amount} received successfully.`
        : `Your payment of R${amount} has been processed successfully.`;

      await Notification.create({
        tenantId: user.tenantId,
        userId: user._id,
        type: 'payment_success',
        title: notificationTitle,
        message: notificationMessage,
        severity: 'success',
        data: { reference, amount },
      });
    } catch (notifError) {
      logger.error('Error creating success notification:', notifError);
    }

    // Send email if there were previous failures
    if (previousFailureCount > 0 || shouldReactivate) {
      try {
        const emailContent = `
          <h2>${shouldReactivate ? 'Account Reactivated' : 'Payment Successful'}</h2>
          <p>Hello ${user.firstName},</p>
          <p>${shouldReactivate
            ? 'Great news! Your account has been reactivated after receiving your payment.'
            : 'Your payment for Salesdam has been processed successfully.'}</p>
          <h3>Details:</h3>
          <ul>
            <li><strong>Amount:</strong> R${amount}</li>
            <li><strong>Reference:</strong> ${reference}</li>
            <li><strong>Status:</strong> Completed</li>
          </ul>
          <p>Your subscription is now active and you can continue using all features.</p>
        `;

        await sendEmailNotification(user.email, 'Payment Successful', emailContent);
      } catch (emailError) {
        logger.error('Error sending success email:', emailError);
      }
    }

    // Audit log
    await audit({
      tenantId: user.tenantId,
      userId: user._id,
      userEmail: user.email,
      action: shouldReactivate ? 'account_reactivated_payment_received' : 'payment_successful',
      resource: 'Payment',
      resourceId: reference,
      metadata: { amount, wasReactivated: shouldReactivate },
    });

    logger.info(`Successfully processed charge for tenant: ${tenant._id}`);
  } catch (error) {
    logger.error('Error handling charge.success webhook:', error);
  }
}

/**
 * Handle failed charge
 */
async function handleChargeFailed(data) {
  try {
    const reference = data.reference;
    const email = data.customer?.email || data.metadata?.email;
    const failureReason = data.gateway_response || 'Payment declined';
    const amount = data.amount ? data.amount / 100 : null;

    logger.warn(`Charge failed for email: ${email}, reference: ${reference}, reason: ${failureReason}`);

    if (!email) {
      logger.warn('No email found in charge.failed webhook data');
      return;
    }

    const user = await User.findOne({ email }).populate('tenantId');
    if (!user) {
      logger.warn(`User not found for email: ${email}`);
      return;
    }

    const tenant = await Tenant.findById(user.tenantId);
    if (!tenant) {
      logger.warn(`Tenant not found for user: ${user._id}`);
      return;
    }

    const failureCount = (tenant.billing?.failureCount || 0) + 1;
    const shouldSuspend = failureCount >= 3;

    // Update tenant billing status
    const updateData = {
      'billing.lastFailedPaymentDate': new Date(),
      'billing.lastFailureReason': failureReason,
      'billing.failureCount': failureCount,
      'billing.status': shouldSuspend ? 'suspended' : 'payment_failed',
    };

    // Suspend tenant after 3 failures
    if (shouldSuspend) {
      updateData.status = 'suspended';
      updateData.suspendedAt = new Date();
      updateData.suspendedReason = `Payment failed ${failureCount} times. Please update payment method.`;
    }

    await Tenant.findByIdAndUpdate(user.tenantId, { $set: updateData });

    // Create in-app notification
    try {
      await Notification.create({
        tenantId: user.tenantId,
        userId: user._id,
        type: 'payment_failed',
        title: shouldSuspend ? 'Account Suspended - Payment Failed' : 'Payment Failed',
        message: shouldSuspend
          ? `Your account has been suspended due to ${failureCount} failed payment attempts. Please update your payment method to restore access.`
          : `Your payment of ${amount ? `R${amount}` : 'an amount'} failed: ${failureReason}. (Attempt ${failureCount}/3)`,
        severity: shouldSuspend ? 'critical' : 'error',
        data: {
          reference,
          amount,
          failureReason,
          failureCount,
          shouldSuspend,
          updatePaymentUrl: `${process.env.APP_URL}/billing/update-payment`,
        },
      });
    } catch (notifError) {
      logger.error('Error creating failure notification:', notifError);
    }

    // Send email notification
    try {
      const emailSubject = shouldSuspend
        ? 'URGENT: Account Suspended - Payment Failed'
        : 'Payment Failed - Action Required';

      const emailContent = `
        <h2>${shouldSuspend ? 'Account Suspended' : 'Payment Failed'}</h2>
        <p>Hello ${user.firstName},</p>
        <p>${shouldSuspend
          ? `Your Salesdam account has been suspended due to ${failureCount} failed payment attempts.`
          : `Your payment for Salesdam subscription has failed.`
        }</p>
        <h3>Payment Details:</h3>
        <ul>
          <li><strong>Amount:</strong> ${amount ? `R${amount}` : 'N/A'}</li>
          <li><strong>Reference:</strong> ${reference}</li>
          <li><strong>Reason:</strong> ${failureReason}</li>
          ${failureCount > 1 ? `<li><strong>Failed Attempts:</strong> ${failureCount}/3</li>` : ''}
        </ul>
        <p>${shouldSuspend
          ? 'Please update your payment method immediately to restore access to your account and data.'
          : 'Please update your payment method and try again.'
        }</p>
        <p>
          <a href="${process.env.APP_URL}/billing/update-payment" style="background-color: #3498db; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; display: inline-block; margin-top: 10px;">
            Update Payment Method
          </a>
        </p>
        ${shouldSuspend ? `
          <p style="color: #e74c3c; font-weight: bold; margin-top: 15px;">
            ⚠️ Your subscription services will be restored once payment is received.
          </p>
        ` : `
          <p style="margin-top: 15px;">If the problem persists, please contact our support team.</p>
        `}
      `;

      await sendEmailNotification(user.email, emailSubject, emailContent);
    } catch (emailError) {
      logger.error('Error sending failure email:', emailError);
    }

    // Audit log
    await audit({
      tenantId: user.tenantId,
      userId: user._id,
      userEmail: user.email,
      action: shouldSuspend ? 'account_suspended_payment_failed' : 'payment_failed',
      resource: 'Payment',
      resourceId: reference,
      metadata: {
        amount,
        failureReason,
        failureCount,
        shouldSuspend,
      },
    });

    logger.info(`Processed payment failure for tenant: ${tenant._id}, suspension: ${shouldSuspend}`);
  } catch (error) {
    logger.error('Error handling charge.failed webhook:', error);
  }
}

/**
 * Handle subscription creation
 */
async function handleSubscriptionCreate(data) {
  try {
    const email = data.customer?.email;
    const subscriptionCode = data.subscription_code;

    logger.info(`Subscription created for email: ${email}, code: ${subscriptionCode}`);

    if (email) {
      const user = await User.findOne({ email }).populate('tenantId');
      if (user) {
        await Tenant.findByIdAndUpdate(user.tenantId, {
          $set: {
            'billing.subscriptionId': subscriptionCode,
            'billing.status': 'active',
          },
        });

        await Notification.create({
          tenantId: user.tenantId,
          userId: user._id,
          type: 'subscription_created',
          title: 'Subscription Active',
          message: 'Your subscription is now active and recurring charges are set up.',
          severity: 'success',
        });

        logger.info(`Updated subscription for tenant: ${user.tenantId}`);
      }
    }
  } catch (error) {
    logger.error('Error handling subscription.create webhook:', error);
  }
}

/**
 * Handle subscription cancellation
 */
async function handleSubscriptionDisable(data) {
  try {
    const email = data.customer?.email;
    const subscriptionCode = data.subscription_code;

    logger.info(`Subscription disabled for email: ${email}, code: ${subscriptionCode}`);

    if (email) {
      const user = await User.findOne({ email }).populate('tenantId');
      if (user) {
        await Tenant.findByIdAndUpdate(user.tenantId, {
          $set: { 'billing.status': 'disabled' },
        });

        await Notification.create({
          tenantId: user.tenantId,
          userId: user._id,
          type: 'subscription_disabled',
          title: 'Subscription Disabled',
          message: 'Your subscription has been disabled. Please contact support if this was unexpected.',
          severity: 'warning',
        });

        logger.info(`Disabled subscription for tenant: ${user.tenantId}`);
      }
    }
  } catch (error) {
    logger.error('Error handling subscription.disable webhook:', error);
  }
}

/**
 * Handle invoice payment request
 */
async function handleInvoicePaymentRequested(data) {
  try {
    const email = data.customer?.email;
    const reference = data.reference;

    logger.info(`Invoice payment requested for email: ${email}, reference: ${reference}`);

    if (email) {
      const user = await User.findOne({ email }).populate('tenantId');
      if (user) {
        await Notification.create({
          tenantId: user.tenantId,
          userId: user._id,
          type: 'payment_reminder',
          title: 'Payment Reminder',
          message: 'Your payment is due. Please complete your payment to avoid service interruption.',
          severity: 'warning',
          data: { reference },
        });
      }
    }
  } catch (error) {
    logger.error('Error handling invoice.payment_requested webhook:', error);
  }
}

/**
 * Helper: Create Paystack subscription
 * Maps plan tier to Paystack plan code and creates the subscription
 */
async function createPaystackSubscription(tenant, customerId, authorizationCode) {
  try {
    // Get available plans from Paystack
    const planResult = await paystackService.getPlans();
    if (!planResult || !planResult.success) {
      logger.warn('Failed to fetch Paystack plans for subscription creation');
      return;
    }

    // Find the plan code that matches the tenant's plan tier
    const selectedPlan = planResult.data.find((p) =>
      p.plan_code.includes(tenant.plan)
    );

    if (!selectedPlan) {
      logger.warn(
        `No Paystack plan found for tenant plan tier: ${tenant.plan}`,
      );
      return;
    }

    logger.info(
      `Creating subscription with plan: ${selectedPlan.plan_code}, customer: ${customerId}`,
    );

    // Create the subscription
    const subscriptionResult = await paystackService.createSubscription(
      customerId,
      selectedPlan.plan_code,
      authorizationCode,
    );

    if (!subscriptionResult || !subscriptionResult.success) {
      logger.error('Failed to create Paystack subscription:', subscriptionResult);
      return;
    }

    const subscriptionCode = subscriptionResult.data?.subscription_code;
    logger.info(`Subscription created successfully: ${subscriptionCode}`);

    // Update tenant with subscription info
    await Tenant.findByIdAndUpdate(tenant._id, {
      $set: {
        'billing.subscriptionId': subscriptionCode,
        'billing.customerId': customerId,
      },
    });

    logger.info(`Updated tenant ${tenant._id} with subscription: ${subscriptionCode}`);

    // Create notification for subscription setup
    try {
      const user = await User.findOne({ tenantId: tenant._id });
      if (user) {
        await Notification.create({
          tenantId: tenant._id,
          userId: user._id,
          type: 'subscription_created',
          title: 'Recurring Subscription Active',
          message: 'Your subscription has been set up. Recurring charges will be processed according to your billing cycle.',
          severity: 'success',
          data: { subscriptionCode },
        });
      }
    } catch (notifError) {
      logger.error('Error creating subscription notification:', notifError);
    }

    return subscriptionCode;
  } catch (error) {
    logger.error('Error creating Paystack subscription:', error);
    throw error;
  }
}

export default router;
