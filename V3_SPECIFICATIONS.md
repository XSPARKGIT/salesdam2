# Salesdam V3.0 — Platform & Feature Specifications

| Field | Value |
|---|---|
| Document | Salesdam V3.0 Platform & Feature Specifications |
| Version | 1.0 |
| Date | 2026-10-16 |
| Repository | `github.com/SaphoM/Salesdam-v3` |
| Branch / commit | `master` @ `8bc6696` |
| Packages audited | `backend/`, `frontend/`, `admin/`, `landing/`, `docs/`, `deploy/` |
| Source requirements | Salesdam V3 Platform Core BRD V2.1 (10 Oct 2026); Insurance BRD v1.0; Salesdam API & Integration Guide v1.0 (14 Oct 2026) |
| Audience | Engineering, QA, product, operations, client reviewers |

This document is a specification of what exists in the repository today. It is
derived from the code, the commit history, and the test suites — not from
marketing status. Where a capability is declared but cannot be verified without
external input (upstream credentials, contracts, or the Insurance ERD), it is
marked **UNVERIFIED** or **BLOCKED** rather than implied as working.

---

## 1. Purpose & scope

Salesdam is a multi-tenant, metadata-driven CRM platform. "V3.0" is the
monorepo at commit `8bc6696`, consisting of:

1. a core CRM backend and API (`backend/`),
2. the CRM single-page application (`frontend/`),
3. the platform administration console (`admin/`),
4. a marketing site (`landing/`) and product documentation site (`docs/`),
5. an insurance workspace layer implemented on top of the same core,
6. deployment assets (`deploy/`, `docker-compose.platform.yml`, workflows).

This document specifies:

- the system architecture and its controls,
- the complete API surface,
- every new Core-BRD platform capability delivered in the most recent build
  cycle (§14, §8, §3.4, §23, §24, §13, §16, §18),
- the insurance workspace,
- security posture, testing, deployment, and
- the honest list of what remains outstanding.

---

## 2. System architecture

### 2.1 Components

| App | Stack | Role |
|---|---|---|
| `backend/` | Node.js ESM + Express 4 + Mongoose 8 + MongoDB 7 + Redis (ioredis) | All business logic, REST API under `/api/v1` |
| `frontend/` | React 18 + Vite + React Query + React Router | Primary CRM SPA |
| `admin/` | React 18 + Vite | Platform administration console (tenants, users, incidents, audit) |
| `landing/` | Astro | Marketing site |
| `docs/` | Astro | Product documentation site |
| `deploy/` | systemd units, installer, nginx config | Production operations |

The backend follows a layered layout — `routes/` → `controllers/` →
`services/` → `models/` — with cross-cutting `middleware/` and `utils/`.

### 2.2 Backend module inventory (commit `8bc6696`)

| Layer | Count | Notes |
|---|---|---|
| Models | 44 | Mongoose schemas (see §5) |
| Route files | 50 | mounted under `/api/v1` |
| Controllers | 35 | request handling |
| Services | 42 (+19 in `services/insurance/`) | business logic |
| Middleware | 7 | auth, tenant, permissions, error, upload, rate limit, session |
| Utils | 5 | audit logger, errors, logger, validator, transaction helper |

### 2.3 Cross-cutting controls

- **Multi-tenancy**: every request carries a tenant context; `enforceTenant`
  middleware scopes queries by `req.tenantId`. Cross-tenant reads are only
  possible through superuser-scoped routes.
- **Session**: `sessionMiddleware` issues a signed `crm.sid` cookie; tests use
  this cookie directly.
- **Error handling**: `asyncHandler` + `AppError` + a single `errorHandler`
  returns a consistent `{ success, message, … }` envelope.
- **Rate limiting**: a global `/api` limiter plus a stricter login-burst limiter.
- **Audit**: `utils/auditLogger.js` writes mutations to the `AuditLog`
  collection.

### 2.4 Request pipeline (`backend/app.js`)

```
helmet → cors → compression → json/urlencoded → mongoSanitize
→ morgan (non-test) → sessionMiddleware
→ rate limiter (/api)
→ versioned routers (/api/v1/*)
→ 404 handler → errorHandler
```

