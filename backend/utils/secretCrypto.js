import crypto from 'crypto';

/**
 * Shared AES-256-GCM encrypt/decrypt for secrets at rest (tenant
 * configuration values, MFA TOTP secrets, …). One ENCRYPTION_KEY env var,
 * a distinct salt per domain so the derived keys never collide.
 */
if (process.env.NODE_ENV === 'production' && !process.env.ENCRYPTION_KEY) {
  throw new Error('ENCRYPTION_KEY must be set in production: tenant secrets are encrypted with it.');
}
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'dev-only-insecure-key-change-me';

const deriveKey = (salt) => crypto.scryptSync(ENCRYPTION_KEY, salt, 32);

export const encryptSecret = (plaintext, salt = 'salesdam-config-salt') => {
  const key = deriveKey(salt);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext ?? ''), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
};

export const isEncrypted = (v) => typeof v === 'string' && v.startsWith('enc:');

export const decryptSecret = (stored, salt = 'salesdam-config-salt') => {
  if (!isEncrypted(stored)) return stored;
  const parts = stored.split(':');
  if (parts.length !== 4) return stored;
  const [, ivB64, tagB64, dataB64] = parts;
  const key = deriveKey(salt);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const dec = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
  return dec.toString('utf8');
};

/**
 * Re-encrypt one stored value from an old key to the current ENCRYPTION_KEY (key rotation).
 * Values that are not encrypted are returned unchanged.
 */
export const reencryptSecret = (stored, salt, oldKeyMaterial) => {
  if (!isEncrypted(stored)) return stored;
  const parts = stored.split(':');
  if (parts.length !== 4) return stored;
  const [, ivB64, tagB64, dataB64] = parts;
  const decipher = crypto.createDecipheriv('aes-256-gcm', crypto.scryptSync(oldKeyMaterial, salt, 32), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const plain = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  return encryptSecret(plain, salt);
};
