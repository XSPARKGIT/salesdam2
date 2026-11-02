import mongoose from 'mongoose';
import { CHANNELS } from './ChannelAccount.js';

/**
 * MessageTemplate — tenant-level reusable communication template (Core BRD
 * §16.5). Channel-agnostic so agents, flows and approval processes can all
 * select from the same library; provider template identifiers are stored for
 * channels that require external approval (e.g. WhatsApp).
 */
const messageTemplateSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    channel: { type: String, enum: CHANNELS, required: true, index: true },
    subject: { type: String, default: '', trim: true },
    // Body supports {{merge}} fields resolved from record data at send time.
    body: { type: String, required: true },
    language: { type: String, default: 'en', trim: true },
    isActive: { type: Boolean, default: true, index: true },

    // Set where the external provider requires template approval. A WhatsApp
    // template may only be sent once this is 'approved' (§16.5) — enforced in
    // inboxService.replyWithTemplate, not just advisory here.
    providerTemplateId: { type: String, default: '' },
    providerStatus: {
      type: String,
      enum: ['', 'local_only', 'pending', 'approved', 'rejected'],
      default: '',
    },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

messageTemplateSchema.index(
  { tenantId: 1, name: 1, channel: 1, language: 1 },
  { unique: true },
);

export default mongoose.model('MessageTemplate', messageTemplateSchema);
