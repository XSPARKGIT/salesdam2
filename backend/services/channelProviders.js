import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { CHANNELS } from '../models/ChannelAccount.js';
import logger from '../utils/logger.js';

/**
 * Channel provider abstraction (Core BRD §18.5, §16.4).
 *
 * Every channel resolves to an adapter. Adapters declare their capabilities
 * and expose a single `send`. WhatsApp/Messenger/Instagram call the real Meta
 * Graph API endpoints and email sends real SMTP via nodemailer, using the
 * ChannelAccount's own `credentials` — none of this has been exercised
 * against a live Meta app or mailbox in this session (no credentials were
 * available), only against mocked HTTP/SMTP in tests. A channel/provider
 * combination with no live call wired below still reports 'queued' with an
 * explicit reason rather than a false success.
 */

const GRAPH_API_VERSION = 'v19.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

/** fetch is a Node global (18+); kept as a reference so tests can stub it. */
const _fetch = (...args) => globalThis.fetch(...args);

const CAPABILITIES = {
  whatsapp: { templates: true, deliveryStatus: true, calls: false },
  facebook: { templates: false, deliveryStatus: true, calls: false },
  instagram: { templates: false, deliveryStatus: true, calls: false },
  email: { templates: true, deliveryStatus: true, calls: false },
  sms: { templates: false, deliveryStatus: true, calls: false },
  telephony: { templates: false, deliveryStatus: false, calls: true },
  webchat: { templates: false, deliveryStatus: true, calls: false },
  other: { templates: false, deliveryStatus: false, calls: false },
};

const isConfigured = (account) =>
  Boolean(account?.credentials && Object.keys(account.credentials).length > 0);

/** WhatsApp Cloud API send — plain text or an approved template. */
const _sendWhatsapp = async (account, message) => {
  const { accessToken, phoneNumberId } = account.credentials || {};
  if (!accessToken || !phoneNumberId) {
    return { status: 'queued', providerStatus: 'not_configured', note: 'Missing accessToken/phoneNumberId.' };
  }
  const to = message.recipientIdentifier;
  if (!to) return { status: 'failed', providerStatus: 'error', note: 'No recipient phone number on this conversation.' };

  const body = message.template
    ? {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: message.template.providerTemplateId || message.template.name,
          language: { code: message.template.language || 'en' },
          components: message.template.components || [],
        },
      }
    : { messaging_product: 'whatsapp', to, type: 'text', text: { body: message.body } };

  try {
    const res = await _fetch(`${GRAPH_BASE}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      logger.error(`WhatsApp send failed: ${JSON.stringify(json)}`);
      return { status: 'failed', providerStatus: 'error', note: json?.error?.message || `HTTP ${res.status}` };
    }
    return {
      status: 'sent',
      providerStatus: 'sent',
      note: '',
      externalMessageId: json?.messages?.[0]?.id,
    };
  } catch (err) {
    logger.error(`WhatsApp send threw: ${err.message}`);
    return { status: 'failed', providerStatus: 'error', note: err.message };
  }
};

/** Meta Send API — Messenger (facebook) and Instagram share this endpoint shape. */
const _sendMeta = async (account, message) => {
  const { pageAccessToken } = account.credentials || {};
  if (!pageAccessToken) {
    return { status: 'queued', providerStatus: 'not_configured', note: 'Missing pageAccessToken.' };
  }
  const recipientId = message.recipientIdentifier;
  if (!recipientId) return { status: 'failed', providerStatus: 'error', note: 'No recipient PSID on this conversation.' };

  try {
    const res = await _fetch(
      `${GRAPH_BASE}/me/messages?access_token=${encodeURIComponent(pageAccessToken)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: { id: recipientId }, message: { text: message.body } }),
      },
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      logger.error(`Meta send failed: ${JSON.stringify(json)}`);
      return { status: 'failed', providerStatus: 'error', note: json?.error?.message || `HTTP ${res.status}` };
    }
    return { status: 'sent', providerStatus: 'sent', note: '', externalMessageId: json?.message_id };
  } catch (err) {
    logger.error(`Meta send threw: ${err.message}`);
    return { status: 'failed', providerStatus: 'error', note: err.message };
  }
};

// Tests substitute a fake transporter (matching nodemailer's sendMail shape)
// rather than hitting a real mailbox — the same seam mailer.js uses.
let _testTransportFactory = null;
export const setEmailTransportFactory = (fn) => {
  _testTransportFactory = fn;
};

