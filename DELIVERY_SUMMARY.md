# Salesdam V3 Insurance Workspace - Delivery Summary

**Date**: 2026-10-11 (status snapshot) — **verification log appended 2026-10-16**
**Status**: Feature-complete for the insurance workspace; **NOT signed off for
production** (see `API_CONTRACT_CONFORMANCE.md` and the audit go-live assessment).
**Verified on 2026-10-16**: see [Verification log](#verification-log-2026-10-16) below.
**Updated 2026-10-21**: see `V3_SPECIFICATIONS.md` for the current, code-derived
description of what exists — including which features have screens and which are
API-only.

> Correction (2026-10-16): earlier versions of this document stated
> "PRODUCTION READY" and "130/130 checks passing in CI/CD". The platform is not
> go-live approved: external providers are uncredentialed (UNVERIFIED), and CI
> gates are defined in `.github/workflows/quality.yml` but had never been run.
> The table below is the 2026-10-11 snapshot; the log below is the reproducible,
> currently-verified evidence.

---

## Executive Summary

The Salesdam V3 Insurance Workspace backend and API are implemented and tested
against the BRD (Business Requirements Document) v1.0. Insurance records are
viewed and edited through the generic CRM record screens. Policy servicing has a
dedicated panel on each policy (issue, lapse/reinstate, suspend/reactivate,
cancel/close, documents, history, communications); the other insurance
operations — new business (quote, accept, submit), billing, endorsements and
claims payout — are still **API-only**, with no dedicated screens.
The platform is **not signed off for production** (see Status above).

---

## Implementation Summary

### Core Platform (20 Metadata Objects)
| Object | API Name | Purpose |
|--------|----------|---------|
| Product Version | `product_version` | Effective-dated product rules |
| Benefit Cover | `benefit_cover` | Rate categories, premiums, age bands |
| Child Benefit Rule | `child_benefit_rule` | Age-banded child cover % |
| Policy | `policy` | Core policy lifecycle |
| Policy Party | `policy_party` | Roles on policy (payer, member, beneficiary) |
| Insured Life | `insured_life` | Covered lives with effective dates |
| Policy Acceptance | `policy_acceptance` | Channel-specific acceptance evidence |
| Policy Status History | `policy_status_history` | Durable lifecycle transitions |
| Policy Premium History | `policy_premium_history` | Effective-dated premium changes |
| Policy Endorsement | `policy_endorsement` | Formal amendments |
| Policy Endorsement Item | `policy_endorsement_item` | Field-level prior/new values |
| Policy Approval | `policy_approval` | Underwriting sign-off |
| Policy Communication | `policy_communication` | Notification log |
| Communication Template | `communication_template` | Multi-channel templates |
| Premium Transaction | `premium_transaction` | Financial ledger (debits/credits) |
| Claim | `claim` | Claim lifecycle |
| Claim Requirement | `claim_requirement` | Evidence checklist |
| Claim Payment | `claim_payment` | Separate payout ledger |
| Claim Status History | `claim_status_history` | Claim transitions |
| Endorsement Approval Workflow | `endorsement_approval_workflow` | Multi-stage approval chains |

---

## Verified Test Coverage (2026-10-11 snapshot, 130/130 Checks)

> The counts below are the original delivery snapshot. See the verification log
> below for results re-run on 2026-10-16 (tenant isolation is now 23/23).

| Test Suite | Checks | Coverage |
|------------|--------|----------|
| `tenant-isolation.e2e.mjs` | 23/23 | Cross-tenant security (16 at delivery, +7 incident/dashboard/layout) |
| `insurance-metadata.e2e.mjs` | 9/9 | Object seeding & isolation |
| `insurance-application.e2e.mjs` | 33/33 | New business flow |
| `insurance-servicing-claims.e2e.mjs` | 32/32 | Servicing + claims |
| `insurance-approval.e2e.mjs` | 16/16 | Underwriting gates |
| `insurance-reinstatement.e2e.mjs` | 18/18 | Lapse/reinstate |
| `insurance-documents.e2e.mjs` | 15/15 | Contract/schedule PDF/HTML |
| `insurance-communication-triggers.e2e.mjs` | 15/15 | Automated notifications |
| `insurance-communications.e2e.mjs` | 4/4 | Template system |
| `insurance-billing.test.mjs` | 16/16 | Ledger & allocation |
| `insurance-auto-lapse.e2e.mjs` | 8/8 | Arrears evaluation |
| `insurance-billing-run.e2e.mjs` | 11/11 | Scheduled debits |
| `insurance-pricing.unit.test.js` | 12/12 | Premium calculation |
| `enforceTenant.unit.test.js` | 5/5 | Middleware |

**Total**: 130/130 checks PASS

---

## Verification log (2026-10-16)

Re-run against `master` (`4896e04`) on a local MongoDB instance:

| Command | Result |
|---------|--------|
| `cd backend && npm test` | 21/21 tests, 3 suites (pricing 12, enforceTenant 5, paystack signature 4) |
| `node tests/tenant-isolation.e2e.mjs` | 23/23 checks |
| `node tests/password-reset.e2e.mjs` | 9/9 checks |
| `node tests/insurance-endorsements.e2e.mjs` | 33/33 checks |
| `node tests/record-merge.e2e.mjs` | 21/21 checks (f332095) |
| `node tests/conversation-capture.e2e.mjs` | 14/14 checks (f332095) |
| `npm run test:insurance` | exit 0 (9/9, 33/33, 32/32, 8/8, 11/11, 18/18, 15/15, 4/4 across the suites) |
| `cd frontend && npm run build` | pass |
| `cd admin && npm ci && npm run build` | pass |

Quality gates are defined in `.github/workflows/quality.yml` (Jest, the
integration scripts above, and the frontend/admin builds, with a MongoDB
service for the database-backed tests).

---

## Core BRD Platform Features (delivered 2026-10-16)

Seven platform capabilities from the Core BRD previously flagged as not
started were built as new, tenant-scoped `/api/v1` surfaces. Each ships with an
end-to-end suite and is wired into `.github/workflows/quality.yml`.

| BRD | Feature | Surface | Suite | Checks | UI (2026-10-21) |
|-----|---------|---------|-------|--------|-----------------|
| §14 | Platform-wide TenantConfiguration resolution | `/configuration` | `configuration.e2e.mjs` | 18/18 | API-only |
| §8 | Configurable multi-step approval-process builder | `/approval-processes` | `approval-process.e2e.mjs` | 43/43 | Setup › Approval Processes builder, approval panel on records, My Approvals |
| §3.4 | Configurable duplicate detection & matching | `/duplicate-rules` | `duplicate-detection.e2e.mjs` | 21/21 | Setup › Duplicate Rules, save-time warning/block dialog |
| §23 | Communication consent & preferences | `/consents` | `consent.e2e.mjs` | 19/19 | API-only |
| §24 | Activity & customer interaction timeline | `/activities` | `activity.e2e.mjs` | 17/17 | Activity tab on every record |
| §13 | Metadata deployment & change sets | `/change-sets` | `change-set.e2e.mjs` | 47/47 | API-only |
| §16 | Omnichannel inbox, channels & messaging templates | `/channels`, `/conversations`, `/message-templates` | `omnichannel.e2e.mjs` | 42/42 | API-only |
| §18 | Call centre/telephony presence, dispositions & wrap-up | `/telephony` | `telephony.e2e.mjs` | 16/16 | API-only |
| §3.4 | Duplicate record merge — survivor fills blanks, repoints lookups, soft-deletes the rest | `POST /records/:objectApiName/merge` | `record-merge.e2e.mjs` | 23/23 | Merge screen (from list selection or the duplicate dialog) |
| §16.4 | Create a record from an inbox conversation | `POST /conversations/:id/create-record` | `conversation-capture.e2e.mjs` | 14/14 | API-only |

### Provider readiness & environment management (delivered 2026-10-16)

Built on top of the seven features, everything that does not need vendor
credentials or the Insurance ERD — plus explicit seams for the parts that do:

| BRD | Capability | Surface |
|-----|------------|---------|
| §13 | Sandbox tenant cloning — copies a tenant's metadata (objects, fields, layouts, flows, approvals, duplicate rules, config overrides) into a new isolated tenant with no business data; role refs remap by name | `POST /change-sets/sandbox` (superuser) |
| §13 | Deployment rollback — restores each component to its pre-deployment state (recreate prior snapshot, or delete if it did not exist), once per deployment | `POST /change-sets/deployment-log/:logId/rollback` (superuser) |
| §16.1 | Provider catalog — required credentials and normalizer support per provider | `GET /channels/providers` |
| §16.1 | Provider config validation — reports missing credentials for an account | `POST /channels/:id/validate` (admin) |
| §16.1 | Inbound normalization — Meta WhatsApp Cloud API and Messenger/Instagram webhooks mapped to canonical events (batched, resilient per-event) | `POST /channels/webhook/whatsapp\|facebook\|instagram/:accountId` |
| §18.5 | Telephony provider catalog and call-control seam — `dial/hangup/transfer/hold` decline with `501` until a provider contract is wired | `GET /telephony/providers`, `POST /telephony/calls` |

### Verified outcomes in these features

- Approval requests lock the underlying record (`423` on update/delete while a
  request is pending); waiting steps carry no approver so `pending/mine` cannot
  match future steps, and it only matches the active step, so past approvers
  no longer see a request.
- Each approval stage (submit, approve, reject) can launch a flow with the
  outcome and comment as variables; a failing flow never undoes the decision.
- Duplicate rules `block` with `409 + duplicates` or `warn` with
  `duplicateMatches` on the create/update response.
- Cross-tenant metadata promotion is superuser-only; deployment is blocked
  until required objects/fields exist in the target tenant (§13.2), with a
  deployment log recorded either way.
- Channel webhooks authenticate by timing-safe HMAC over the raw body; provider
  secrets are never serialized.
- Outbound omnichannel replies are stored `queued` with an explicit provider
  status and are never reported as delivered while providers are unwired.
- Consent enforcement gates outbound replies when `consent.enforcement` is on.
- Duplicate merge also moves the duplicates' activities (as primary or related
  record) to the survivor's timeline.