The Paystack webhook is mounted before the rate limiter because it must be
public and unsigned by session; its authenticity is the HMAC signature.

---

## 3. Technology & versions

| Concern | Value |
|---|---|
| Runtime | Node.js 22 (CI) |
| Database | MongoDB 7 (replica set `rs0` for transactions) |
| Cache | Redis via `ioredis` |
| Backend key deps | express, mongoose, bcryptjs, joi, multer, nodemailer, openai, xlsx, docx, winston, uuid, axios |
| Frontend key deps | react, react-router-dom, @tanstack/react-query, axios, recharts, jspdf, xlsx, lucide-react, react-hot-toast |
| CI | GitHub Actions, Node 22, Mongo 7 service (`quality.yml`) |

---

## 4. Authentication & authorization

### 4.1 Authentication

- Session cookie (`crm.sid`) via `sessionMiddleware`.
- Passwords hashed with bcrypt; account lockout on repeated failures.
- Password reset tokens stored as **SHA-256 hashes**; only the raw token is
  emailed; links are single-use and expire in 2 hours. Reset-email failures do
  not change the response shape (no username enumeration).
- API keys: derived from environment state, stored as hashes, presented as
  `X-API-Key`, with object-scope controls.
- Insurance API on `/api/v1/insurance` authenticates by session **or** API key.

### 4.2 Authorization model

- Object-, app-, and field-level permissions.
- Admin and superuser bypass.
- `checkObjectPermission(action)` route middleware, backed by the exported
  `hasObjectPermission(user, action, objectApiName)` helper (shared by services).
- Field-level editing is enforced by `getEditableFields`, so platform fields
  (e.g. `name`) are read-only for non-admins.
- Roles are tenant-scoped; superuser role is marked non-editable.

---

## 5. Platform data model

44 Mongoose models in `backend/models/`:

| Group | Models |
|---|---|
| Tenancy & identity | Tenant, User, Role, Session, RegistrationToken, ApiKey, ApiKeyUsageLog, RecentlyViewed |
| Metadata | ObjectMeta, FieldMeta, Layout, ListView, CustomScreen, ObjectTypeConfig |
| Records | DynamicRecord, AutoNumberCounter |
| Approvals | ApprovalProcess, ApprovalRequest |
| Duplicates & merge | DuplicateRule |
| Consent | Consent |
| Activity & audit | Activity, AuditLog, Notification |
| Change management | ChangeSet, DeploymentLog |
| Channels & messaging | ChannelAccount, Conversation, Message, MessageTemplate |
| Telephony | AgentPresence |
| Config | TenantConfiguration |
| Automation | Automation |
| Files | File |
| Analytics | Dashboard, DashboardFolder |
| Communication | EmailTemplate, EmailSender, PdfTemplate |
| Integrations & automation | Integration, Webhook, ExternalObject |
| Governance | Incident, IncidentComment |
| Workspaces & work | Workspace, Incident |

> `DynamicRecord.data` is a `Map`; system fields are exposed through
> `toDataObject()`. Inbound `lookup`/`master_detail` references are what the
> merge operation repoints.

---

## 6. API surface

All routes are under `/api/v1` (plus the public `/api/paystack-webhook`).

### 6.1 Core platform route groups

`/auth`, `/users`, `/roles`, `/objects`, `/fields`, `/records`, `/list-views`,
`/action-buttons`, `/layouts`, `/automations`, `/analytics`, `/search`,
`/webhooks`, `/admin`, `/ai`, `/notifications`, `/dashboards`,
`/dashboard-folders`, `/external-objects`, `/custom-screens`,
`/email-templates`, `/api-keys`, `/object-config`, `/email-senders`,
`/workspaces`, `/pdf-templates`, `/files`, `/superadmin`, `/registration`,
`/billing`, `/subscription`, `/incidents`, `/integrations`,
`/recurring-tasks`, `/tenders`, `/leads`, `/documents`, `/insurance`.

### 6.2 Records API (`/records`)

