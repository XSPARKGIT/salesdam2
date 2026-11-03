import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import Tenant from '../models/Tenant.js';
import User from '../models/User.js';
import Role from '../models/Role.js';
import { seedDefaultRoles } from '../services/roleService.js';

await connectDB();

const existing = await User.findOne({ email: 'admin@example.com' });
if (existing) {
  console.log('Admin already exists:', existing.email);
  await mongoose.connection.close();
  process.exit(0);
}

const tenant = await Tenant.create({
  name: 'My Company',
  slug: 'my-company',
  status: 'active',
  plan: 'enterprise',
  limits: { maxUsers: 100, maxRecords: 1000000, maxObjects: 100, maxAutomations: 100 },
});

await seedDefaultRoles(tenant._id);
const superuserRole = await Role.findOne({ tenantId: tenant._id, name: 'superuser' });

const user = await User.create({
  tenantId: tenant._id,
  activeTenantId: tenant._id,
  firstName: 'System',
  lastName: 'Admin',
  email: 'admin@example.com',
  username: 'admin',
  password: 'Admin@123456',
  role: superuserRole._id,
  status: 'active',
  emailVerified: true,
});

console.log('Seeded admin:', user.email, user._id);
console.log('Tenant:', tenant.slug, tenant._id);
await mongoose.connection.close();
process.exit(0);
