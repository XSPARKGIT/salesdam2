import crypto from 'crypto';
import * as client from 'openid-client';
import Tenant from '../models/Tenant.js';
import User from '../models/User.js';
import SsoLoginState from '../models/SsoLoginState.js';
import configurationService from '../services/configurationService.js';
import { audit } from '../utils/auditLogger.js';
import { asyncHandler, sendSuccess, AppError } from '../utils/errors.js';

/**
 * Single Sign-On (Core BRD §21.6) — a real OpenID Connect Authorization Code
 * flow using `openid-client`: issuer discovery, state + nonce (CSRF/replay
 * protection) + PKCE, a genuine token exchange against the identity
 * provider's token endpoint, and ID-token signature/issuer/audience/nonce
 * validation via the provider's published JWKS. Nothing here is simulated —
 * a tenant that configures a real IdP (Okta, Auth0, Azure AD, Google
 * Workspace, or any other spec-compliant OIDC provider) can sign in through
 * it with this code as written.
 *
 * Tenant-scoped configuration (auth.sso_enabled/provider/issuer/client_id/
 * client_secret) is the existing TenantConfiguration system from Section 20,
 * gated to the 'enterprise' plan in configurationController.updateTenantConfig.
 *
 * Identity mapping: the authenticated email must match an existing, active
 * user in that tenant. This deliberately does not auto-provision accounts
 * from an IdP claim — that would be a second, ungoverned way to create
 * users, bypassing the existing invite/role-assignment model. An unmatched
 * email is sent back to login with a clear reason, not a fabricated session.
 */

const SSO_STATE_COOKIE = 'crm.sso';
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes to complete the round trip

// openid-client refuses plain-HTTP issuers by default (correctly — a real
// IdP is always HTTPS). The one narrow exception: an issuer that is itself
// http: can only ever be a local/non-production test provider, so discovery
// for one explicitly opts into the library's documented insecure-request
// escape hatch. A real https: issuer never takes this path.
const discoverIssuer = (issuer, clientId, clientSecret) => {
  const isInsecureIssuer = new URL(issuer).protocol === 'http:';
  return client.discovery(
    new URL(issuer),
    clientId,
    clientSecret,
    undefined,
    isInsecureIssuer ? { execute: [client.allowInsecureRequests] } : undefined,
  );
};

const getTenantSsoConfig = async (tenantId) => {
  const tenant = await Tenant.findById(tenantId).select('_id plan');
  if (!tenant) return { tenant: null };
  const keys = ['auth.sso_enabled', 'auth.sso_provider', 'auth.sso_issuer', 'auth.sso_client_id', 'auth.sso_client_secret'];
  const resolved = await configurationService.resolveMany(keys, tenantId);
  const enabled = Boolean(resolved['auth.sso_enabled']) && tenant.plan === 'enterprise';
  return {
    tenant,
    enabled,
    provider: resolved['auth.sso_provider'] || '',
    issuer: resolved['auth.sso_issuer'] || '',
    clientId: resolved['auth.sso_client_id'] || '',
    clientSecret: resolved['auth.sso_client_secret'] || '',
  };
};

const callbackUrlFor = (req, tenantId) => {
  const base = process.env.API_URL || `${req.protocol}://${req.get('host')}`;
  return `${base}/api/v1/auth/sso/${tenantId}/callback`;
};

const _setStateCookie = (res, id) => {
  const isProd = process.env.NODE_ENV === 'production';
  const parts = [
    `${SSO_STATE_COOKIE}=${id}`,
    'HttpOnly',
    'Path=/',
    `Max-Age=${Math.floor(STATE_TTL_MS / 1000)}`,
    `SameSite=${isProd ? 'None' : 'Lax'}`,
  ];
  if (isProd) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
};

