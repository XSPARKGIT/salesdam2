# BRD Section 16 — Finalisation Pass Report

Scope of this pass (per the brief): Flow-triggered messaging and email, email send/receive with record association, centralised consent enforcement across every outbound path, WhatsApp template-approval enforcement, and precise documentation of Instagram support. Nothing from the prior session's completed work (Omnichannel Inbox, Channel Accounts, Message Templates, Facebook Lead webhook security) was rebuilt — it was inspected, confirmed still passing (42+19+14+32 = 107 pre-existing checks), and built on.

**⚠️ Git note (read first):** `git log`/`git status` at the end of this pass show my changes already committed under `HEAD`, inside commits labeled `feat(section17): ...` — I never ran `git commit` in this session. My files are verifiably present and correct in the current working tree and `HEAD` (checked directly, not assumed). This looks like either this environment's own auto-commit/snapshot behavior, or a **separate, concurrent session already working on Section 17 in this same checkout**, whose commit happened to include my uncommitted work. I have not touched git history myself. Please check this before treating "Section 17" as either started-by-me or safely untouched.

---

## 1. Requirement-by-requirement status

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | Flow-triggered messaging | **COMPLETE** for email and message-template (WhatsApp/Messenger/Instagram/SMS) sends; conversation-level Flow triggers (e.g. "new message received" as a Flow trigger event) remain **NOT IMPLEMENTED** — out of this pass's explicit focus list | `action_send_email` rewritten, new `action_send_message_template` node added, both routed through the shared send core; `section16-finalisation.e2e.mjs` proves both fire, merge-render, and respect consent/approval gates |
| 2 | Email send/receive + record association | **COMPLETE** for send (new `POST /records/:objectApiName/:id/send-email`, Activity-logged, Conversation-linked); **PARTIALLY COMPLETE** for receive — inbound email ingestion reuses the exact same generic channel-webhook path already proven for WhatsApp/Messenger (channel='email', `findMatchingRecord` with `kind:'email'`), but this pass did not stand up a real IMAP/SMTP-webhook-triggered inbound test, only confirmed the ingestion code path is channel-agnostic and therefore already applies | `section16-finalisation.e2e.mjs`'s direct-send and template-send checks; `channelService.ingestMessage`'s `inferKind('email') === 'email'` (pre-existing, unchanged) |
| 3 | Centralised consent enforcement, no bypass | **COMPLETE** for every path this pass touched: manual Inbox reply (pre-existing, re-verified), manual send-from-record, Flow-triggered email, Flow-triggered template send. **Found and fixed a real bypass**: the pre-existing Flow "Send Email" action called nodemailer directly with zero consent check | 4 explicit consent-gate checks in `section16-finalisation.e2e.mjs`, including one that updates a *record* and confirms the record save succeeds while the blocked flow-email is silently skipped (not surfaced as a record-save failure) and leaves no Activity trail |
| 4 | WhatsApp template-approval enforcement | **COMPLETE** for every send path, including the new Flow path | `_sendTemplateCore` is the single approval gate shared by manual reply-with-template, direct send-to-record, and Flow send; test proves a Flow send is blocked pre-approval and succeeds post-approval, with the same error message shape as the manual path |
| 5 | Instagram support — exact level | **Documented, no gap found requiring new code** | See §4 below |

---

## 2. Files and services changed in this pass

**Backend**
- `backend/services/inboxService.js` — added `sendEmailToRecord`, `sendTemplateToRecord`, `_findOrCreateConversationForRecord`, `_sendTemplateCore` (extracted from `replyWithTemplate` so the approval gate is shared, not duplicated), `_renderEmailTemplate`; `_sendAndRecord`'s sender name now falls back to `"Automation"` for system-triggered sends
- `backend/services/automationService.js` — `executeEmail` rewritten to route through `inboxService.sendEmailToRecord` instead of a standalone nodemailer+EmailSender call with no consent check; new `executeSendMessageTemplate` + `action_send_message_template` node case
- `backend/models/Automation.js` — added `action_send_message_template` to the node-type enum
- `backend/routes/records.js` — new `POST /:objectApiName/:id/send-email`

**Frontend**
- `frontend/src/pages/Automation/FlowBuilder.jsx` — new `MessageTemplateConfig` component + palette entry + summary line for `action_send_message_template`
- `frontend/src/pages/Automation/FlowDebugPanel.jsx` — node-type label/color entry for the same

**Tests**
- `backend/tests/section16-finalisation.e2e.mjs` — new, 26 checks

