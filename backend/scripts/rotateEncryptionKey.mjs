/**
 * Re-encrypt every stored secret under a new ENCRYPTION_KEY (BRD §14.2.11).
 *
 *   OLD_ENCRYPTION_KEY=<the key now in use> ENCRYPTION_KEY=<the new key> \
 *     node scripts/rotateEncryptionKey.mjs            # dry run: counts only
 *   ... node scripts/rotateEncryptionKey.mjs --apply  # rewrite
 *
 * Then deploy with the new ENCRYPTION_KEY. Run it once, with the application stopped or idle.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { isEncrypted, reencryptSecret } from '../utils/secretCrypto.js';

const old = process.env.OLD_ENCRYPTION_KEY;
if (!old || !process.env.ENCRYPTION_KEY || old === process.env.ENCRYPTION_KEY) {
  console.error('Set OLD_ENCRYPTION_KEY and a different ENCRYPTION_KEY.');
  process.exit(1);
}
const apply = process.argv.includes('--apply');
await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
const db = mongoose.connection.db;
const CFG = 'salesdam-config-salt', INT = 'salesdam-integration-salt', MFA = 'salesdam-mfa-salt';
const targets = [
  ['tenantconfigurations', 'value', CFG, { isSecret: true }],
  ['emailsenders', 'smtpPass', INT, {}],
  ['webhooks', 'secret', INT, {}],
  ['channelaccounts', 'webhookSecret', INT, {}],
  ['channelaccounts', 'credentials', INT, {}],
  ['users', 'mfa.secret', MFA, {}],
];
let total = 0;
for (const [coll, field, salt, filter] of targets) {
  let n = 0;
  for await (const doc of db.collection(coll).find(filter)) {
    const cur = field.split('.').reduce((o, k) => o?.[k], doc);
    if (!isEncrypted(cur)) continue;
    n += 1;
    if (apply) await db.collection(coll).updateOne({ _id: doc._id }, { $set: { [field]: reencryptSecret(cur, salt, old) } });
  }
  console.log(`${coll}.${field}: ${n} value(s) ${apply ? 'rewritten' : 'would be rewritten'}`);
  total += n;
}
console.log(`${total} total${apply ? '' : ' (dry run — pass --apply)'}`);
process.exit(0);