/** Per-account SMTP send (the 'smtp' provider declares host/port/username/password/from). */
const _sendEmail = async (account, message) => {
  const { host, port, username, password, from, secure } = account.credentials || {};
  if (!host || !username || !password || !from) {
    return { status: 'queued', providerStatus: 'not_configured', note: 'Missing SMTP host/username/password/from.' };
  }
  const to = message.recipientIdentifier;
  if (!to) return { status: 'failed', providerStatus: 'error', note: 'No recipient email on this conversation.' };

  try {
    const transporter = _testTransportFactory
      ? _testTransportFactory({ host, port, username, password, from, secure })
      : nodemailer.createTransport({
          host,
          port: Number(port) || 587,
          secure: Boolean(secure),
          auth: { user: username, pass: password },
        });
    const info = await transporter.sendMail({
      from,
      to,
      subject: message.subject || '(no subject)',
      html: message.body,
    });
    return { status: 'sent', providerStatus: 'sent', note: '', externalMessageId: info?.messageId };
  } catch (err) {
    logger.error(`Email send threw: ${err.message}`);
    return { status: 'failed', providerStatus: 'error', note: err.message };
  }
};

const LIVE_SENDERS = {
  whatsapp: _sendWhatsapp,
  facebook: _sendMeta,
  instagram: _sendMeta,
  email: _sendEmail,
};

const buildAdapter = (channel) => ({
  channel,
  capabilities: CAPABILITIES[channel] || CAPABILITIES.other,
  isConfigured,
  async send(account, message) {
    if (!isConfigured(account)) {
      return {
        status: 'queued',
        providerStatus: 'not_configured',
        note: 'Channel account has no provider credentials.',
      };
    }
    const sender = LIVE_SENDERS[channel];
    if (!sender) {
      return {
        status: 'queued',
        providerStatus: 'pending_integration',
        note: `${channel} outbound delivery is not implemented yet.`,
      };
    }
    return sender(account, message);
  },
});

/**
 * Fetch a Meta Lead Ads lead's full field data via the Graph API (§16.1).
 * The leadgen webhook itself carries only the id — the form answers must be
 * fetched separately with the page's access token.
 */
const fetchLeadFieldData = async (account, leadgenId) => {
  const { pageAccessToken } = account?.credentials || {};
  if (!pageAccessToken) {
    throw new Error('Channel account has no pageAccessToken configured.');
  }
  const res = await _fetch(
    `${GRAPH_BASE}/${leadgenId}?access_token=${encodeURIComponent(pageAccessToken)}`,
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error?.message || `Graph API returned HTTP ${res.status}`);
  }
  return json; // { id, field_data: [{ name, values }], ad_id, form_id, created_time, ... }
};

const ADAPTERS = CHANNELS.reduce((acc, channel) => {
  acc[channel] = buildAdapter(channel);
  return acc;
}, {});

export const getAdapter = (channel) => ADAPTERS[channel] || ADAPTERS.other;

export const capabilitiesFor = (channel) => getAdapter(channel).capabilities;

/**
 * Verify a channel webhook signature over the exact raw bytes received.
 * Accepts `x-salesdam-signature` or Meta's `x-hub-signature-256`. A channel
 * account with no signing secret rejects every webhook rather than accepting
 * unauthenticated inbound payloads.
 */
export const verifyWebhookSignature = (account, req) => {
  const secret = account?.webhookSecret;
  if (!secret) return false;
  const header =
    req.headers['x-salesdam-signature'] || req.headers['x-hub-signature-256'];
  if (!header) return false;
  const provided = String(header).startsWith('sha256=')
    ? String(header).slice(7)
    : String(header);
  const expected = crypto
    .createHmac('sha256', secret)
    .update(req.rawBody || Buffer.from(''))
    .digest('hex');
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

/* ── Provider readiness registry (§16.1, §18.5) ─────────────────────────── */

/**
 * Concrete providers sit behind the channel abstraction. Each declares the
 * credentials an admin must supply and, where the vendor's webhook contract is
 * documented, normalizes its inbound payload into the canonical shape the
 * ingestion service understands. Providers whose contract is not yet supplied
 * declare `normalizeInbound: null` — a clearly marked seam.
 */
const _metaMessageText = (msg) =>
  msg.text?.body ||
  msg.button?.text ||
  msg.interactive?.button_reply?.title ||
  msg.interactive?.list_reply?.title ||
  `[${msg.type || 'message'}]`;

const _metaWhatsappInbound = (body) => {
  if (!body || body.object !== 'whatsapp_business_account') return null;
  const events = [];
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      for (const msg of value.messages || []) {
        const contact = (value.contacts || []).find((c) => c.wa_id === msg.from);
        events.push({
          kind: 'message',
          from: { identifier: msg.from, name: contact?.profile?.name || '' },
          body: _metaMessageText(msg),
          externalMessageId: msg.id,
          occurredAt: msg.timestamp ? Number(msg.timestamp) * 1000 : undefined,
        });
      }
      for (const status of value.statuses || []) {
        events.push({
          kind: 'status',
          externalMessageId: status.id,
          status: status.status || 'sent',
          providerStatus: status.status || '',
        });
      }
    }
  }
  return events.length ? { events } : null;
};