**Not modified** (inspected and confirmed correct, left alone): `ChannelAccount`/`Conversation`/`Message`/`MessageTemplate` models, `channelService.js`, `channelProviders.js`, `inboxController.js`, `channelController.js`, all prior-session frontend pages (`Inbox.jsx`, `ChannelAccounts.jsx`, `MessageTemplates.jsx`), `consentService.js`.

---

## 3. Testing — exact results

### Targeted (this pass's new code)
```
backend/tests/section16-finalisation.e2e.mjs   26/26 passed
```
Covers: direct send-from-record (success, missing-fields 400, EmailTemplate merge, consent block/unblock), Flow-triggered email (success + Activity record + merge rendering, consent-blocked on an update-triggered flow with no Activity leaked), Flow-triggered WhatsApp template (blocked pre-approval, sent post-approval, linked to the triggering record), Instagram provider catalog shape.

### Regression — full suite rerun after all fixes, nothing skipped or weakened
```
backend/tests/section16-messaging.e2e.mjs     32/32 passed
backend/tests/omnichannel.e2e.mjs             42/42 passed
backend/tests/consent.e2e.mjs                 19/19 passed
backend/tests/conversation-capture.e2e.mjs    14/14 passed
backend/tests/flow-definition.e2e.mjs         25/25 passed
backend/tests/activity.e2e.mjs                17/17 passed
backend/tests/system-permissions.e2e.mjs      42/42 passed
backend/tests/tenant-isolation.e2e.mjs        23/23 passed
backend/tests/approval-process.e2e.mjs        43/43 passed   (exercises runAutomation, the other Flow entry point)
```
**283 checks total, 283 passed.**

### Production build
```
npm run build   ✓ built in ~6s, no errors (pre-existing chunk-size/@extend warnings only)
```

### Browser-tested workflows and outcomes
Done in the Claude Browser pane against the real running dev servers:
- Opened `/automation/new`, created a Record-Triggered flow on Lead, clicked "Add Step," confirmed **"Send Message Template"** appears in the palette
- Added the node; its config form rendered Channel/Template/To fields; confirmed via the network panel that it issued a real `GET /api/v1/message-templates?channel=whatsapp&isActive=true` request (200 OK) — not a hardcoded list
- Filled the recipient field, clicked Save, confirmed the URL changed to a real automation id and `GET /api/v1/automations/:id` returned the node with `type: "action_send_message_template"` and the entered config persisted correctly
- Cleaned up the test automation afterward via the API

Two-browser-session consent/approval-gate UI flows were **not** separately re-verified by hand — the same assertions are already covered, with exact pass/fail evidence, by the automated suite above; re-doing them by hand through the UI would add nothing beyond what the tests already prove.