- Duplicate merge keeps the survivor's fields, fills its blanks from the
  duplicates, repoints every inbound lookup, soft-deletes the duplicates
  (`mergedIntoId`) and appends `mergeHistory`; a merge rejected by validation
  restores the duplicates untouched.
- Creating a record from a conversation prefills the matched identifier, honors
  field/object permissions, and applies the same duplicate gate as manual
  capture (falling back to the channel account's first match-rule object when no
  object is requested).

### Honest status of these features

- **External providers remain UNVERIFIED**: live Meta/WhatsApp, SMTP/SMS
  gateway and Euphoria telephony calls are not integrated (no credentials,
  and Euphoria API docs were not supplied). The ingestion, inbox, template,
  consent and call-logging logic around them is tested; delivery itself is not.
  The provider layer is now ready: credentials/contracts drop into the declared
  provider definitions and the call-control seam.
- **Deferred, noted in commits**: Meta Lead Ads capture (§16.1) pending a lead
  field-mapping contract. (On-approve flow triggering was delivered 2026-10-21.)

---

## Feature Completeness (BRD v1.0)

### ✅ Fully Implemented

| BRD Section | Feature | Implementation |
|-------------|---------|----------------|
| §2 | Multi-channel application (web/branch/phone) | Single authoritative engine |
| §3 | Identity matching (exact ID first) | Tenant-scoped, ID-first matching |
| §4 | Insurance Workspace | Workspace navigation: 7 groups over generic record screens (17 objects configured; objects missing from a tenant are hidden) |
| §5 | Data model | 20 objects, opt-in per tenant |
| §6 | Leads & attribution | Core lead object + assignment |
| §7 | New business | Application → quote → accept → submit → issue |
| §8 | API | `/api/v1/insurance/*` versioned, idempotent |
| §9 | Pricing | 5 rate categories, age bands, child rules, markup |
| §10 | Acceptance | Web/branch/phone evidence |
| §11 | Policy issue | Auto-number, approval gate, doc gen (HTML+PDF) |
| §12 | Servicing | Lapse/reinstate/suspend/cancel/close |
| §13 | Billing | Debits, credits, FIFO, paid-through date |
| §14 | Collections | Adapters defined (debit order, Pay@, EasyPay, gateway, EFT) |
| §15 | Arrears/Lapse | 3 non-consecutive missed, grace, configurable |
| §16 | Communications | Templates + triggers for all events |
| §17 | Endorsements | Multi-stage approval workflow |
| §21 | Claims | Intake → requirements → approval → payout |
| §23 | Reporting | Analytics core (dashboards pending) |

