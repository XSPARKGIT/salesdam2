# BRD Section 16 — Social Media & Messaging Integration: Implementation & Verification Report

**Overall status: PARTIALLY COMPLETE.** The core omnichannel architecture, Facebook Lead Ads webhook, send-by-template with WhatsApp approval enforcement, and real outbound provider dispatch code are implemented and tested. Live Meta/WhatsApp/email delivery has **not** been verified against real provider credentials — none exist in this environment. A frontend (Inbox, Channel Accounts, Message Templates) was built from scratch, as none existed before this session.

---

## A. Implementation Summary

### What was found already built (not built this session)
Before writing any code, the codebase was inspected and a substantial, well-tested backend already existed:
- `ChannelAccount` / `Conversation` / `Message` models — a genuine reusable channel architecture, not per-provider silos
- `channelService.js` — webhook signature verification, idempotency, tenant-scoped contact matching, call ingestion
- `inboxService.js` — list/assign/transfer/status/notes/reply/create-record-from-conversation, consent-gated sends
- `consentService.js`, `Consent` model — centralized opt-in/opt-out enforcement
- `MessageTemplate` model + CRUD + merge-field preview
- Inbound WhatsApp/Messenger/Instagram payload normalizers matching Meta's real webhook contract
- `backend/tests/omnichannel.e2e.mjs` (42 checks), `consent.e2e.mjs` (19), `conversation-capture.e2e.mjs` (14) — all passing before this session and still passing after

### What was broken and is now fixed (real bugs found by inspection, confirmed by failing tests before the fix)
1. **Facebook Lead Ads webhook had no authentication at all.** It trusted `tenantId` directly from the unauthenticated request body — anyone could create a lead in any tenant. Rewritten to resolve the tenant exclusively from a signed `ChannelAccount` (`channel: 'facebook', provider: 'meta_leadgen'`), reusing the same `verifyWebhookSignature`/`resolveWebhookAccount` machinery every other channel already uses.
2. **The route was unreachable regardless.** `app.js` mounted the generic `/integrations` router (which applies `requireAuth` to its entire prefix) *before* `/integrations/facebook`, so every request to the Facebook webhook — old or new — hit `requireAuth` first and got `401`. This predates this session; fixed by reordering the mounts.
3. **No idempotency.** A redelivered `leadgen_id` would have created a duplicate lead every time. Fixed via a unique index on `(tenantId, source, externalEventId)` in `IncomingWebhookLog`.
4. **No duplicate-matching, no assignment integration.** Now runs through the existing `duplicateDetectionService` (the same engine manual capture uses) and assigns via the channel account's `defaultOwnerId`.
5. **Outbound sends never actually called a provider.** `channelProviders.js`'s `send()` always returned `queued/pending_integration` — honest, but non-functional. Real HTTP calls were added for WhatsApp Cloud API, Meta Send API (Messenger/Instagram), and per-account SMTP (nodemailer), each with success/failure handling that updates the stored `Message.status` and `externalMessageId` instead of a blind "sent".
6. **Nothing enforced WhatsApp template-approval rules.** There was no send-by-template path at all. Added `inboxService.replyWithTemplate` + `POST /conversations/:id/reply-template`, which blocks a WhatsApp template send with `409` unless `MessageTemplate.providerStatus === 'approved'`, and resolves merge fields from the conversation's linked record.
7. **`fieldMappings`** (Meta field → Salesdam field, standard or custom) was added to `ChannelAccount` and wired through `channelService.createAccount`/`updateAccount` (initially added to the model but forgotten in the service — caught by the new test, fixed).
8. **Meta's dotted `hub.mode`/`hub.verify_token`/`hub.challenge` query parameters** were silently mis-parsed by Express's default query parser (which expands dots into nested objects). The webhook-subscription GET handshake now parses the raw query string directly.

### New backend components
- `facebookLeadController.js` — fully rewritten: signed POST ingestion, GET verification handshake, Graph API field-data fetch (`channelProviders.fetchLeadFieldData`) for real deliveries, with a `field_data`-in-payload fast path for test fixtures
- `inboxService.replyWithTemplate` / `_sendAndRecord` (shared send core) / `_recordMergeValues`
- `channelProviders._sendWhatsapp` / `_sendMeta` / `_sendEmail` / `fetchLeadFieldData` / `setEmailTransportFactory` (test seam)
- `ChannelAccount.fieldMappings` schema addition
- `IncomingWebhookLog.externalEventId` + unique index (idempotency, reusable by other webhook sources)
- `MessageTemplate.providerStatus` enum tightened to `['', 'local_only', 'pending', 'approved', 'rejected']`

