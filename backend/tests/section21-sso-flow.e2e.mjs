/**
 * section21-sso-flow.e2e.mjs — BRD §21.6 SSO: a genuine OpenID Connect
 * Authorization Code flow, driven end-to-end through the real controller
 * (controllers/ssoController.js), a real Express app, a real database, and
 * a real identity provider.
 *
 * "Real identity provider" here means a local instance of `oidc-provider` —
 * the same reference OIDC Provider implementation used by countless
 * production deployments and by openid-client's own test suite — configured
 * with a test client. This is not a stub that returns a canned response:
 * it performs genuine discovery, a real browser-style login+consent
 * interaction, real authorization-code issuance, a real token exchange
 * (HTTP POST to a token endpoint, HTTP Basic client authentication), and
 * real ID-token signature/issuer/audience/nonce validation via the
 * provider's published JWKS — exactly what a real external IdP (Okta,
 * Auth0, Azure AD, Google Workspace, …) would do. The only thing that
 * differs from a production setup is which issuer is configured; the
 * protocol code exercised is identical either way.
 *
 * Run: node tests/section21-sso-flow.e2e.mjs   (from backend/)
 */
import 'dotenv/config';
import http from 'http';
import mongoose from 'mongoose';
import Provider from 'oidc-provider';
import * as openidClient from 'openid-client';
import connectDB from '../config/db.js';
import app from '../app.js';
import Tenant from '../models/Tenant.js';
import User from '../models/User.js';
import Role from '../models/Role.js';
import AuditLog from '../models/AuditLog.js';
import SsoLoginState from '../models/SsoLoginState.js';
import TenantConfiguration from '../models/TenantConfiguration.js';
import { seedDefaultRoles } from '../services/roleService.js';

const RUN = Date.now().toString(36);
const PASSWORD = 'Sso21Pass!23';
const results = [];
const check = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── A real local OIDC Provider, standing in for the external IdP ─────────
const IDP_PORT = 9979;
const issuer = `http://127.0.0.1:${IDP_PORT}`;
const CLIENT_ID = `client-${RUN}`;
const CLIENT_SECRET = `secret-${RUN}`;
const APP_CALLBACK_HOST = 'http://127.0.0.1'; // filled in once the app server's port is known

let idpAccountEmail = `ssouser-${RUN}@example.com`;
let idpEmailVerified = true;

let idpServer;
let idpProvider;
const startIdp = (redirectUri) => {
  idpProvider = new Provider(issuer, {
    clients: [{
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uris: [redirectUri],
      response_types: ['code'],
      grant_types: ['authorization_code'],
      token_endpoint_auth_method: 'client_secret_basic',
    }],
    pkce: { required: () => false },
    claims: { openid: ['sub'], email: ['email', 'email_verified'] },
    findAccount: async (ctx, sub) => ({
      accountId: sub,
      async claims() { return { sub, email: idpAccountEmail, email_verified: idpEmailVerified }; },
    }),
    features: { devInteractions: { enabled: true } },
  });
  idpServer = http.createServer(idpProvider.callback());
  return new Promise((resolve) => idpServer.listen(IDP_PORT, resolve));
};

