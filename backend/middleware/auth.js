import User from '../models/User.js';
import Session from '../models/Session.js';
import ApiKey from '../models/ApiKey.js';
import ApiKeyUsageLog from '../models/ApiKeyUsageLog.js';
import { AppError } from '../utils/errors.js';
import configurationService from '../services/configurationService.js';
import authSecurityService from '../services/authSecurityService.js';

// Core BRD §21.4: while MFA is required but not yet enrolled, a session can
// reach only what's needed to finish enrollment (or sign out) — nothing
// else. Checked against req.originalUrl since requireAuth is shared across
// every router, so a relative req.path would mean different things
// depending on where it's mounted.
const MFA_ENROLLMENT_ALLOWLIST = new Set([
  '/api/v1/auth/me',
  '/api/v1/auth/logout',
  '/api/v1/auth/mfa/status',
  '/api/v1/auth/mfa/enroll',
  '/api/v1/auth/mfa/enroll/verify',
]);

/**
 * requireAuth - Enforce active session OR valid API key.
 */
const requireAuth = async (req, res, next) => {
  try {
    // 1. Check API key header
    const apiKeyHeader = req.headers['x-api-key'];
    if (apiKeyHeader) {
      return await authenticateApiKey(req, res, next, apiKeyHeader);
    }

    // 2. Check session is present (loaded by sessionMiddleware from DB)
    if (!req.sessionData?.userId) {
      throw new AppError('Authentication required. Please log in.', 401);
    }

    // A session still awaiting its MFA challenge is not an authenticated
    // session — only POST /auth/mfa/verify may act on it.
    if (req.sessionData.mfaPending) {
      throw new AppError('MFA verification required. Please complete sign-in.', 401);
    }

    // Core BRD §21.5: automatic logout after configured inactivity. 0 (the
    // default) disables this check — only the absolute session lifetime
    // (sessionMiddleware's TTL) applies.
    if (req.sessionData.lastAccessedAt) {
      const inactivityMinutes = await configurationService.resolve(
        'auth.session_inactivity_timeout_minutes',
        req.sessionData.tenantId,
        0,
      );
      if (inactivityMinutes > 0) {
        const idleMs = Date.now() - new Date(req.sessionData.lastAccessedAt).getTime();
        if (idleMs > inactivityMinutes * 60 * 1000) {
          await req.destroySession();
          throw new AppError('Your session has expired due to inactivity. Please log in again.', 401);
        }
      }
    }

    // 3. Load the user
    const user = await User.findById(req.sessionData.userId)
      .populate('role')
      .select('+password'); // need this for checks occasionally

    if (!user) {
      await req.destroySession();
      throw new AppError('User not found. Session invalidated.', 401);
    }

    if (user.status !== 'active') {
      throw new AppError(
        'Your account has been deactivated. Please contact your administrator.',
        403,
      );
    }

    if (user.isLocked()) {
      throw new AppError(
        'Account temporarily locked due to too many failed login attempts.',
        403,
      );
    }

    // 4. Enforce active tenant strictly from the server-side session.
    //    Never trust a client-supplied X-Tenant-ID header to establish scope.
    const tenantId = req.sessionData.tenantId;
    if (!tenantId) {
      throw new AppError('No active tenant. Please select a workspace.', 400);
    }

    // Core BRD §21.4: block everything except finishing enrollment (or
    // logging out) for a user MFA requires but who hasn't enrolled yet.
    // Enforced here, on every authenticated request, not just at login —
    // so it can't be bypassed by going straight to another endpoint.
    if (!user.mfa?.enabled) {
      const mfaRequired = await authSecurityService.isMfaRequiredFor(user);
      if (mfaRequired) {
        const path = (req.originalUrl || '').split('?')[0];
        if (!MFA_ENROLLMENT_ALLOWLIST.has(path)) {
          throw new AppError('Multi-factor authentication setup is required before you can continue.', 403);
        }
      }
    }

    req.user = user;
    req.tenantId = tenantId.toString();

    // Touch session last-accessed time (non-blocking)
    Session.updateOne(
      { sessionId: req.sessionId },
      { lastAccessedAt: new Date() },
    ).catch(() => {});
    User.updateOne({ _id: user._id }, { lastActivity: new Date() }).catch(
      () => {},
    );

    next();
  } catch (err) {
    try {
      const AuthFailureLog = (await import('../models/AuthFailureLog.js')).default;
      await AuthFailureLog.create({
        tenantId: req.tenantId || null,
        integration: 'session',
        reason: err.message || 'Authentication failed',
        ip: req.ip || req.headers['x-forwarded-for'],
        path: req.path,
        method: req.method,
      });
    } catch { /* ignore */ }
    next(err);
  }
};