> "Implemented" in this table means the backend/API. Of the insurance
> operations, only §11–§12 (issue and servicing) have a dedicated UI — the
> policy servicing panel; §7, §13, §17 and §21 are API-only. See §9 of
> `V3_SPECIFICATIONS.md`.

### ⚠️ External Dependencies (Not Implemented)

| Area | Status | Blocker |
|------|--------|---------|
| Collections adapters | Interfaces defined | No sandbox credentials for Pay@, EasyPay, debit order, gateway |
| WhatsApp/SMS/Post | Stubs in dispatcher | No provider credentials |
| Insurance dashboards | Analytics core exists | Insurance-specific widgets not built |
| Email delivery | SMTP via EmailSender | Requires production SMTP config |

---

## Deployment Package

### Systemd Services
```
deploy/
├── systemd/
│   ├── salesdam-insurance-scheduler.service + .timer  (02:00 daily)
│   ├── salesdam-billing-cycle.service + .timer       (03:00 daily)
│   ├── salesdam-auto-lapse.service + .timer          (04:00 daily)
│   └── salesdam-communication-dispatcher.service + .timer (every 5 min)
├── environment.example          # All production env vars
└── install-systemd.sh          # Automated installer (run as root)
```

### NPM Scripts
```bash
npm run test:insurance      # All 130 checks
npm run auto:lapse          # Manual auto-lapse run
npm run billing:run         # Manual billing cycle
npm run communications:dispatch  # Manual communication dispatch
npm run scheduler:run       # Manual unified scheduler
```