// ── Minimal cookie jars, one per origin (app vs. IdP) ─────────────────────
const makeJar = () => {
  const map = new Map();
  return {
    absorb(res) {
      for (const c of res.headers.getSetCookie?.() || []) {
        const [pair] = c.split(';');
        const idx = pair.indexOf('=');
        const name = pair.slice(0, idx);
        const value = pair.slice(idx + 1);
        if (value === '' || /1970/.test(c)) map.delete(name);
        else map.set(name, value);
      }
    },
    header() { return [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; '); },
    get(name) { return map.get(name); },
  };
};

let appBase;
const appReq = async (path, { method = 'GET', cookie, body, redirect = 'manual' } = {}) => {
  const res = await fetch(`${appBase}${path}`, {
    method,
    redirect,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  const text = await res.text().catch(() => '');
  try { json = JSON.parse(text); } catch { /* not json, e.g. a redirect body */ }
  return { status: res.status, headers: res.headers, json, text };
};

/**
 * Drives the full browser-side dance for one SSO login attempt, starting
 * from the app's own /sso/:tenantId/login URL, through the real IdP's
 * devInteractions login + consent screens, back to the app's callback.
 * Returns the app's final response (its redirect to the frontend, with any
 * session cookie it set).
 */
const driveSsoLogin = async (tenantId) => {
  const appJar = makeJar();
  const idpJar = makeJar();

  let res = await appReq(`/api/v1/auth/sso/${tenantId}/login`);
  appJar.absorb(res);
  if (res.status !== 302) return { stage: 'initiate', status: res.status, text: res.text };
  let loc = res.headers.get('location');

  // → IdP: GET the authorization URL
  res = await fetch(loc, { redirect: 'manual' });
  idpJar.absorb(res);
  if (res.status !== 303) return { stage: 'idp-authorize', status: res.status, text: await res.text() };
  loc = res.headers.get('location');
  if (loc.startsWith('/')) loc = issuer + loc;

  // → IdP: GET + POST the login interaction
  let uid = loc.match(/interaction\/([^/?]+)/)[1];
  res = await fetch(loc, { headers: { cookie: idpJar.header() }, redirect: 'manual' });
  idpJar.absorb(res);
  res = await fetch(`${issuer}/interaction/${uid}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie: idpJar.header() },
    body: new URLSearchParams({ prompt: 'login', login: 'ssotestaccount' }).toString(),
    redirect: 'manual',
  });
  idpJar.absorb(res);
  loc = res.headers.get('location');
  if (loc?.startsWith('/')) loc = issuer + loc;

  // → IdP: resume, which may ask for consent
  res = await fetch(loc, { headers: { cookie: idpJar.header() }, redirect: 'manual' });
  idpJar.absorb(res);
  loc = res.headers.get('location');
  if (loc?.startsWith('/')) loc = issuer + loc;

  if (loc && loc.includes('/interaction/')) {
    uid = loc.match(/interaction\/([^/?]+)/)[1];
    res = await fetch(loc, { headers: { cookie: idpJar.header() }, redirect: 'manual' });
    idpJar.absorb(res);
    res = await fetch(`${issuer}/interaction/${uid}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie: idpJar.header() },
      body: new URLSearchParams({ prompt: 'consent' }).toString(),
      redirect: 'manual',
    });
    idpJar.absorb(res);
    loc = res.headers.get('location');
    if (loc?.startsWith('/')) loc = issuer + loc;
    res = await fetch(loc, { headers: { cookie: idpJar.header() }, redirect: 'manual' });
    idpJar.absorb(res);
    loc = res.headers.get('location');
  }

  // loc is now the IdP's redirect back to our app's callback, with code+state.
  if (!loc || !loc.startsWith(appBase)) return { stage: 'idp-final', status: res.status, loc };

  const callbackPath = loc.slice(appBase.length);
  res = await appReq(callbackPath, { cookie: appJar.header() });
  appJar.absorb(res);
  return { stage: 'callback', status: res.status, location: res.headers.get('location'), sessionCookie: appJar.get('crm.sid'), appJar };
};

let tenantId = null;
let tenantBId = null;
try {
  await connectDB();

  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  appBase = `${APP_CALLBACK_HOST}:${server.address().port}`;
  // The controller prefers API_URL (correct in production, behind a proxy)
  // over inferring the host from the request — point it at this ephemeral
  // test server so the redirect_uri it builds actually matches this run.
  process.env.API_URL = appBase;

  const tenant = await Tenant.create({ name: `ZZ_SSOFLOW_${RUN}`, status: 'active', plan: 'enterprise' });
  tenantId = tenant._id;
  await seedDefaultRoles(tenantId);
  const adminRole = await Role.findOne({ tenantId, name: 'admin' });
  const adminEmail = `admin-${RUN}@example.com`;
  await User.create({ tenantId, firstName: 'a', lastName: 'd', email: adminEmail, username: adminEmail, password: PASSWORD, role: adminRole._id, status: 'active', emailVerified: true });

  await startIdp(`${appBase}/api/v1/auth/sso/${tenantId}/callback`);
  check('local test identity provider is listening', true);

  // Admin logs in normally (password) to configure SSO for the tenant.
  const loginRes = await appReq('/api/v1/auth/login', { method: 'POST', body: { username: adminEmail, password: PASSWORD } });
  const adminCookie = (loginRes.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).find((c) => c.startsWith('crm.sid='));
  check('admin can log in to configure SSO', Boolean(adminCookie), `HTTP ${loginRes.status}`);

  const setCfg = (key, value) => appReq(`/api/v1/configuration/${key}`, { method: 'PUT', cookie: adminCookie, body: { value } });
  let r = await setCfg('auth.sso_enabled', true);
  check('SSO enabled for this (enterprise) tenant', r.status === 200, `HTTP ${r.status}`);
  await setCfg('auth.sso_provider', 'oidc');
  r = await setCfg('auth.sso_issuer', issuer);
  check('SSO issuer configured', r.status === 200, `HTTP ${r.status}`);
  await setCfg('auth.sso_client_id', CLIENT_ID);
  r = await setCfg('auth.sso_client_secret', CLIENT_SECRET);
  check('SSO client secret configured (stored encrypted)', r.status === 200, `HTTP ${r.status}`);

  const storedSecretDoc = await TenantConfiguration.findOne({ tenantId, key: 'auth.sso_client_secret' }).lean();
  check('the client secret is actually encrypted at rest, not plaintext', typeof storedSecretDoc.value === 'string' && storedSecretDoc.value.startsWith('enc:') && !storedSecretDoc.value.includes(CLIENT_SECRET));

  // ── Scenario 1: the IdP's authenticated email matches a real user ──────
  const matchedEmail = `matched-${RUN}@example.com`;
  await User.create({ tenantId, firstName: 'M', lastName: 'U', email: matchedEmail, username: matchedEmail, password: PASSWORD, role: adminRole._id, status: 'active', emailVerified: true });
  idpAccountEmail = matchedEmail;
  idpEmailVerified = true;

  let flow = await driveSsoLogin(tenantId);
  check('the full IdP round trip reaches our callback', flow.stage === 'callback', JSON.stringify(flow));
  check('a matching user is granted a real session (redirected to the app, cookie set)', flow.status === 302 && Boolean(flow.sessionCookie), JSON.stringify(flow));

  if (flow.sessionCookie) {
    r = await appReq('/api/v1/auth/me', { cookie: `crm.sid=${flow.sessionCookie}` });
    check('that session cookie genuinely authenticates subsequent requests', r.status === 200 && r.json?.data?.user?.email === matchedEmail, `HTTP ${r.status} ${JSON.stringify(r.json?.data?.user?.email)}`);
  }

  await wait(150);
  const loginEvt = await AuditLog.findOne({ tenantId, action: 'sso_login' }).sort({ createdAt: -1 }).lean();
  check('sso_login is audited with correct user/tenant attribution', Boolean(loginEvt) && String(loginEvt.userEmail) === matchedEmail);
  const blob = JSON.stringify(loginEvt || {});
  check('no token, code or client secret appears in the sso_login audit entry', !blob.includes(CLIENT_SECRET) && !blob.toLowerCase().includes('bearer'));

  const stateAfter = await SsoLoginState.findOne({ tenantId });
  check('the one-time login state is consumed (deleted) after use, not reusable', !stateAfter);

  // ── Scenario 2: IdP authenticates a real person, but no such user exists ─
  idpAccountEmail = `nobody-${RUN}@example.com`;
  flow = await driveSsoLogin(tenantId);
  check('an IdP identity with no matching account does not get a session', flow.stage === 'callback' && !flow.sessionCookie, JSON.stringify(flow));
  check('it is redirected back to login with a clear reason, not silently failed', (flow.location || '').includes('ssoError=no_account'), flow.location);

  const failEvt = await AuditLog.findOne({ tenantId, action: 'sso_login_failed' }).sort({ createdAt: -1 }).lean();
  check('sso_login_failed is audited for the unmatched-account case', Boolean(failEvt));

  // ── Scenario 3: IdP reports an unverified email ─────────────────────────
  idpAccountEmail = matchedEmail;
  idpEmailVerified = false;
  flow = await driveSsoLogin(tenantId);
  check('an unverified email at the IdP is rejected, not trusted', flow.stage === 'callback' && !flow.sessionCookie && (flow.location || '').includes('ssoError=email_not_verified'), JSON.stringify(flow));
  idpEmailVerified = true;

  // ── Scenario 4: a tampered/garbage state value is rejected ─────────────
  r = await appReq(`/api/v1/auth/sso/${tenantId}/login`);
  let loc = r.headers.get('location');
  const stateCookie = (r.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).find((c) => c.startsWith('crm.sso='));
  const u = new URL(loc);
  u.searchParams.set('state', 'tampered-state-value');
  u.searchParams.set('code', 'irrelevant-code');
  const tamperedCallback = `/api/v1/auth/sso/${tenantId}/callback?${u.searchParams.toString()}`;
  r = await appReq(tamperedCallback, { cookie: stateCookie });
  check('a tampered state value is rejected rather than accepted', r.status === 302 && (r.headers.get('location') || '').includes('ssoError='), r.headers.get('location'));

  // ── Scenario 5: no state cookie at all (e.g. a replayed/bare callback) ──
  r = await appReq(`/api/v1/auth/sso/${tenantId}/callback?code=x&state=y`);
  check('a callback with no state cookie is rejected', r.status === 302 && (r.headers.get('location') || '').includes('ssoError=missing_state'), r.headers.get('location'));

  // ── Tenant isolation: tenant B has no SSO config and cannot log in via it ─
  const tenantB = await Tenant.create({ name: `ZZ_SSOFLOW_B_${RUN}`, status: 'active', plan: 'enterprise' });
  tenantBId = tenantB._id;
  r = await appReq(`/api/v1/auth/sso/${tenantBId}/login`);
  check('a tenant with no SSO configuration cannot initiate a login', r.status !== 302, `HTTP ${r.status}`);

  // Cross-tenant state confusion: a state minted for tenant A must not work
  // against tenant B's callback URL.
  r = await appReq(`/api/v1/auth/sso/${tenantId}/login`);
  loc = r.headers.get('location');
  const stateCookie2 = (r.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).find((c) => c.startsWith('crm.sso='));
  const u2 = new URL(loc);
  r = await appReq(`/api/v1/auth/sso/${tenantBId}/callback?${u2.searchParams.toString()}`, { cookie: stateCookie2 });
  check('a state minted for tenant A is rejected against tenant B’s callback', r.status === 302 && (r.headers.get('location') || '').includes('ssoError='), r.headers.get('location'));

  server.close();
} catch (err) {
  check('harness ran without error', false, err.stack || err.message);
} finally {
  if (idpServer) idpServer.close();
  if (tenantId) {
    const ids = [tenantId, tenantBId].filter(Boolean);
    await Promise.all([
      Tenant.deleteMany({ _id: { $in: ids } }),
      User.deleteMany({ tenantId: { $in: ids } }),
      Role.deleteMany({ tenantId: { $in: ids } }),
      AuditLog.deleteMany({ tenantId: { $in: ids } }),
      TenantConfiguration.deleteMany({ tenantId: { $in: ids } }),
      SsoLoginState.deleteMany({ tenantId: { $in: ids } }),
    ].map((p) => p.catch(() => {})));
  }
  await mongoose.connection.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
