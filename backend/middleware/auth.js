import User from '../models/User.js';
import Session from '../models/Session.js';
import ApiKey from '../models/ApiKey.js';
import ApiKeyUsageLog from '../models/ApiKeyUsageLog.js';
import { AppError } from '../utils/errors.js';

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
    next(err);
  }
};

/**
 * requireSuperuser - Only the global superuser can access.
 */
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