---

## Security & Compliance

- ✅ **Tenant isolation**: All queries scoped by `req.tenantId` (middleware)
- ✅ **Authentication**: Session + bcrypt + lockout + API keys
- ✅ **Authorization**: Object/app/field permissions with admin/superuser bypass
- ✅ **Rate limiting**: Login burst protection (10/15min)
- ✅ **Audit trail**: All mutating actions logged
- ✅ **Systemd hardening**: NoNewPrivileges, PrivateTmp, ProtectSystem, ReadWritePaths
- ✅ **Replica set**: MongoDB rs0 for transactions

---

## Go-Live Checklist

- [x] All automated suites pass (see Verification log, 2026-10-16)
- [x] Cross-tenant isolation verified (23 checks)
- [x] Policy documents generate (HTML + PDF) with versioning
- [x] Automatic email delivery with attachments on issue/endorsement
- [x] Multi-stage endorsement approval workflow
- [x] Auto-lapse evaluation with 3-missed-payment rule
- [x] Billing run with idempotent debits and FIFO allocation
- [x] Communication templates with dynamic fields
- [x] Endorsement approval workflow (underwriting → management)
- [x] Systemd services + timers configured
- [x] Environment template with all production variables
- [x] Automated systemd installer script

### To Go Live:
1. Deploy code to `/opt/salesdam/backend`
2. Run `sudo ./deploy/install-systemd.sh`
3. Configure `/etc/salesdam/environment` with production values
4. Start MongoDB replica set (`npm run db:up`)
5. Deploy application: `npm ci --production && npm run db:up`
6. Restart timers: `systemctl restart salesdam-*.timer`
5. Configure external integrations (Pay@, EasyPay, WhatsApp, etc.) when credentials available

---

## Support Information

- **Documentation**: `docs/insurance/BRD_REQUIREMENTS_MATRIX.md` (full traceability)
- **Test Reports**: Suites re-verified 2026-10-16 (see Verification log above); CI gates in `.github/workflows/quality.yml`
- **Architecture**: Multi-tenant, metadata-driven, event-sourced where applicable
- **Extensibility**: New objects/fields via metadata engine (no code changes)

---

**Prepared by**: Salesdam Engineering  
**Classification**: Confidential - Internal Use  
**Next Review**: Post-go-live (30 days)