| Method | Path | Permission |
|---|---|---|
| POST | `/validate` | — |
| POST | `/validate-formula` | — |
| GET | `/:objectApiName/export` | `export` |
| POST | `/:objectApiName/import` | `import` |
| GET | `/:objectApiName` | `read` |
| GET | `/:objectApiName/:id` | `read` |
| POST | `/:objectApiName` | `create` |
| PUT / PATCH | `/:objectApiName/:id` | `update` |
| DELETE | `/:objectApiName/:id` | `delete` |
| POST | `/:objectApiName/bulk-delete` | `delete` |
| POST | `/:objectApiName/merge` | `delete` |

---

## 7. Core-BRD platform capabilities (delivered)

Each capability below is a new, versioned, tenant-scoped surface with an
end-to-end suite. "Evidence" is the number of assertions in the suite at
commit `8bc6696`.

### 7.1 Platform configuration resolution — Core BRD §14

- **Purpose**: platform-wide key/value settings with per-tenant overrides.
- **Collection**: `TenantConfiguration`.
- **Routes**: `GET /configuration` (resolved map), `PUT|DELETE /configuration/:key`
  (tenant override), `GET /configuration/defaults`,
  `PUT|DELETE /configuration/defaults/:key` (admin default).
- **Behaviour**: a tenant override wins over the platform default; resolution is
  centralized in `configurationService`.
- **Evidence**: `configuration.e2e.mjs` — 18/18.

### 7.2 Approval-process builder — Core BRD §8

- **Purpose**: configurable, multi-step approval workflows that lock records
  while a decision is pending.
- **Collections**: `ApprovalProcess`, `ApprovalRequest`.
- **Routes**:
  - definition: `GET /approval-processes`, `POST /approval-processes`,
    `GET|PUT|DELETE /approval-processes/:id`
  - runtime: `POST /approval-processes/submit`, `GET /approval-processes/state`,
    `GET /approval-processes/pending/mine`,
    `POST /approval-processes/:id/approve|reject|recall`.
- **Behaviour**:
  - only the **active** step carries an approver, and `pending/mine` matches
    only the pending step, so neither future nor past approvers see a request;
  - `GET /approval-processes/state` returns the latest request with people
    resolved to names, plus `meta` (`canDecide`, `canRecall`, `canSubmit`,
    `eligibleProcesses`) for the current user;
  - each stage (`onSubmit`, `onApprove`, `onReject`) can launch a Flow
    (`actions.<stage>.flowId`) with the variables `approvalOutcome`,
    `approvalComment`, `approvalProcessName` and `approvalRequestId`; a failing
    flow is logged in its run stats and never undoes the decision;
  - an underlying record is locked while a request is pending — updates/deletes
    return **HTTP 423**;
  - approval/rejection/recall are recorded against the step.
- **UI**: Setup › Approval Processes (`/setup/approval-processes`, admins) to
  build processes — entry criteria, ordered steps (named user, submitter's
  manager, user field on the record, or role queue), and per-stage field
  updates, record lock and flow; an approval panel on every record page
  (submit, approve/reject with comment — a reason is required to reject —
  recall, step tracker and history); and **My Approvals** (`/approvals`, all
  users) with a pending-count badge in the sidebar.
- **Evidence**: `approval-process.e2e.mjs` — 43/43.

### 7.3 Duplicate detection & merge — Core BRD §3.4

**Detection**

- **Collection**: `DuplicateRule`.
- **Routes**: `POST /duplicate-rules/check`, and CRUD on `/duplicate-rules`.
- **UI**: Setup › Duplicate Rules (`/setup/duplicate-rules`, admins) to create,
  edit, activate/deactivate and delete rules — object, match fields
  (ignore-case-and-spacing or exact), all/any logic, and warn or block. The
  record form checks these rules before saving and lists the matches.
- **Behaviour**: on record create/update a rule either `block`s
  (**409 + `duplicates`**) or `warn`s (write succeeds and the response carries
  `duplicateMatches`). No rules → `allow`.

**Merge**

