// Per-tenant rate limiter (in-memory, sliding window)
const tenantRateLimits = new Map();

export const tenantRateLimiter = (maxRequests = 100, windowMs = 60000) => {
  return (req, res, next) => {
    const tenantId = req.tenantId || req.headers['x-tenant-id'] || 'unknown';
    const key = `${tenantId}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    if (!tenantRateLimits.has(key)) {
      tenantRateLimits.set(key, []);
    }
    const requests = tenantRateLimits.get(key).filter((t) => t > windowStart);
    requests.push(now);
    tenantRateLimits.set(key, requests);

    if (requests.length > maxRequests) {
      res.setHeader('Retry-After', Math.ceil(windowMs / 1000));
      return res.status(429).json({ success: false, message: 'Rate limit exceeded. Try again later.' });
    }
    next();
  };
};

export default tenantRateLimiter;
EOF
echo "created"