### New frontend (none of this existed before this session)
- `frontend/src/services/api/{channels,conversations,messageTemplates}.js`
- `frontend/src/pages/Admin/ChannelAccounts.jsx` — connect/validate/activate/deactivate/delete channel accounts, shows the real per-account webhook URL
- `frontend/src/pages/Admin/MessageTemplates.jsx` — create/edit/activate/deactivate/delete templates, live merge-field preview, provider-status control
- `frontend/src/pages/Inbox/Inbox.jsx` — the Omnichannel Inbox: conversation list with assigned-to-me/unassigned/status/channel filters, message history, reply, send-by-template (channel- and approval-aware), internal notes, accept/transfer, status changes, create-record-from-conversation
- Routes added to `App.jsx`: `/admin/channels`, `/admin/message-templates`, `/inbox`
- Sidebar entries added (previously `custom-code` and these new pages were unreachable from the UI entirely)

### Fixed along the way (pre-existing, unrelated to the broken feature itself, but blocking verification)
- `CustomCode.jsx` and `Sidebar.jsx` issues from a prior session's Section 15 work were **not** touched again here; no overlap with this work beyond the shared `api.js` error-shape convention, which these new pages follow correctly from the start (`e.message`/`e.data`, not `e.response?.data`).

---

## B. Frontend and Backend Connectivity

| Screen | Backend endpoint(s) | Verified how |
|---|---|---|
| Channel Accounts list/create/validate/deactivate/delete | `GET/POST/PUT/DELETE /api/v1/channels`, `POST /api/v1/channels/:id/validate`, `GET /api/v1/channels/providers` | Browser: created a real WhatsApp account, saw the real webhook URL and "Provider config complete" after Check Config |
| Message Templates list/create/preview/activate/providerStatus | `GET/POST/PUT/DELETE /api/v1/message-templates`, `POST /api/v1/message-templates/:id/preview` | Browser: created a template, ran Preview, got `"Hi Thabo, welcome to Salesdam!"` from the real backend |
| Inbox: list/open/accept/reply/note/status/create-record | `GET /api/v1/conversations`, `GET /api/v1/conversations/:id`, `GET /api/v1/conversations/:id/messages`, `POST .../assign`, `POST .../reply`, `POST .../reply-template`, `POST .../notes`, `POST .../status`, `POST .../create-record` | Browser: sent a real signed WhatsApp webhook via Node, saw the conversation appear in the Inbox, opened it, saw real history, accepted it (assignedTo became the logged-in user), replied (recorded as `queued` with the honest "no provider credentials" note), added an internal note (rendered with an "INTERNAL NOTE" badge), closed it (reply then correctly rejected with 409), reopened it, reloaded the page and confirmed everything persisted |

End-to-end UI → API → MongoDB → UI round trip was exercised for every action above, not inferred from reading the code.

---

## C. Testing Results

### Automated — rerun fresh for this report, after all fixes, nothing skipped or weakened
```
backend/tests/section16-messaging.e2e.mjs   32/32 passed   (new — this session)
backend/tests/omnichannel.e2e.mjs           42/42 passed   (pre-existing, regression-checked)
backend/tests/consent.e2e.mjs               19/19 passed   (pre-existing, regression-checked)
backend/tests/conversation-capture.e2e.mjs  14/14 passed   (pre-existing, regression-checked)
backend/tests/flow-definition.e2e.mjs       25/25 passed   (regression)
backend/tests/activity.e2e.mjs              17/17 passed   (regression)
backend/tests/system-permissions.e2e.mjs    42/42 passed   (regression)
backend/tests/tenant-isolation.e2e.mjs      23/23 passed   (regression)
```
`section16-messaging.e2e.mjs` covers: webhook verification handshake, signature rejection, spoofed-tenantId rejection, standard + explicit custom field mapping, campaign attribution, automatic assignment, Flow trigger on lead creation, idempotent redelivery, duplicate-rule blocking, real WhatsApp/Messenger Graph API dispatch (success and failure) against a stubbed `fetch`, real SMTP dispatch against a stubbed transport, and send-by-template with WhatsApp-approval enforcement including a channel-mismatch rejection.

### Frontend
```
npm run build   ✓ built in ~11s, no errors (pre-existing chunk-size/@extend warnings only)
```

