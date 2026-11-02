import express from 'express';
import OpenAI from 'openai';
import { requireAuth } from '../middleware/auth.js';
import { enforceTenant } from '../middleware/tenant.js';
import { checkAppPermission } from '../middleware/permissions.js';
import { asyncHandler, sendSuccess } from '../utils/errors.js';
import { runAIOnboarding, getOnboardingStatus } from '../services/aiOnboardingService.js';

const router = express.Router();

router.use(requireAuth, enforceTenant);

router.get('/onboarding-status', asyncHandler(async (req, res) => {
  const status = await getOnboardingStatus(req.tenantId);
  sendSuccess(res, { data: status });
}));

router.post('/onboarding', checkAppPermission('canCustomizeApplication'), asyncHandler(async (req, res) => {
  const { industry, useCase } = req.body;
  // Run async - don't wait
  runAIOnboarding(req.tenantId, req.user._id, { industry, useCase }).catch(() => {});
  sendSuccess(res, {}, 'AI onboarding started. Your workspace will be ready shortly.');
}));

// AI chat for contextual help (simple pass-through to OpenAI)
router.post('/chat', asyncHandler(async (req, res) => {
  const { message } = req.body;
  if (!message) return sendSuccess(res, { data: { reply: 'Please provide a message.' } });

  if (!process.env.OPENAI_API_KEY) {
    return sendSuccess(res, { data: { reply: 'AI assistance is not configured for this instance.' } });
  }

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a helpful CRM assistant. Help users with their CRM questions.' },
        { role: 'user', content: message },
      ],
      max_tokens: 500,
    });
    const reply = response.choices[0].message.content;
    sendSuccess(res, { data: { reply } });
  } catch (err) {
    sendSuccess(res, { data: { reply: 'Sorry, I could not process your request right now.' } });
  }
}));

export default router;
