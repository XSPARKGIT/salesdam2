# Salesdam — Platform Status

**As at 22 October 2026** · source: `master` @ `ec99569` · verified against a live
MongoDB instance and the running application, not from documentation.

This page says what a client can use today, what is built but not yet exposed,
and what still needs work. It is deliberately short — the detail is in
`V3_SPECIFICATIONS.md` (engineering) and `DELIVERY_SUMMARY.md` (delivery history).

---

## 1. What Salesdam is

A multi-tenant, metadata-driven CRM platform with an insurance workspace on top
of the same core. Objects, fields, validations, formulas, workflows and
permissions are configured per tenant rather than written into the code, so a
new business line does not need a new release.

Five parts: the API (`backend/`), the CRM application (`frontend/`), the
platform administration console (`admin/`), the documentation site (`docs/`) and
this marketing site (`landing/`).

---

## 2. Working in the application today

| Area | Where | What you can do |
|---|---|---|
| Tenant setup | Register, onboarding | Register a workspace; standard objects, roles and a default workspace are created for you |
| Users, roles, permissions | Admin → Users, Admin → Roles | Manage users; define roles with object-level and field-level permissions |
| Configurable data model | Setup → Objects, Layouts | Custom objects with text, number, currency, date, picklist, lookup, master-detail, formula and roll-up field types; validation rules; page layouts |
| Records | `/o/:object` | Create, edit, delete, bulk delete, list views, filters, saved columns, kanban. Import and export live under Admin → Data Import / Data Export |
| Search | Global search | Search across objects |
| Dashboards | Dashboards | Builder, widgets, folders (enabled by feature flag) |
| **Approval processes** | Setup → Approval Processes; every record | Multi-step processes with entry criteria, ordered steps, per-stage field updates, record locking, flow launch on decision; submit/approve/reject/recall from the record; **My Approvals** queue with a sidebar badge |
| **Duplicate detection** | Setup → Duplicate Rules; record form | Rules per object; a pre-save dialog lists matching records — "Save anyway" for a warn rule, blocked for a block rule |
| **Record merge** | Record list → Merge; duplicate dialog | Pick the record to keep and each field's value; lookups are repointed, duplicates soft-deleted, activities moved to the survivor |
| **Activity timeline** | Every record → Activity tab | Chronological timeline with a composer for notes, calls, meetings, emails and tasks |
| Automation | Automation | Record-triggered flows and screen flows with conditions, decisions, notifications, emails and HTTP actions |
| Notifications | Top bar | In-app notifications with unread count, produced by approvals, automations and billing |
| Insurance — new business | `/insurance/new-business` | Product and channel → main member (entry ages enforced) → family → payer and beneficiary → server-priced quote → acceptance evidence → submit → optional issue |
| Insurance — servicing | Any policy record → servicing panel | Status and billing facts, documents (contract, schedule, certificate) and the communication log; lapse, reinstate, suspend, reactivate, cancel and close, each with a required reason |
| Platform administration | `admin/` | Tenants, users, incidents and the audit log |

**What a customer sees when a premium is missed** — verified end to end: a
reminder after the first unpaid premium, another after the second, a third
before the policy lapses, then the lapse notice. Each fires exactly once.

---

## 3. Built and tested, but API-only

These have complete, tested backends and no screen yet. They are real
capabilities — they simply are not in the application.

| Capability | API | Notes |
|---|---|---|
| Premium billing, arrears and lapse evaluation | `/insurance/policies/...`, billing run | Billing runs nightly; issued policies are set up to be billable |
| Policy endorsements | `/insurance/policies/:id/endorsements` | Multi-stage approval chains behind the scenes |
| Claims intake, requirements and payout | `/insurance/claims` | Separate payout ledger |
| Metadata deployment and change sets | `/api/v1/change-sets` | Validate, deploy, roll back, clone a sandbox tenant |
| Tenant configuration resolver | `/api/v1/configuration` | Tenant override → platform default → built-in default |
| Omnichannel inbox, channels, message templates | `/api/v1/channels`, `/conversations` | Inbound webhooks normalised; replies queue until a provider is connected |
| Telephony | `/api/v1/telephony` | Agent presence, dispositions, call log, wrap-up; call control awaits a provider contract |
| Communication consent and preferences | `/api/v1/consents` | Enforcement can be switched on per tenant |
| Create a record from a conversation | `/api/v1/conversations/:id/create-record` | Honours permissions and the duplicate rules |

---

## 4. Needs credentials or a contract from outside

| Area | Blocked on |
|---|---|
| WhatsApp, Messenger and Instagram messaging | Meta app credentials and app review |
| SMS delivery | Gateway credentials |
| Email delivery | Production SMTP configuration (the platform sends through a configured sender) |
| Telephony call control | Provider contract and API documentation (Euphoria) |
| Collections: Pay@, EasyPay, debit order, gateway | Sandbox credentials |
| Sage Accounting integration | Client-side Sage configuration |

The provider layer is built: credentials drop into the declared provider
definitions, and nothing is reported as delivered while a provider is unwired.

---

## 5. Not started

- Marketing campaigns and a first-class RFQ object
- A procurement workspace
- Client-facing billing and claims screens (see section 3)

---

## 6. How this is verified

| | |
|---|---|
| Automated checks | **580** — 535 across 25 end-to-end API suites, plus 45 unit tests. Every suite is currently green |
| Coverage | Tenant isolation, approvals, duplicate rules, merge, activity, configuration, consent, change sets, omnichannel, telephony, conversation capture, and thirteen insurance suites (new business, servicing, billing, arrears, lapse, claims, documents, communications, scheduler) |
| Builds | API, CRM application, admin console, documentation site and marketing site all build clean |
| CI | Runs on every push and pull request: unit tests, the integration suites against a MongoDB replica set, and the frontend and admin builds |
| Documentation | `docs/` — user guide, API reference with a live request runner, data model, architecture |

---

## 7. Known limitations

- The insurance workspace has screens for **new business and policy servicing
  only**. Billing operations, endorsements and claims are run through the API.
- Dashboards and automation are behind a feature flag that is on in the local
  and demo builds; ask us to have them enabled for your tenant.
- External messaging, telephony and payment channels work up to the point of
  the provider credential — they are not proven against a live account.
- The platform has not been signed off for production. It is complete for the
  scope above and verified, but it has not yet run against live provider
  accounts or a client's own data.
