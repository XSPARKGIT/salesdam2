import express from 'express';
import { handleLeadgen, verifySubscription } from '../controllers/facebookLeadController.js';

const router = express.Router();

// Both are public — Meta cannot authenticate as a Salesdam user. The GET
// handshake verifies the webhook subscription; the POST is signature-verified
// per request against the target ChannelAccount's webhookSecret.
router.get('/leadgen/:accountId', verifySubscription);
router.post('/leadgen/:accountId', handleLeadgen);

export default router;