### Browser verification — performed, not claimed without doing it
Done in the Claude Browser pane against the real running dev servers (backend :5002, frontend :5173):
- Loaded `/admin/channels`, `/admin/message-templates`, `/inbox` — all render with no console errors from this session's own code
- Created a real `ChannelAccount` through the UI; the row showed the real webhook URL and validation result
- Created a real `MessageTemplate` through the UI; Preview round-tripped to the backend and resolved `{{first_name}}`
- Sent a real, HMAC-signed inbound WhatsApp webhook from Node (the browser's own `fetch` was CORS-blocked from hitting the API cross-origin directly — documented, not hidden), then confirmed the resulting conversation appeared in the Inbox UI
- Through the Inbox UI: opened the conversation, accepted it, sent a reply (correctly shown as `queued` with the real "no provider credentials" reason — not falsely marked sent), added an internal note (correctly badged, not customer-visible), closed it, confirmed a reply was then rejected (409), reopened it, reloaded the page and confirmed every piece of state survived

### What was NOT independently browser-verified
Two-browser-session tenant isolation / permission-denied UI flows for the new pages — the existing automated suites (`omnichannel.e2e.mjs`, `section16-messaging.e2e.mjs`) already cover the underlying API behavior (403/404 cross-tenant), and re-proving the same assertions by hand through a second login would be redundant, not more rigorous.

---

## D. External Integrations

| Channel | Implementation status | Mock testing | Real provider testing | Still required for live use |
|---|---|---|---|---|
| **Facebook Lead Ads** | Implemented: signed webhook, GET verification handshake, idempotency, field mapping (standard + custom), duplicate-rule check, assignment, Flow trigger, Graph API field-data fetch code path | Full fixture coverage in `section16-messaging.e2e.mjs` (field_data supplied directly, bypassing the Graph call) | **Not tested** — no Meta Developer app, page, or Lead Ads form exists in this environment | A registered Meta App with Lead Ads + `pages_manage_metadata` permission, a connected Page, a Page access token, and the webhook subscribed at `POST /api/v1/integrations/facebook/leadgen/:accountId` with `hub.verify_token` = the ChannelAccount's `webhookSecret` |
| **Messenger (Facebook)** | Implemented: inbound normalizer (pre-existing) + real outbound Send API call (this session) | Inbound: `omnichannel.e2e.mjs`. Outbound: `section16-messaging.e2e.mjs` against a stubbed `fetch`, asserting the exact URL/body sent | **Not tested** | A Page, `pageAccessToken`, `appSecret`, webhook subscribed to `messages`/`messaging_postbacks` at the account's webhook URL |
| **Instagram messaging** | Implemented: same code path as Messenger (Meta's Send API is shared) | Same as Messenger | **Not tested** | Instagram Business account linked to the Page, same credential set |
| **WhatsApp Business** | Implemented: inbound normalizer (pre-existing) + real outbound Cloud API call, including a template-message code path, plus approval enforcement (this session) | Inbound: `omnichannel.e2e.mjs`. Outbound text + template: `section16-messaging.e2e.mjs` against stubbed `fetch` | **Not tested** | A WhatsApp Business Account, a registered phone number, `accessToken` + `phoneNumberId`, and at least one template actually approved by Meta (the local `providerStatus` field must be set to `'approved'` to match — this is a manual sync step, not automatic, since no Template Management API call was made) |
| **Email** | Implemented: per-channel-account SMTP send via nodemailer, reusing the existing per-tenant credential model | `section16-messaging.e2e.mjs` against a stubbed transport (`setEmailTransportFactory`) | **Not tested against a real mailbox** | A real SMTP account's host/port/username/password/from configured on an `email`-channel `ChannelAccount`. Note: this is separate from the platform's existing `mailer.js` (used for system notifications) and the `EmailSender`/`EmailTemplate` models (used elsewhere) — they were not merged in this session; see Outstanding Issues |

**No mocked integration is reported as live-tested anywhere above or in code comments.**

---

## E. Outstanding Issues

- **No "compose email from a Lead/Contact/Account" UI.** The channel/conversation architecture supports an `email` channel end-to-end (and was outbound-wired this session), but nothing creates an email *Conversation* from a record detail page — a user would have to already be in an email conversation thread in the Inbox. The Activity timeline's existing "log an email" button only records a manual note; it does not send anything.
- **Two separate email infrastructures now exist**: the pre-existing `EmailSender`/`mailer.js`/`EmailTemplate` system (used for deal conversion, welcome emails, etc.) and the new `ChannelAccount`(channel=email)/`MessageTemplate` system built on in this session. They were not unified — doing so safely was out of scope for a Section 16 task that must not touch unrelated systems, but it means a tenant could end up configuring SMTP credentials twice.
- **No Flow trigger/action nodes for messaging** (`automationService.js` has zero channel/conversation references). "New WhatsApp message received", "Send WhatsApp template", "Assign conversation" as Flow steps are **not implemented**. The Facebook Lead webhook *does* fire the existing record-created Flow trigger (reusing what already exists for Lead creation), which covers BRD's "triggering the appropriate Salesdam Flow when a lead is received" — but conversation-level Flow triggers/actions (§5 of the brief) are not built.
- **No Meta OAuth / page-and-form picker UI.** Channel accounts are configured by pasting raw credentials (access token, phone number ID, etc.) into a JSON field — there is no "Connect your Meta account" OAuth flow, no page list, no Lead Ad form picker. This requires a registered Meta App and its OAuth redirect/consent flow, which cannot be built or tested without one.
- **No live Meta/WhatsApp/SMTP credentials exist in this environment**, so none of the three provider integrations have been exercised against a real account — only against stubbed HTTP/SMTP in tests.
- **WhatsApp template approval is a manual local flag**, not synced from Meta's own Template Management API. An admin must manually set `providerStatus = 'approved'` after checking Meta's dashboard; there is no automatic reconciliation.
- **No delivery/read-receipt webhook UI surfacing** beyond the raw `Message.status`/`providerStatus` fields already shown in the Inbox — acceptable per BRD ("where available") but not polished.
- **No rate-limiting/retry-policy handling** for outbound Graph API calls — a failed send is recorded as `failed` and left for an agent to retry manually; there's no automatic backoff/retry queue.

---

## F. Final BRD Assessment (16.1–16.7)

| Requirement | Status | Why |
|---|---|---|
| **16.1 Facebook Lead Capture** | **PARTIALLY COMPLETE** | Webhook security, idempotency, field mapping (standard + custom), duplicate rules, assignment, and Flow triggering are implemented and tested. Campaign/ad/form attribution is captured and logged. **Not complete**: no OAuth/page-connection UI, no Lead Ad form picker, no live Meta verification (BLOCKED on credentials). |
| **16.2 Meta Inbox Integration** | **PARTIALLY COMPLETE** | Inbound Messenger/Instagram ingestion (pre-existing), outbound real Send API calls (this session), full Inbox UI to view/reply/assign — all implemented and tested with stubs. **BLOCKED**: never exercised against a real Page/app; delivery status webhooks for Messenger/Instagram are not separately wired beyond the generic status-event ingestion path. |
| **16.3 WhatsApp Business Integration** | **PARTIALLY COMPLETE** | Inbound ingestion, real Cloud API outbound text + template sends, approval enforcement, two-way conversation via the Inbox UI — implemented and tested with stubs. **BLOCKED**: no live WhatsApp Business Account; template approval sync is manual, not automatic; customer-service-window / messaging-rule enforcement beyond the approval gate is **NOT COMPLETE** (not implemented). |
| **16.4 Unified / Omnichannel Inbox** | **PARTIALLY COMPLETE** (core architecture is the strongest part of this delivery) | Single `Conversation`/`Message` model across WhatsApp/Messenger/Instagram/email/sms/telephony, assign/transfer/status/reopen/internal-notes/record-linking/create-record-from-conversation, consent-gated sends, duplicate-webhook protection, tenant isolation — all implemented, tested, and now have a working frontend. **Not complete**: no "create Lead/Contact directly from an unmatched conversation" shortcut beyond the generic create-record form (functionally present, not polished); no bulk/queue view for high-volume agents. |
| **16.5 Messaging Templates** | **PARTIALLY COMPLETE** | Full CRUD, merge-field resolution from real record data, channel-aware template library, WhatsApp-approval enforcement before send — implemented and tested. Templates are usable by agents (via the Inbox) and are reachable by Custom Code through the existing `messageTemplateService`/`inboxService` (no new unsafe execution path was added — the Section 15 `vm` sandbox escape was explicitly not used or relied on for this). **Not complete**: no Flow or Approval Process integration (§5 gap above) — "reusable by Flows/Approval Processes" is not yet true. |
| **16.6 Communication Consent Enforcement** | **COMPLETE for the paths this session touched** | `consentService.canContact` is the single shared gate; `inboxService.reply`/`replyWithTemplate` both call it before any provider dispatch, exactly as the pre-existing `consent.e2e.mjs` and `omnichannel.e2e.mjs` already verified for manual replies, and as this session's new template-send path also now goes through. **Caveat**: since Flow-triggered messaging doesn't exist yet (16.5/§5 gap), "the same rules apply to manual and Flow-triggered messages" is vacuously true but not meaningfully exercised — there is no Flow-triggered send to test. |
| **16.7 Email Communication Integration** | **NOT COMPLETE** | SMTP sending infrastructure now exists and is tested (through the channel/Inbox path), but there is no "compose email from a Lead/Contact/Account" UI, no inbound-email-to-conversation ingestion path exercised, and no merge/attachment/signature UI for email specifically. The pre-existing `EmailSender`/`EmailTemplate`/`mailer.js` system (used elsewhere in the app, e.g. deal conversion) was not touched or unified with this work. |

**No requirement is marked COMPLETE as fully production-ready with live verification.** 16.6 is marked complete only for the specific code paths this session exercised, not as a blanket claim about every automation surface the BRD imagines.

---

## G. Manual Testing Guide

### Can be tested locally right now (no external credentials needed)

**Prereqs**: backend on :5002, frontend on :5173, logged in as an admin (or a role with `canManageCommunicationTemplates`).

1. **Connect a channel**: go to `http://localhost:5173/admin/channels`. Pick channel `whatsapp`, provider "Meta WhatsApp Cloud API", give it a name and a webhook secret, leave credentials as `{}`, click Create. Confirm the row appears with a webhook URL like `http://localhost:5002/api/v1/channels/webhook/whatsapp/<id>`.

2. **Create a template**: go to `http://localhost:5173/admin/message-templates`. Channel `whatsapp`, body `Hi {{first_name}}, welcome!`. Click Create, then type `{"first_name":"Jane"}` in the preview box and click Preview — confirm it resolves to `Hi Jane, welcome!`.

3. **Simulate an inbound message** (from a terminal, using the webhook secret from step 1):
   ```bash
   node -e "
   const crypto = require('crypto');
   const accountId = '<id from step 1>';
   const secret = '<webhook secret from step 1>';
   const payload = JSON.stringify({ kind: 'message', from: { identifier: '27821234567', name: 'Test Contact' }, body: 'Hi there', externalMessageId: 'manual-test-1' });
   const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
   fetch('http://localhost:5002/api/v1/channels/webhook/whatsapp/' + accountId, {
     method: 'POST', headers: { 'Content-Type': 'application/json', 'x-salesdam-signature': sig }, body: payload,
   }).then(async r => console.log(r.status, await r.text()));
   "
   ```
   Confirm `202` and a response body with a `conversation` object.

4. **Open the Inbox**: `http://localhost:5173/inbox`. The "Test Contact" conversation should appear. Click it, confirm the message shows, click Accept (assigns to you), type a reply and Send — it will show status `queued` with "Channel account has no provider credentials" (correct, since no real credentials were given). Add an internal note and confirm it's badged "INTERNAL NOTE". Click Close, try to reply (should be rejected), click Reopen.

5. **Facebook Lead Ads webhook — local test**: create a `facebook` channel account with provider `meta_leadgen` and a webhook secret. Then POST a signed payload matching Meta's real envelope shape (see `backend/tests/section16-messaging.e2e.mjs`'s `leadgenPayload` helper for the exact structure, including `field_data` directly in the payload — this bypasses the Graph API call and works with no real Meta credentials). Confirm a Lead record is created, and that resending the same payload does not duplicate it.

6. **Template approval gate**: set the WhatsApp template's Provider Status to anything other than `approved` in `/admin/message-templates`, then try "Send Template" on a WhatsApp conversation in the Inbox — confirm it's rejected. Set it to `approved` and retry — confirm it's accepted (still `queued`, since there's no real WhatsApp credential, but accepted past the approval gate).