- **Route**: `POST /records/:objectApiName/merge`, gated by `delete` permission.
- **Collection changes**: `DynamicRecord.mergedIntoId`, `DynamicRecord.mergeHistory`.
- **Behaviour**:
  - a survivor fills blank fields from duplicates (first value wins), then
    applies explicit `fieldValues` overrides;
  - blank survivor fields are filled; non-blank values are kept;
  - computed fields (`formula`, `rollup_summary`, `auto_number`) are
    **recomputed**, not copied;
  - inbound lookups across objects are repointed to the survivor, and
    activities on a duplicate (as primary or related record) move to the
    survivor's timeline; both are reported in `repointedReferences`;
  - duplicates are **soft-deleted** (`isDeleted`) and stamped `mergedIntoId`;
  - the survivor gains an append-only `mergeHistory`;
  - audit action `'merge'` is written;
  - if the merged result fails validation the request is rejected and the
    duplicates are **restored** — a rejected merge changes nothing.
- **UI**: select 2–3 records in a list and choose **Merge**, or choose
  **Merge instead** in the duplicate dialog while editing a record. The merge
  screen (`/o/:objectApiName/merge?ids=…`) shows the records side by side:
  pick the record to keep, then the value to keep per field (only differing
  fields by default; fields the user can't edit stay on the kept record's
  value), confirm, and land on the kept record.
- **Evidence**: `duplicate-detection.e2e.mjs` 21/21; `record-merge.e2e.mjs` 23/23.

### 7.4 Communication consent & preferences — Core BRD §23

- **Collection**: `Consent`.
- **Routes**: `POST /consents/check`, `GET /consents`,
  `GET|PUT /consents/:subjectType/:subjectId`.
- **Behaviour**: `canContact` is evaluated per subject/channel; when
  `consent.enforcement` is enabled (via configuration), outbound omnichannel
  replies are gated by consent.
- **Scope note**: consent is **not yet wired into insurance dispatch** — that
  requires the Insurance ERD/data model.
- **Evidence**: `consent.e2e.mjs` — 19/19.

### 7.5 Activity & interaction timeline — Core BRD §24

- **Collection**: `Activity`.
- **Routes**: `GET /activities/types`, `GET /activities/timeline`,
  `POST /activities/log`, plus CRUD.
- **Behaviour**: a per-record, chronologically ordered timeline of interactions
  (calls, emails, messages, notes, system events), used by the record detail
  view.
- **Evidence**: `activity.e2e.mjs` — 17/17.

### 7.6 Metadata deployment, change sets, sandbox & rollback — Core BRD §13

- **Collections**: `ChangeSet`, `DeploymentLog`.
- **Routes**:
  - packaging (admin, own tenant): `GET /change-sets`, `POST /change-sets`,
    `GET /change-sets/:id`
  - cross-tenant (superuser): `POST /change-sets/:id/validate`,
    `POST /change-sets/:id/deploy`, `GET /change-sets/deployment-log`,
    `POST /change-sets/deployment-log/:logId/rollback`,
    `POST /change-sets/sandbox`.
- **Behaviour**:
  - a change set packages metadata (objects, fields, layouts, flows, approvals,
    duplicate rules, config overrides);
  - deployment is **blocked** until required objects/fields exist in the target
    tenant; a `DeploymentLog` is recorded either way;
  - **rollback** restores each component to its pre-deployment state (recreate
    the prior snapshot, or delete if it did not exist), allowed once per
    deployment; duplicate rollback returns **409**;
  - **sandbox clone** copies one tenant's configuration into a new isolated
    tenant with `isSandbox: true` + `clonedFromTenantId`, **no business data**;
    role references are remapped by role name.
- **Evidence**: `change-set.e2e.mjs` — 47/47.

### 7.7 Omnichannel inbox — Core BRD §16

- **Collections**: `ChannelAccount`, `Conversation`, `Message`, `MessageTemplate`.
- **Routes**:
  - channels: `GET /channels`, `POST /channels`, `GET|PUT|DELETE /channels/:id`,
    `POST /channels/:id/validate`, `GET /channels/capabilities`,
    `GET /channels/providers`,
    `POST /channels/webhook/:channel/:accountId`
  - conversations: `GET /conversations`, `GET /conversations/:id`,
    `GET /conversations/:id/messages`, `POST /conversations/:id/assign|status|link|reply|notes|create-record`
  - templates: `GET /message-templates`, `GET /message-templates/:id`,
    `POST /message-templates/:id/preview`, `POST /message-templates`,
    `PUT|DELETE /message-templates/:id`.
