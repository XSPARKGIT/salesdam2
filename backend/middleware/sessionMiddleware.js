import { v4 as uuidv4 } from 'uuid';
import Session from '../models/Session.js';

const SESSION_COOKIE = 'crm.sid';
const SESSION_MAX_AGE = parseInt(process.env.SESSION_MAX_AGE) || 86400000; // 24 h

/**
 * Parse a raw Cookie header into a key→value map.
 */
const parseCookies = (cookieHeader = '') => {
  const cookies = {};
  cookieHeader.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  });
  return cookies;
};

/**
 * sessionMiddleware — fully manual session management.
 *
 * Does NOT use express-session or any session store abstraction.
 * Reads the crm.sid cookie, looks up the Session document in MongoDB,
 * and attaches the following to every request:
 *
 *   req.sessionId   {string|null}   the session ID from the cookie
 *   req.sessionData {object|null}   { userId, tenantId, ipAddress, userAgent }
 *
 * Also attaches helper methods:
 *   req.createSession(data)         — create a new session + set cookie
 *   req.updateSession(updates)      — patch the active session document
 *   req.destroySession()            — delete session record + clear cookie
 */
const sessionMiddleware = async (req, res, next) => {
  const cookies = parseCookies(req.headers.cookie);
  const sid = cookies[SESSION_COOKIE] || null;

  req.sessionId = null;
  req.sessionData = null;

  if (sid) {
    try {
      const session = await Session.findOne({
        sessionId: sid,
        expiresAt: { $gt: new Date() },
      });
      if (session) {
        req.sessionId = sid;
        req.sessionData = {
          userId: session.userId?.toString() || null,
          tenantId: session.tenantId?.toString() || null,
          workspaceId: session.workspaceId?.toString() || null,
          userAgent: session.userAgent || '',
          ipAddress: session.ipAddress || '',
          // A session awaiting an MFA challenge is not yet an authenticated
          // session — requireAuth must treat it as unauthenticated.
          mfaPending: Boolean(session.data?.mfaPending),
          lastAccessedAt: session.lastAccessedAt,
        };
      }
    } catch {
      // Never block a request because of a session DB error
    }
  }

  /* ── Helper: create a brand-new session ────────────────────────────── */
  // `opts.maxAgeMs` shortens the lifetime (used for an MFA-pending session);
  // `opts.data` stores arbitrary session-state (e.g. { mfaPending: true }).
  req.createSession = async (data, opts = {}) => {
    const newSid = uuidv4();
    const maxAgeMs = opts.maxAgeMs || SESSION_MAX_AGE;
    const expiresAt = new Date(Date.now() + maxAgeMs);

    await Session.create({
      sessionId: newSid,
      userId: data.userId || null,
      tenantId: data.tenantId || null,
      data: opts.data || {},
      expiresAt,
      lastAccessedAt: new Date(),
      ipAddress: data.ipAddress || req.ip || '',
      userAgent: data.userAgent || req.headers['user-agent'] || '',
    });

    req.sessionId = newSid;
    req.sessionData = { ...data, mfaPending: Boolean(opts.data?.mfaPending) };

    _setSessionCookie(res, newSid, maxAgeMs);
    return newSid;
  };

  /* ── Helper: turn the current MFA-pending session into a full one ───── */
  req.upgradeSessionAfterMfa = async () => {
    if (!req.sessionId) return;
    const expiresAt = new Date(Date.now() + SESSION_MAX_AGE);
    await Session.updateOne(
      { sessionId: req.sessionId },
      { $set: { data: {}, expiresAt, lastAccessedAt: new Date() } },
    );
    req.sessionData = { ...req.sessionData, mfaPending: false };
    _setSessionCookie(res, req.sessionId, SESSION_MAX_AGE);
  };

  /* ── Helper: patch the current session document ─────────────────────── */
  req.updateSession = async (updates) => {
    if (!req.sessionId) return;
    Object.assign(req.sessionData, updates);
    await Session.updateOne(
      { sessionId: req.sessionId },
      { $set: { ...updates, lastAccessedAt: new Date() } },
    ).catch(() => {});
  };

  /* ── Helper: destroy the current session ───────────────────────────── */
  req.destroySession = async () => {
    if (req.sessionId) {
      await Session.deleteOne({ sessionId: req.sessionId }).catch(() => {});
    }
    _clearSessionCookie(res);
    req.sessionId = null;
    req.sessionData = null;
  };

  next();
};

/* ── Cookie utilities ───────────────────────────────────────────────────── */

const _setSessionCookie = (res, sid, maxAgeMs = SESSION_MAX_AGE) => {
  const isProd = process.env.NODE_ENV === 'production';
  const maxAge = Math.floor(maxAgeMs / 1000);

  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(sid)}`,
    'HttpOnly',
    'Path=/',
    `Max-Age=${maxAge}`,
    `SameSite=${isProd ? 'None' : 'Lax'}`, // CHANGE HERE
  ];

  if (isProd) {
    parts.push('Secure'); // required for SameSite=None
  }

  res.setHeader('Set-Cookie', parts.join('; '));
};

const _clearSessionCookie = (res) => {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`,
  );
};

export default sessionMiddleware;
