/**
 * Seed the Insurance Workspace objects for a tenant.
 *
 * Usage (from backend/):
 *   node scripts/seed-insurance-objects.js "Acme Insurance"   # by tenant name
 *   node scripts/seed-insurance-objects.js <tenantObjectId>    # by id
 *   node scripts/seed-insurance-objects.js                     # every hub='insurance' tenant
 *
 * Idempotent. Seeds only if the standard CRM objects already exist for the
 * tenant (the insurance pack looks up client/account/product/lead/user).
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import Tenant from '../models/Tenant.js';
import User from '../models/User.js';
import ObjectMeta from '../models/ObjectMeta.js';
import { seedStandardObjects } from '../services/metadataService.js';
import { seedInsuranceObjects, seedInsuranceWorkspace } from '../services/insuranceMetadataService.js';
import { ensureDefaultActions } from '../services/actionService.js';

const resolveTenants = async (arg) => {
  if (!arg) return Tenant.find({ hub: 'insurance' });
  const byId = mongoose.isValidObjectId(arg) ? [{ _id: arg }] : [];
  return Tenant.find({ $or: [...byId, { name: arg }] });
};

const run = async () => {
  await connectDB();
  const arg = process.argv[2];
  const tenants = await resolveTenants(arg);

  if (!tenants.length) {
    console.error(arg ? `No tenant matched "${arg}".` : "No tenants have hub='insurance'.");
    process.exitCode = 1;
  }

  for (const tenant of tenants) {
    const user = await User.findOne({ tenantId: tenant._id });

    const standard = await ObjectMeta.findOne({ tenantId: tenant._id, apiName: 'client' });
    if (!standard) {
      console.error(
        `${tenant.name}: standard CRM objects not seeded — run the normal tenant seed first.`,
      );
      process.exitCode = 1;
      continue;
    }

    const created = await seedInsuranceObjects(tenant._id, user?._id);
    const workspace = await seedInsuranceWorkspace(tenant._id, user?._id);
    await ensureDefaultActions(tenant._id);
    console.log(
      `${tenant.name}: created ${created.length} insurance object(s); ` +
        `workspace "${workspace.name}" (${workspace.allowedObjects.length} objects).`,
    );
  }

  await mongoose.connection.close();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