const _clearStateCookie = (res) => {
  res.setHeader('Set-Cookie', `${SSO_STATE_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
};

const _readStateCookie = (req) => {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === SSO_STATE_COOKIE) return part.slice(idx + 1).trim();
  }
  return null;
};

const getStatus = asyncHandler(async (req, res) => {
  const cfg = await getTenantSsoConfig(req.params.tenantId);
  if (!cfg.tenant) throw new AppError('Workspace not found.', 404);
  // Never exposes issuer/client id/secret here — the one endpoint a
  // not-yet-authenticated visitor can call.
  sendSuccess(res, {
    data: {
      enabled: cfg.enabled && Boolean(cfg.issuer) && Boolean(cfg.clientId),
      provider: cfg.provider || null,
      implemented: true,
    },
  });
});

const initiate = asyncHandler(async (req, res) => {
  const cfg = await getTenantSsoConfig(req.params.tenantId);
  if (!cfg.tenant) throw new AppError('Workspace not found.', 404);
  if (!cfg.enabled) {
    throw new AppError('Single Sign-On is not enabled for this workspace.', 403);
  }
  if (!cfg.issuer || !cfg.clientId || !cfg.clientSecret) {
    throw new AppError(
      'Single Sign-On is enabled but not fully configured (issuer, client ID and client secret are all required). Ask your administrator to finish setup in Admin Settings.',
      409,
    );
  }

  let config;
  try {
    config = await discoverIssuer(cfg.issuer, cfg.clientId, cfg.clientSecret);
  } catch (err) {
    throw new AppError(`Could not reach the identity provider: ${err.message}`, 502);
  }

  const state = client.randomState();
  const nonce = client.randomNonce();
  const codeVerifier = client.randomPKCECodeVerifier();
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);

  const stateDoc = await SsoLoginState.create({
    tenantId: cfg.tenant._id,
    state,
    nonce,
    codeVerifier,
    redirectTo: typeof req.query.redirectTo === 'string' ? req.query.redirectTo : '',
    expiresAt: new Date(Date.now() + STATE_TTL_MS),
  });
  _setStateCookie(res, stateDoc._id.toString());

  const authUrl = client.buildAuthorizationUrl(config, {
    redirect_uri: callbackUrlFor(req, cfg.tenant._id),
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  res.redirect(authUrl.href);
});

const callback = asyncHandler(async (req, res) => {
  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  const fail = (reason) => res.redirect(`${appUrl}/login?ssoError=${encodeURIComponent(reason)}`);

  const stateId = _readStateCookie(req);
  if (!stateId) return fail('missing_state');

  const stateDoc = await SsoLoginState.findById(stateId);
  _clearStateCookie(res);
  if (!stateDoc) return fail('expired_or_invalid_state');
  await SsoLoginState.deleteOne({ _id: stateDoc._id }); // single use

  if (String(stateDoc.tenantId) !== String(req.params.tenantId)) {
    return fail('tenant_mismatch');
  }

  const cfg = await getTenantSsoConfig(req.params.tenantId);
  if (!cfg.tenant || !cfg.enabled || !cfg.issuer) return fail('sso_not_configured');

  let config;
  try {
    config = await discoverIssuer(cfg.issuer, cfg.clientId, cfg.clientSecret);
  } catch (err) {
    return fail('idp_unreachable');
  }

  const currentUrl = new URL(req.originalUrl, callbackUrlFor(req, req.params.tenantId));

  let tokens;
  try {
    tokens = await client.authorizationCodeGrant(config, currentUrl, {
      expectedState: stateDoc.state,
      expectedNonce: stateDoc.nonce,
      pkceCodeVerifier: stateDoc.codeVerifier,
    });
  } catch (err) {
    // Deliberately generic to the client — a provider error, a tampered
    // state/nonce, and a replayed code all land here without distinguishing
    // which, so nothing about the failure mode is disclosed to the browser.
    await audit({
      tenantId: cfg.tenant._id,
      action: 'sso_login_failed',
      resource: 'User',
      details: { reason: err?.code || err?.message || 'token_exchange_failed' },
      req,
      status: 'failure',
    });
    return fail('authentication_failed');
  }

  let claims = tokens.claims();
  // Many providers only put email on the userinfo endpoint, not the ID
  // token itself — fall back to it rather than assuming ID-token-only.
  if (!claims?.email && tokens.access_token) {
    try {
      const userinfo = await client.fetchUserInfo(config, tokens.access_token, claims.sub);
      claims = { ...claims, ...userinfo };
    } catch { /* fall through to the no_email_claim rejection below */ }
  }
  const email = String(claims?.email || '').trim().toLowerCase();
  if (!email) return fail('no_email_claim');
  if (claims?.email_verified === false) return fail('email_not_verified');

  const user = await User.findOne({ tenantId: cfg.tenant._id, email, status: 'active' }).populate('role');
  if (!user) {
    await audit({
      tenantId: cfg.tenant._id,
      action: 'sso_login_failed',
      resource: 'User',
      details: { reason: 'no_matching_user' },
      req,
      status: 'failure',
    });
    return fail('no_account');
  }

  await req.createSession({
    userId: user._id.toString(),
    tenantId: cfg.tenant._id.toString(),
    userAgent: req.headers['user-agent'] || '',
    ipAddress: req.ip,
  });

  await audit({
    tenantId: cfg.tenant._id,
    userId: user._id,
    userEmail: user.email,
    action: 'sso_login',
    resource: 'User',
    resourceId: user._id,
    details: { provider: cfg.provider },
    req,
  });

  const redirectTo = stateDoc.redirectTo && stateDoc.redirectTo.startsWith('/') ? stateDoc.redirectTo : '/';
  res.redirect(`${appUrl}${redirectTo}`);
});

export default { getStatus, initiate, callback };