- **Behaviour**:
  - webhooks authenticate by **timing-safe HMAC-SHA256 over the raw request
    bytes**; an account without a signing secret accepts nothing;
  - Meta WhatsApp Cloud API and Messenger/Instagram payloads are normalized
    server-side into canonical events (batched, resilient per event);
    unrecognized bodies fall through to the canonical shape;
  - provider credentials and webhook secrets are `select:false` and stripped
    from JSON;
  - **outbound replies are never faked**: they are stored `queued` with an
    explicit `providerStatus` until a provider is wired.
- **Evidence**: `omnichannel.e2e.mjs` — 42/42.

### 7.8 Call centre / telephony — Core BRD §18

- **Collection**: `AgentPresence` (plus call activities).
- **Routes**: `GET|PUT /telephony/status/me`, `GET /telephony/status`,
  `GET /telephony/dispositions`, `GET /telephony/providers`,
  `POST /telephony/calls`, `GET /telephony/calls`,
  `POST /telephony/calls/:activityId/wrap-up`.
- **Behaviour**: agent presence, disposition and wrap-up logging are live;
  call-control verbs (`dial/hangup/transfer/hold`) **decline with HTTP 501**
  until a telephony provider contract is wired — a declared seam, not a hidden
  failure.
- **Evidence**: `telephony.e2e.mjs` — 16/16.

### 7.9 Create a record from a conversation — Core BRD §16.4

- **Route**: `POST /conversations/:id/create-record`.
- **Behaviour**:
  - target object resolution order: request body `objectApiName` →
    `ChannelAccount.createObjectApiName` → first `matchRules[].objectApiName`;
  - the matched identifier is prefilled, plus `contactName` (caller `data` wins);
  - the existing duplicate rule gate applies (`block` → **409 + `duplicates`**);
  - record validation and object rules run;
  - the conversation is linked to the created record;
  - an already-linked conversation returns **409**;
  - creating fires `create` automations.
- **Permission**: `hasObjectPermission(user, 'create', objectApiName)`.
- **Evidence**: `conversation-capture.e2e.mjs` — 14/14.

### 7.10 Provider readiness (no live vendor calls)

| BRD | Capability | Surface |
|---|---|---|
| §13 | Sandbox tenant cloning (config only) | `POST /change-sets/sandbox` |
| §13 | Deployment rollback | `POST /change-sets/deployment-log/:logId/rollback` |
| §16.1 | Provider catalog (required credentials, normalizer support) | `GET /channels/providers` |
| §16.1 | Provider config validation (reports missing credentials) | `POST /channels/:id/validate` |
| §16.1 | Inbound normalization (WhatsApp / Messenger / Instagram) | `POST /channels/webhook/whatsapp\|facebook\|instagram/:accountId` |
| §18.5 | Telephony provider catalog + call-control seam (501) | `GET /telephony/providers`, `POST /telephony/calls` |

---

## 8. Insurance workspace

The insurance workspace is a **domain layer on the same core platform**, not a
separate stack. It is served under `/api/v1/insurance` and uses core records,
permissions, automations and notifications.

### 8.1 Metadata objects (20)

| Object | Purpose |
|---|---|
| `product_version` | Effective-dated product rules |
| `benefit_cover` | Rate categories, premiums, age bands |
| `child_benefit_rule` | Age-banded child cover % |
| `policy` | Core policy lifecycle |
| `policy_party` | Roles on a policy (payer, member, beneficiary) |
| `insured_life` | Covered lives with effective dates |
| `policy_acceptance` | Channel-specific acceptance evidence |
| `policy_status_history` | Lifecycle transitions |
| `policy_premium_history` | Effective-dated premium changes |
| `policy_endorsement` | Formal amendments |
| `policy_endorsement_item` | Field-level prior/new values |
| `policy_approval` | Underwriting sign-off |
| `policy_communication` | Notification log |
| `communication_template` | Multi-channel templates |
| `premium_transaction` | Financial ledger (debits/credits) |
| `claim` | Claim lifecycle |
| `claim_requirement` | Evidence checklist |
| `claim_payment` | Payout ledger |
| `claim_status_history` | Claim transitions |
| `endorsement_approval_workflow` | Multi-stage approval chains |