### Failure cases explicitly tested
- Missing SMTP/channel credentials → "queued, not_configured" (pre-existing behavior, unaffected)
- Missing subject/body with no template → `400`
- Unapproved WhatsApp template, both via manual reply and via Flow → `409`, record unaffected, no message sent
- Consent withdrawn, both via manual send and via Flow (including an update-triggered flow where the record's own save must still succeed) → blocked, no Activity leaked
- Invalid/duplicate webhook signatures — covered by the untouched, still-passing `omnichannel.e2e.mjs`/`section16-messaging.e2e.mjs`
- Provider errors (bad OAuth token from a real, unmocked call made accidentally during test iteration) — confirmed the code correctly records `status:'failed'` rather than crashing or falsely reporting success; this was fixed in the test (added a fetch stub), not in the product code, since the product code already handled it correctly

---

## 4. Instagram support — precise, as requested

Instagram shares Meta's **Messenger Send API and webhook contract exactly** — this is Meta's own architecture, not a Salesdam simplification. Confirmed by reading `channelProviders.js` and exercising it:

- **Inbound**: `_metaMessengerInbound` is the single normalizer for both `provider: 'meta_messenger'` (channel `facebook`) and `provider: 'meta_instagram'` (channel `instagram`) — it accepts `body.object` of either `'page'` or `'instagram'` and extracts messages identically.
- **Outbound**: `_sendMeta` (the same function used for Messenger) is the WhatsApp/Messenger/Instagram... no — specifically the Messenger/Instagram sender, dispatched for both the `facebook` and `instagram` channels via the `LIVE_SENDERS` map.
- **Credentials**: `meta_instagram`'s provider definition requires exactly `['pageAccessToken', 'appSecret']` — the same two credentials as Messenger, confirmed identical via `section16-finalisation.e2e.mjs`'s new Instagram-specific checks.
- **What is NOT implemented, and not claimed**: no Instagram-specific capabilities beyond what Messenger gets — no Instagram Story mentions/replies, no Instagram-specific media message types, no 24-hour-window or human-agent-tag handling that Meta's Instagram Messaging API imposes beyond what Messenger already requires. No Instagram Business Account linking/OAuth UI exists (same gap as Facebook Messenger — there is no "connect your Page" OAuth flow for any Meta channel; credentials are pasted in manually).
- **Live verification**: none. No Instagram Business account or Meta app exists in this environment — mock-tested only (same stub-based `fetch` tests as Messenger, since they share code).

**Precise summary for the record**: Instagram is a real, implemented channel — not a stub that merely accepts the word "instagram" — but it has no capability Messenger lacks, and everything about it is provider-dependent on the same Meta Page/App setup Messenger needs.

---

## 5. Mock-tested vs. live-provider-tested (this pass)

| Path | Mock-tested | Live-tested |
|---|---|---|
| Flow-triggered email (SMTP) | Yes — stubbed transport via `setEmailTransportFactory` | No |
| Direct send-email-from-record (SMTP) | Yes — same stub | No |
| Flow-triggered WhatsApp template send | Yes — stubbed `fetch` to `graph.facebook.com` | No |
| Consent gate (no external provider involved) | N/A — real code path, real DB | **Yes** — this is fully internal, no mock needed |
| WhatsApp approval gate (no external provider involved) | N/A — real code path, real DB | **Yes** — fully internal |
| Instagram inbound/outbound | Shares Messenger's mock coverage | No |

No live Meta, WhatsApp, Instagram, or SMTP credentials exist in this environment. Nothing above is reported as live-tested beyond what is explicitly marked "Yes" (the two internal gates, which need no external provider to verify).

---

## 6. Remaining blockers and risks

- **Git state anomaly** (see the warning at the top) — needs your attention, not mine, before proceeding to any further section.
- No real Meta App / WhatsApp Business Account / SMTP mailbox exists to verify live delivery for any channel.
- Conversation-level Flow triggers ("new WhatsApp message received," "conversation assigned," "conversation status changed") are still not implemented — explicitly out of this pass's 5-item focus list, but worth flagging as the next real gap if Flow coverage needs to go further.
- Inbound email-to-record association is architecturally proven (shared code path, same as WhatsApp) but has no dedicated test exercising a real inbound-email webhook payload shape in this pass.
- The Flow email/template nodes use `user: null` (system-triggered) for the Activity/Message's `senderName`, which now shows `"Automation"` — reasonable, but there's no per-flow "sent as" identity distinct from a generic label.

---

## 7. Manual testing guide

**Prereqs**: backend :5002, frontend :5173, admin login.

### A. Direct email send from a record (no Flow involved)
1. Create an `email` channel account at `/admin/channels` (any SMTP values — they won't be reached unless real).
2. From a terminal: `curl -X POST http://localhost:5002/api/v1/records/lead/<leadId>/send-email -H "Content-Type: application/json" -b "<your session cookie>" -d '{"to":"test@example.com","subject":"Hi {first_name}","body":"Hello {first_name}"}'`
3. Confirm the lead's Activity timeline (on its record detail page) shows a new "Email" entry with the merged text.

### B. Flow-triggered email with consent enforcement
1. In Flow Builder, create a Record-Triggered flow on Lead, trigger "Record Created," add a **Send Email** node with `To: {email}`, a subject and body.
2. Enable consent enforcement for the tenant (`TenantConfiguration` key `consent.enforcement = true`, or via the Consents admin page if one is wired).
3. Create a Lead with an email address — confirm an Activity "Email" entry appears.
4. Use `POST /api/v1/consents/check` or the consents UI to opt that Lead's `email` channel out, then update the Lead (to refire an update-triggered flow, or create a second Lead) — confirm no new email Activity appears and the record save itself still succeeds.

### C. Flow-triggered WhatsApp template with approval gate
1. Create a `whatsapp` channel account.
2. Create a Message Template (channel `whatsapp`) at `/admin/message-templates` — leave Provider Status unset.
3. In Flow Builder, add a **Send Message Template** node (Channel: whatsapp, Template: the one you made, To: `{phone}`).
4. Create a Lead with a phone number — confirm no WhatsApp message appears (blocked, unapproved).
5. Set the template's Provider Status to `approved`, create another Lead — confirm a WhatsApp Message now exists (status will be `failed`/`queued` without real credentials, but it will exist and be linked to the Lead).

### D. Requires live credentials — not verified here
Actually delivering a real email/WhatsApp message requires real SMTP credentials on an `email` channel account, or a real Meta WhatsApp Business Account's `accessToken`/`phoneNumberId` on a `whatsapp` channel account, respectively — same requirement as documented in the prior `SECTION16_REPORT.md`.