### Requires real Meta/WhatsApp/SMTP credentials — cannot be verified in this environment

7. **Live Facebook Lead Ads**: register a Meta App, add the Lead Ads product, connect a real Facebook Page, create a test Lead Ad form, subscribe the Page's webhook to `leadgen` events at `https://<your-public-host>/api/v1/integrations/facebook/leadgen/<accountId>` with verify token = the account's `webhookSecret`, and submit a test lead through Meta's Lead Ads Testing Tool. Set the `ChannelAccount.credentials.pageAccessToken` to a real Page access token so the Graph API field-data fetch succeeds (real deliveries omit `field_data`, unlike the local test payload above).

8. **Live WhatsApp send**: configure a WhatsApp Business Account + phone number in Meta's dashboard, set `credentials.accessToken`/`credentials.phoneNumberId` on a `whatsapp` channel account to the real values, then send a reply or an approved template from the Inbox — confirm the message actually arrives on a real WhatsApp number, and that `Message.status` updates to `sent`/`delivered` based on the real Graph API response.

9. **Live Messenger/Instagram send**: same pattern with `pageAccessToken` for a real connected Page/Instagram Business account.

10. **Live email send**: set real SMTP `host`/`port`/`username`/`password`/`from` on an `email` channel account and send a reply through the Inbox — confirm an actual email arrives.