### 8.2 Services

`applicationService`, `approvalService`, `autoLapseService`, `billingEngine`,
`billingRunService`, `claimService`, `communicationDispatcher`,
`communicationService`, `communicationTemplates`, `communicationTriggers`,
`dynamicRecords`, `endorsementApprovalService`, `endorsementService`,
`identityMatching`, `pdfGenerationService`, `policyDocumentService`,
`pricingService`, `reinstatementService`, `schedulerService`.

### 8.3 Capabilities

| BRD | Capability | Implementation |
|---|---|---|
| §2 | Multi-channel application | single authoritative engine |
| §3 | Identity matching (exact ID first) | tenant-scoped, ID-first |
| §5 | Data model | 20 objects, opt-in per tenant |
| §6 | Leads & attribution | core lead object + assignment |
| §7 | New business | application → quote → accept → submit → issue |
| §8 | API | `/api/v1/insurance`, versioned, idempotent |
| §9 | Pricing | 5 rate categories, age bands, child rules, markup |
| §10 | Acceptance | web/branch/phone evidence |
| §11 | Policy issue | auto-number, approval gate, HTML+PDF documents; sets the first premium due on the issue date (monthly) and links a premium account so the billing run picks the policy up |
| §12 | Servicing | lapse/reinstate/suspend/cancel/close |
| §13 | Billing | debits, credits, FIFO, paid-through date |
| §15 | Arrears/Lapse | 3 non-consecutive missed, grace, configurable |
| §16 | Communications | templates + triggers for all events |
| §17 | Endorsements | multi-stage approval workflow |
| §21 | Claims | intake → requirements → approval → payout |
| §23 | Reporting | analytics core (insurance-specific widgets pending) |

**UI.** Insurance records use the generic CRM screens, navigated through the
Insurance workspace's groups. Policy records add a **policy servicing panel**
(Insurance BRD §11–§12): status with key billing facts (premium, paid-through,
next billing, arrears), the servicing actions the current status allows —
`GET /insurance/policies/:id` returns `allowed_actions` and `can_issue`, e.g.
reinstate for lapsed/in-arrears, reactivate for suspended, nothing once closed
— with a reason recorded in the status history, plus document generation and
download, status history and the communication log.

