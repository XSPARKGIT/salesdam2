import channelService from '../services/channelService.js';
import channelProviders from '../services/channelProviders.js';
import { CHANNELS } from '../models/ChannelAccount.js';
import { asyncHandler, sendSuccess } from '../utils/errors.js';
import { audit } from '../utils/auditLogger.js';

const listAccounts = asyncHandler(async (req, res) => {
  const accounts = await channelService.listAccounts(req.tenantId);
  sendSuccess(res, { data: accounts });
});

// Static channel/provider capabilities for the inbox UI.
const capabilities = asyncHandler(async (_req, res) => {
  sendSuccess(res, {
    data: CHANNELS.map((channel) => ({
      channel,
      ...channelProviders.capabilitiesFor(channel),
    })),
  });
});

// Supported concrete providers: what credentials they need and whether inbound
// payload normalization is implemented (provider readiness, §16.1).
const providers = asyncHandler(async (_req, res) => {
  sendSuccess(res, { data: channelProviders.listProviders() });
});

const getAccount = asyncHandler(async (req, res) => {
  const account = await channelService.getAccount({
    tenantId: req.tenantId,
    id: req.params.id,
  });
  sendSuccess(res, { data: account });
});

const createAccount = asyncHandler(async (req, res) => {
  const account = await channelService.createAccount({
    tenantId: req.tenantId,
    data: req.body,
    user: req.user,
  });
  // Never include credentials/webhookSecret in audit details.
  await audit({
    tenantId: req.tenantId,
    userId: req.user._id,
    action: 'integration_config_create',
    resource: 'ChannelAccount',
    resourceId: account._id,
    details: { channel: account.channel, provider: account.provider, name: account.name },
    req,
  });
  sendSuccess(res, { data: account }, 'Channel account created', 201);
});

const updateAccount = asyncHandler(async (req, res) => {
  const account = await channelService.updateAccount({
    tenantId: req.tenantId,
    id: req.params.id,
    updates: req.body,
  });
  await audit({
    tenantId: req.tenantId,
    userId: req.user._id,
    action: 'integration_config_update',
    resource: 'ChannelAccount',
    resourceId: account._id,
    details: { channel: account.channel, provider: account.provider, fields: Object.keys(req.body || {}).filter((k) => k !== 'credentials' && k !== 'webhookSecret') },
    req,
  });
  sendSuccess(res, { data: account }, 'Channel account updated');
});

const deleteAccount = asyncHandler(async (req, res) => {
  const existing = await channelService.getAccount({ tenantId: req.tenantId, id: req.params.id }).catch(() => null);
  await channelService.deleteAccount({ tenantId: req.tenantId, id: req.params.id });
  await audit({
    tenantId: req.tenantId,
    userId: req.user._id,
    action: 'integration_config_delete',
    resource: 'ChannelAccount',
    resourceId: req.params.id,
    details: { channel: existing?.channel, provider: existing?.provider, name: existing?.name },
    req,
  });
  sendSuccess(res, {}, 'Channel account deleted');
});

// Report which provider credentials are still required before this account can
// send/receive live traffic (§16.1).
const validateAccount = asyncHandler(async (req, res) => {
  const account = await channelService.getAccountSecrets({
    tenantId: req.tenantId,
    id: req.params.id,
  });
  const result = channelProviders.validateConfig(account);
  sendSuccess(
    res,
    { data: result },
    result.valid
      ? 'Provider configuration complete'
      : 'Provider configuration incomplete',
  );
});

// Public inbound webhook: authenticated by signature, not by session.
const webhook = asyncHandler(async (req, res) => {
  const account = await channelService.resolveWebhookAccount({
    channel: req.params.channel,
    accountId: req.params.accountId,
    req,
  });
  const body = req.body || {};

  // A recognized provider payload is normalized into one or more canonical
  // events; otherwise the body is treated as already-canonical (dev/tests).
  const normalized = channelProviders.normalizeInbound(
    account.provider,
    account.channel,
    body,
  );
  if (!normalized) {
    const result = await channelService.ingest({ account, payload: body });
    return sendSuccess(res, { data: result }, 'Webhook accepted', 202);
  }

  // Provider payloads batch events: one bad event must not drop the rest.
  const results = [];
  for (const event of normalized.events) {
    try {
      results.push(await channelService.ingest({ account, payload: event }));
    } catch (err) {
      results.push({ error: err.message });
    }
  }
  sendSuccess(
    res,
    { data: { accepted: results.length, results } },
    'Webhook accepted',
    202,
  );
});

export {
  listAccounts,
  capabilities,
  providers,
  getAccount,
  createAccount,
  updateAccount,
  deleteAccount,
  validateAccount,
  webhook,
};
