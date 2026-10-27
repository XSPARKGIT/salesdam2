import rateLimit from 'express-rate-limit';

// Account-scoped limiter: 10 failed attempts per 15 min per IP+username.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many auth attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const user = (req.body?.username || req.body?.email || '').toLowerCase().trim();
    return `acct:${req.ip}:${user}`;
  },
});

// IP-scoped limiter: broader abuse protection (50 attempts per 15 min per IP).
const authIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { success: false, message: 'Too many auth attempts from this IP. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `ip:${req.ip}`,
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 300,
  message: { success: false, message: 'Too many requests. Rate limit: 300/min.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return `${req.tenantId || req.ip}:${req.user?._id || req.ip}`;
  },
});

const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Webhook rate limit exceeded.' },
});

export { authLimiter, authIpLimiter, apiLimiter, webhookLimiter };