New business has a **wizard** at `/insurance/new-business` (Insurance BRD §2,
§7, §10): product version and sales channel → main member (age checked against
the product's entry ages; cover chosen from its benefit covers) → spouse,
children and extended family, as the product allows → premium payer, payment
method and beneficiary → server-priced quote → acceptance with the evidence
the channel requires (branch: signature reference; telephone: recording
reference or approved fallback) → validation and submit → optional immediate
issue. Every step is saved to the application, so `?application=<id>` resumes
it; a submitted application redirects to its policy record. It opens from the
Policies list, from **New policy** on a client (prefilled main member) or lead
(attribution), and from a client's related Policies list — policies are never
created as bare records from the UI. Billing, endorsements and claims
operations have no dedicated screens yet.

### 8.4 Scheduled operations

systemd units in `deploy/systemd/`:

| Unit | Schedule |
|---|---|
| `salesdam-insurance-scheduler` | 02:00 daily |
| `salesdam-billing-cycle` | 03:00 daily |
| `salesdam-auto-lapse` | 04:00 daily |
| `salesdam-communication-dispatcher` | every 5 minutes |

---

## 9. Frontend & Admin applications

### 9.1 CRM SPA (`frontend/`)

Route groups: `/login`, `/register`, `/forgot-password`, `/reset-password`,
`/auth/verify`, `/verify-email`, payment callbacks, `/onboarding`,
`/` (home), `/o/:objectApiName` (list/record/new/edit, task calendar, kanban),
`/setup/objects` (+ schema builder), `/setup/pdf-templates`, `/automation`,
`/dashboards`, `/email-templates`, `/dashboards/:id`, `/analytics`, `/search`,
`/incidents`, `/approvals`, `/setup/approval-processes` (+ `/new`, `/:id`),
`/setup/duplicate-rules`, `/o/:objectApiName/merge`,
`/admin/*` (users, roles, settings, email senders, incidents),
`/workspaces`, `/tenders`, and the Salesdam module pages `/sd/orders`,
`/sd/accounting`, `/sd/deals`, `/sd/leads`, `/sd/revenue`, `/sd/sales`,
`/sd/roi`.

UI components relevant to the newest capabilities: an approval panel on
every record (any object, driven by the configured approval processes; the
older lead-specific approval buttons remain for the Lead approval setting),
the approval-process builder and My Approvals queue, a pre-save duplicate
dialog in `RecordForm` (lists matching records; "Save anyway" for warn rules,
no save for block rules), and an **Activity** tab on every record page showing
the chronological timeline with a composer for notes, calls, meetings, emails
and tasks. The omnichannel inbox, channels, message templates,
telephony, change sets, consent, sandbox clone and
conversation-capture surfaces are **API-only** — there is no dedicated screen
for them yet.

### 9.2 Admin console (`admin/`)

Pages: Dashboard, Tenants, TenantDetail, Users, AuditLogs, IncidentManagement,
Login. Used by platform operators for cross-tenant administration.

---

## 10. Security posture

- **Tenant isolation**: middleware-scoped queries; verified cross-tenant by an
  e2e suite.
- **Webhooks**: HMAC-SHA256 (timing-safe) over raw bytes for channels;
  HMAC-SHA512 for Paystack; an unsigned/wrongly signed payload is rejected.
- **Secrets**: provider credentials and webhook secrets are `select:false` and
  stripped from responses; production credentials are never committed.
- **HTML**: email, PDF and Flow fields with user-generated HTML are sanitized
  before render.
- **No false success**: outbound provider delivery and telephony call control
  return explicit not-implemented statuses; nothing is reported as delivered or
  dialled when it was not.
- **Destructive ops**: merge soft-deletes and restores on validation failure;
  rollback is single-use per deployment.
- **Rate limiting**: global `/api` limiter plus a login-burst limiter.
- **Systemd hardening**: `NoNewPrivileges`, `PrivateTmp`, `ProtectSystem`,
  `ReadWritePaths`.

---

## 11. Testing & quality gates

### 11.1 CI (`.github/workflows/quality.yml`)

- Node 22, Mongo 7 service.
- `npm test` (Jest: 3 suites, 21 tests).
- Database-backed integration suites:
  `tenant-isolation`, `admin-guards`, `password-reset`, `configuration`,
  `approval-process`, `duplicate-detection`, `consent`, `activity`,
  `change-set`, `omnichannel`, `telephony`, `record-merge`,
  `conversation-capture`, `insurance-endorsements`.
- `npm run test:insurance` (9 suites).
- Frontend build and admin build.

### 11.2 Verified locally (2026-10-16)

| Command | Result |
|---|---|
| `npm test` (Jest) | 21/21 |
| `tests/tenant-isolation.e2e.mjs` | 23/23 |
| `tests/password-reset.e2e.mjs` | 9/9 |
| `tests/configuration.e2e.mjs` | 18/18 |
| `tests/approval-process.e2e.mjs` | 43/43 |
| `tests/admin-guards.e2e.mjs` | 19/19 |
| `tests/duplicate-detection.e2e.mjs` | 21/21 |
| `tests/consent.e2e.mjs` | 19/19 |
| `tests/activity.e2e.mjs` | 17/17 |
| `tests/change-set.e2e.mjs` | 47/47 |
| `tests/omnichannel.e2e.mjs` | 42/42 |
| `tests/telephony.e2e.mjs` | 16/16 |
| `tests/record-merge.e2e.mjs` | 23/23 |
| `tests/conversation-capture.e2e.mjs` | 14/14 |
| `backend/tests/insurance-endorsements.e2e.mjs` | 33/33 |
| `npm run test:insurance` | exit 0 — 13 suites: metadata 9/9, application 40/40, servicing & claims 38/38, billing 16/16, communication templates 8/8, auto-lapse 8/8, billing run 11/11, reinstatement 18/18, approval 16/16, documents 15/15, communication triggers 15/15, communications 4/4, scheduler 19/19 |
| `frontend && npm run build` | pass |
| `admin && npm run build` | pass |

> Caveat: the GitHub Actions workflow is defined and locally equivalent, but
> CI gates have not been observed to run on GitHub for this repository.

---

## 12. Deployment & operations

- **Compose**: `docker-compose.platform.yml`, `backend/compose.yaml`
  (`npm run db:up|db:down|db:logs`).
- **systemd**: the four units above, installed by `deploy/install-systemd.sh`
  (run as root), configured through `/etc/salesdam/environment`
  (`deploy/environment.example`).
- **nginx**: `deploy/nginx-platform.salesdam.com.conf`.
- **Scripts**: `seed`, `seed:local`, `seed:insurance`, `seed:dev-users`,
  `create-indexes`, plus migrations (`migrate:*`) and operational scripts
  (`run-auto-lapse`, `run-billing-cycle`, `run-insurance-scheduler`,
  `dispatch-communications`).

Go-live sequence:

1. Deploy code to `/opt/salesdam/backend`.
2. `sudo ./deploy/install-systemd.sh`.
3. Populate `/etc/salesdam/environment`.
4. Start the MongoDB replica set.
4. `npm ci --production && npm run db:up`.
5. Restart `salesdam-*.timer`.
6. Configure external integrations when credentials are available.

---

## 13. Known limitations & outstanding work

### 13.1 External dependencies — UNVERIFIED / BLOCKED

| Area | Status | Blocker |
|---|---|---|
| Collections adapters (Pay@, EasyPay, debit order, EFT, gateway) | interfaces defined | no sandbox credentials |
| WhatsApp / SMS / Post delivery | stored `queued` with provider status; never faked | no provider credentials |
| Meta Lead Ads capture (§16.1) | deferred — mapping contract needed | no lead field-mapping contract |
| Telephony call control | `501` seam only | Euphoria API docs not supplied |
| Insurance consent wiring | consent engine complete | Insurance ERD/data model not supplied |
| Insurance dashboards | analytics core exists | insurance-specific widgets pending |
| SMTP delivery | `EmailSender` implemented | production SMTP config required |

### 13.2 Deferred (internal)

- **Meta Lead Ads capture (§16.1)**: the receive/mapping layer is not built;
  pending a lead field-mapping contract.

### 13.3 Known limits

- Duplicate merge is not wrapped in a multi-document transaction: a crash
  after soft-deleting duplicates but before saving the survivor would leave
  them soft-deleted (recoverable by clearing `isDeleted`).
- The platform has no UI for omnichannel, telephony, change sets, consent,
  sandbox or conversation-capture; these are API-only today.
- `name` is read-only for non-admins, so a contact name prefilled from a
  conversation is dropped for standard users (only the matched identifier
  lands).
- Write access to the `Digital-Fingerprint/Salesdam-v3` remote has been
  unavailable (403); work is on `SaphoM/Salesdam-v3`.

---

## 14. Traceability

| Source | Location |
|---|---|
| Core BRD V2.1 | `V3_GAP_ANALYSIS.md`, this document §7 |
| Insurance BRD v1.0 | `docs/insurance/BRD_REQUIREMENTS_MATRIX.md` |
| Insurance implementation | `docs/insurance/IMPLEMENTATION_PLAN.md`, `GO_LIVE_CHECKLIST.md`, `USER_MANUAL.md` |
| API/Integration conformance | `API_CONTRACT_CONFORMANCE.md` |
| Delivery & verification log | `DELIVERY_SUMMARY.md` |
| Audits | `AUDIT_EXECUTIVE_SUMMARY.md`, `SECURITY_AUDIT.md`, `DATABASE_AUDIT.md`, `MULTI_TENANCY_AUDIT.md`, `TESTING_AUDIT.md` |

---

*Salesdam Engineering — Confidential, internal use. This specification reflects
the repository at `master` @ `8bc6696`.*
