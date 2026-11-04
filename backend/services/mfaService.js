import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { encryptSecret, decryptSecret } from '../utils/secretCrypto.js';

// A domain-specific salt, distinct from the tenant-configuration one, so the
// two derived keys never collide even though both read ENCRYPTION_KEY.
const MFA_SALT = 'salesdam-mfa-salt';
const BACKUP_CODE_COUNT = 8;

export const generateSecret = () => authenticator.generateSecret();

export const encryptMfaSecret = (secret) => encryptSecret(secret, MFA_SALT);
export const decryptMfaSecret = (stored) => decryptSecret(stored, MFA_SALT);

export const buildOtpAuthUri = (secret, email, issuer = 'Salesdam') =>
  authenticator.keyuri(email, issuer, secret);

/**
 * Renders the real otpauth:// URI (built from this user's actual enrollment
 * secret, not a placeholder) as a scannable QR code. Returns a data: URI —
 * nothing is written to disk or logged.
 */
export const buildEnrollmentQrCode = async (otpAuthUri) =>
  QRCode.toDataURL(otpAuthUri, { margin: 1, width: 240 });

export const verifyToken = (token, secret) => {
  try {
    return authenticator.check(String(token || '').trim(), secret);
  } catch {
    return false;
  }
};

/**
 * Generates one-time recovery codes. Returns both the plaintext (shown to
 * the user exactly once) and their bcrypt hashes (what gets persisted) —
 * the same pattern ApiKey/Integration already use for raw-value-once secrets.
 */
export const generateBackupCodes = async (count = BACKUP_CODE_COUNT) => {
  const plain = Array.from({ length: count }, () =>
    crypto.randomBytes(5).toString('hex').toUpperCase().match(/.{1,5}/g).join('-'),
  );
  const hashes = await Promise.all(plain.map((c) => bcrypt.hash(c, 10)));
  return { plain, hashes };
};

/**
 * Checks a candidate backup code against the stored hashes and returns the
 * index of the one it matched (for single-use removal), or -1.
 */
export const matchBackupCode = async (code, hashes) => {
  const candidate = String(code || '').trim().toUpperCase();
  for (let i = 0; i < hashes.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    if (await bcrypt.compare(candidate, hashes[i])) return i;
  }
  return -1;
};

export default {
  generateSecret,
  encryptMfaSecret,
  decryptMfaSecret,
  buildOtpAuthUri,
  buildEnrollmentQrCode,
  verifyToken,
  generateBackupCodes,
  matchBackupCode,
};
