import mongoose from 'mongoose';

/**
 * Short-lived, server-side storage for one in-progress SSO login attempt
 * (Core BRD §21.6). There is no user session yet at this point in the
 * flow — the OIDC `state`, `nonce` and PKCE `code_verifier` can't be
 * trusted to a client-readable cookie, so they're kept here instead,
 * referenced by a random id in an HttpOnly cookie. Same pattern as the
 * Session model: a Mongo-backed ephemeral record with a TTL index.
 */
const ssoLoginStateSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    state: { type: String, required: true },
    nonce: { type: String, required: true },
    codeVerifier: { type: String, required: true },
    redirectTo: { type: String },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

ssoLoginStateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model('SsoLoginState', ssoLoginStateSchema);