const _metaMessengerInbound = (body) => {
  if (!body || !['page', 'instagram'].includes(body.object)) return null;
  const events = [];
  for (const entry of body.entry || []) {
    for (const item of entry.messaging || []) {
      if (!item.message || item.message.is_echo) continue;
      events.push({
        kind: 'message',
        from: { identifier: item.sender?.id, name: '' },
        body: item.message.text || `[${item.message.attachments ? 'attachment' : 'message'}]`,
        externalMessageId: item.message.mid,
        occurredAt: item.timestamp,
      });
    }
  }
  return events.length ? { events } : null;
};

const _defineProvider = (id, def) => ({
  id,
  capabilities: CAPABILITIES[def.channel] || CAPABILITIES.other,
  requiredCredentials: [],
  normalizeInbound: null,
  ...def,
});

const PROVIDERS = {
  meta: _defineProvider('meta', {
    channel: 'whatsapp',
    label: 'Meta WhatsApp Cloud API',
    requiredCredentials: ['accessToken', 'phoneNumberId'],
    normalizeInbound: _metaWhatsappInbound,
  }),
  meta_messenger: _defineProvider('meta_messenger', {
    channel: 'facebook',
    label: 'Meta Messenger (Facebook Page)',
    requiredCredentials: ['pageAccessToken', 'appSecret'],
    normalizeInbound: _metaMessengerInbound,
  }),
  meta_instagram: _defineProvider('meta_instagram', {
    channel: 'instagram',
    label: 'Meta Instagram Messaging',
    requiredCredentials: ['pageAccessToken', 'appSecret'],
    normalizeInbound: _metaMessengerInbound,
  }),
  meta_leadgen: _defineProvider('meta_leadgen', {
    channel: 'facebook',
    label: 'Meta Lead Ads',
    requiredCredentials: ['pageAccessToken'],
    note: 'Receives Meta leadgen webhook events and fetches full field data via the Graph API.',
  }),
  smtp: _defineProvider('smtp', {
    channel: 'email',
    label: 'SMTP / inbound email',
    requiredCredentials: ['host', 'port', 'username', 'password', 'from'],
    note: 'Inbound email parsing depends on the mail provider webhook contract.',
  }),
  sms_gateway: _defineProvider('sms_gateway', {
    channel: 'sms',
    label: 'SMS gateway',
    requiredCredentials: ['apiKey', 'senderId'],
    note: 'Inbound SMS parsing depends on the gateway webhook contract.',
  }),
  euphoria: _defineProvider('euphoria', {
    channel: 'telephony',
    label: 'Euphoria',
    requiredCredentials: ['apiKey', 'accountId'],
    note: 'Euphoria webhook and call-control contracts not yet supplied.',
  }),
  twilio: _defineProvider('twilio', {
    channel: 'telephony',
    label: 'Twilio',
    requiredCredentials: ['accountSid', 'authToken', 'fromNumber'],
    note: 'Twilio posts form-encoded webhooks; wired once the contract is confirmed.',
  }),
  webchat: _defineProvider('webchat', {
    channel: 'webchat',
    label: 'Built-in web chat',
  }),
};

const GENERIC_CHANNEL_ADAPTER = _defineProvider('generic', { channel: 'other' });

/** Resolve a provider definition, falling back to a generic one for a channel. */
export const getProvider = (providerId, channel) => {
  const provider = PROVIDERS[providerId];
  if (provider && (!channel || provider.channel === channel)) return provider;
  return { ...GENERIC_CHANNEL_ADAPTER, channel: channel || provider?.channel || 'other' };
};

/** Static provider catalog for the admin UI: what to configure and what works. */
export const listProviders = () =>
  Object.values(PROVIDERS).map((provider) => ({
    provider: provider.id,
    channel: provider.channel,
    label: provider.label,
    capabilities: provider.capabilities,
    requiredCredentials: provider.requiredCredentials,
    inboundNormalizer: Boolean(provider.normalizeInbound),
    note: provider.note || '',
  }));

/** Check an account's credentials against its provider's requirements. */
export const validateConfig = (account) => {
  const provider = getProvider(account?.provider, account?.channel);
  const credentials = account?.credentials || {};
  const missing = provider.requiredCredentials.filter((key) => {
    const value = credentials[key];
    return value === undefined || value === null || value === '';
  });
  return {
    provider: provider.id,
    channel: provider.channel,
    required: provider.requiredCredentials,
    missing,
    valid: missing.length === 0,
    hasWebhookSecret: Boolean(account?.webhookSecret),
    inboundNormalizer: Boolean(provider.normalizeInbound),
  };
};

/**
 * Normalize a provider webhook body into canonical ingestion events. Returns
 * null when the provider has no normalizer or the body is not in its shape, so
 * callers fall through to treating the body as already-canonical (dev/tests).
 */
export const normalizeInbound = (providerId, channel, body) => {
  const provider = getProvider(providerId, channel);
  return provider.normalizeInbound ? provider.normalizeInbound(body) : null;
};

export { fetchLeadFieldData };

export default {
  getAdapter,
  capabilitiesFor,
  verifyWebhookSignature,
  getProvider,
  listProviders,
  validateConfig,
  normalizeInbound,
  fetchLeadFieldData,
  setEmailTransportFactory,
};