const authenticateApiKey = async (req, res, next, rawKey) => {
  try {
    const prefix = rawKey.substring(0, 12);
    const apiKeys = await ApiKey.find({
      keyPrefix: prefix,
      isActive: true,
    }).select('+keyHash');

    const validKey = apiKeys.find((k) => k.verifyKey(rawKey));
    if (!validKey) throw new AppError('Invalid or expired API key.', 401);

    if (validKey.expiresAt && validKey.expiresAt < new Date()) {
      throw new AppError('API key has expired.', 401);
    }

    // Check IP whitelist
    if (validKey.ipWhitelist && validKey.ipWhitelist.length > 0) {
      const ip = req.ip;
      if (!validKey.ipWhitelist.includes(ip)) {
        throw new AppError('IP not whitelisted for this API key.', 403);
      }
    }

    // Load the user who created the key as the authenticated identity
    const user = await User.findById(validKey.createdBy).populate('role');
    if (!user || user.status !== 'active') {
      throw new AppError('API key owner account is inactive.', 403);
    }

    req.user = user;
    req.tenantId = validKey.tenantId.toString();
    req.apiKey = validKey;
    req.isApiKeyAuth = true;

    // ── Object-level access restriction ──────────────────────────────────────
    // If the key has allowedObjects, block any request targeting an object
    // outside that list. Empty array = unrestricted (all objects allowed).
    if (validKey.allowedObjects?.length > 0) {
      // Extract objectApiName from the URL path.
      // Matches /records/:objectApiName/… and /objects/:apiName/…
      const url = req.originalUrl || '';
      const m = url.match(/\/(?:records|objects)\/([a-z0-9_-]+)/i);
      const objectApiName = m?.[1];

      // Skip special non-object path segments
      const NOT_OBJECTS = new Set([
        'validate',
        'validate-formula',
        'bulk-delete',
        'seed-standard',
      ]);

      if (
        objectApiName &&
        !NOT_OBJECTS.has(objectApiName) &&
        !validKey.allowedObjects.includes(objectApiName)
      ) {
        throw new AppError(
          `This API key is not authorised to access '${objectApiName}'. ` +
            `Allowed: ${validKey.allowedObjects.join(', ')}.`,
          403,
        );
      }
    }

    // ── Scope enforcement (SEC-003) ──────────────────────────────────────────
    // If the key declares explicit scopes, the HTTP method must match one of them.
    if (validKey.scopes && validKey.scopes.length > 0) {
      const METHOD_SCOPE = {
        GET:    'read',
        HEAD:   'read',
        POST:   'write',
        PUT:    'write',
        PATCH:  'write',
        DELETE: 'delete',
      };
      const required = METHOD_SCOPE[req.method?.toUpperCase()];
      if (
        required &&
        !validKey.scopes.includes(required) &&
        !validKey.scopes.includes('admin')
      ) {
        throw new AppError(
          `This API key does not have '${required}' scope for ${req.method} requests.`,
          403,
        );
      }
    }

    // Update usage counter (non-blocking)
    ApiKey.updateOne(
      { _id: validKey._id },
      {
        lastUsedAt: new Date(),
        $inc: { usageCount: 1 },
      },
    ).catch(() => {});

    // Log detailed usage when the response finishes (non-blocking, never throws)
    const _start = Date.now();
    res.on('finish', () => {
      const objMatch = (req.originalUrl || '').match(
        /\/(?:records|objects)\/([a-z0-9_-]+)/i,
      );
      const NOT_SEGS = new Set([
        'validate',
        'bulk-delete',
        'seed-standard',
        'screen-flows',
        'run-action',
      ]);
      const rawSeg = objMatch?.[1];
      const objectApiName =
        rawSeg && !NOT_SEGS.has(rawSeg) ? rawSeg : undefined;

      ApiKeyUsageLog.create({
        tenantId: req.tenantId,
        keyId: validKey._id,
        keyPrefix: validKey.keyPrefix,
        method: req.method,
        path: req.path,
        objectApiName,
        statusCode: res.statusCode,
        responseTime: Date.now() - _start,
        ip: req.ip,
      }).catch(() => {});
    });

    next();
  } catch (err) {
    try {
      const AuthFailureLog = (await import('../models/AuthFailureLog.js')).default;
      await AuthFailureLog.create({
        tenantId: null,
        integration: 'api-key',
        identifier: rawKey ? rawKey.substring(0, 8) + '...' : undefined,
        reason: err.message || 'API key authentication failed',
        ip: req.ip || req.headers['x-forwarded-for'],
        path: req.path,
        method: req.method,
      });
    } catch { /* ignore */ }
    next(err);
  }
};
const requireSuperuser = (req, res, next) => {
  if (!req.user || !req.user.role || req.user.role.name !== 'superuser') {
    return next(new AppError('Superuser access required.', 403));
  }
  next();
};

/**
 * requireAdmin - Superuser or Admin.
 */
const requireAdmin = (req, res, next) => {
  if (!req.user || !req.user.isAdmin()) {
    return next(new AppError('Admin access required.', 403));
  }
  next();
};

/**
 * optionalAuth - Attach user if session exists, but don't fail if not.
 */
const optionalAuth = async (req, res, next) => {
  if (req.sessionData?.userId) {
    try {
      req.user = await User.findById(req.sessionData.userId).populate('role');
      req.tenantId = req.sessionData.tenantId;
    } catch {
      // Ignore — optional auth never blocks the request
    }
  }
  next();
};

export { requireAuth, requireSuperuser, requireAdmin, optionalAuth };
