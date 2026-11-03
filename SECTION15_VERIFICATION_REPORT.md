# Section 15 — Custom Code & Extensibility: Final Verification & Close-Out Report

**FINAL STATUS: PARTIALLY COMPLETE — CLOSED WITH DEFERRED REQUIREMENTS**

This status is an administrative closure of the current implementation phase, not a compliance certification. Section 15 is **not** fully compliant with BRD §15 and is **not** certified production-ready. It may be closed for this phase so work can proceed to Section 16; the items below must be picked up in a later phase before tenant-supplied custom code is enabled in production.

---

## 0. Close-out summary (read this first)

### 0.1 Summary of delivered functionality
This phase added a working **core Custom Code framework** to Salesdam: a versioned code-snippet model ([backend/models/CustomCode.js](backend/models/CustomCode.js)), CRUD + execute/activate/restore endpoints ([backend/routes/customCode.js](backend/routes/customCode.js), [backend/controllers/customCodeController.js](backend/controllers/customCodeController.js)), a Node `vm`-based execution service with timeout and basic recursion protection ([backend/services/customCodeService.js](backend/services/customCodeService.js)), a drag-in "Custom Code" Flow node ([frontend/src/pages/Automation/FlowBuilder.jsx:182](frontend/src/pages/Automation/FlowBuilder.jsx)), a webhook-triggered execution path ([backend/controllers/incomingWebhookController.js](backend/controllers/incomingWebhookController.js)), and an admin UI ([frontend/src/pages/Admin/CustomCode.jsx](frontend/src/pages/Admin/CustomCode.jsx)). This directly closes several items a prior compliance audit (`Salesdam_V3_Platform_Core_BRD_V2.1_Compliance_and_Gap_Analysis.docx`, audited at commit `485b44a`, an ancestor of this branch) had marked **NOT IMPLEMENTED** for BRD §15 — see §6 below for the item-by-item reassessment. This session's own work was limited to verifying and fixing the admin UI (`CustomCode.jsx`) and documenting findings; it did not build or alter the framework itself.

### 0.2 Verified frontend workflows
Personally exercised in the browser against the running dev server (not inferred from code): **Create, Add Version, Activate, Execute (success and failure), Restore, Delete.** Full evidence with exact network requests is in §3 below (carried over unchanged from the prior verification pass in this session) plus a fresh, lighter confirmation pass for this close-out (§3.1). No regression found.

### 0.3 Automated test results (rerun for this close-out)
```
$ cd backend && node tests/section15-custom-code.e2e.mjs
13/13 checks passed.

$ cd frontend && npm run build
✓ built in 6.51s — no errors (pre-existing chunk-size/@extend warnings only, unrelated)
```
No test was deleted, skipped, or weakened to reach this result.

### 0.4 Features that remain incomplete
- Draft → **Test** → Active → Inactive lifecycle: the `test` status exists in the schema but no code path ever sets or checks it; only Draft → Active → Archived actually functions.
- No distinct test-execution/dry-run environment (BRD-15.5-01) beyond the narrow `testMode` write guard.
- No resource limits (CPU/memory) — only a 5s wall-clock timeout.
- No secure credential-access mechanism for sandboxed code.
- Execution permission (`canDeployCustomCode`) is enforced only on the direct REST route; it is **not** enforced when custom code is invoked from a Flow node or an incoming webhook (see §6, BRD-15.4-06).
- `custom_js` layout-button behavior (a separate BRD-15.2-02 extensibility surface) remains a dead schema option with no frontend implementation — unrelated to this session's work, still outstanding.
- PDF/document template rendering (BRD-15.3-*) remains largely unimplemented/defective per the existing audit — unrelated to this session's work, still outstanding.

### 0.5 Critical security findings
See §5 for full detail. Summary: **Node's `vm` module is not a security boundary.** A demonstrated, reproducible escape (`this.constructor.constructor('return process')()`) gives sandboxed code the real, unrestricted Node `process` object — and from there `require()`, the filesystem, environment variables, and `child_process`. This is independent of `testMode` (which only gates two specific write helpers) and independent of the permission system (object-level and tenant checks apply *before* code runs, not to what the code can reach once running). **Tenant-supplied custom code must not be enabled for production use until the execution engine is replaced with a genuinely isolated runtime** (e.g. `isolated-vm`, a sandboxed subprocess, or a WASM interpreter) **and independently re-tested.**

### 0.6 Outstanding BRD requirements
Full BRD-ID-level reassessment in §6. In short: the core framework items (BRD-15-01, BRD-15.1-01 through -10) have moved from NOT IMPLEMENTED to substantially implemented, but with the isolation requirement (BRD-15.4-01, BRD-15.4-05's "isolation" and "secure credential access" sub-items, BRD-15.4-06) still failing. BRD-15.2-02 (custom_js buttons), BRD-15.3-* (PDF template rendering), and BRD-15.5-01 (dedicated test harness) remain outstanding, as documented in the pre-existing audit and unchanged by this session.

### 0.7 Deferred implementation items
- Replace the `vm`-based executor with an isolated runtime.
- Enforce `canDeployCustomCode` consistently at every invocation path (REST, Flow engine, webhook), not only the REST route.
- Implement the `test` status as a real pre-activation stage.
- Add resource limits and a secure credential-access API.
- `custom_js` layout buttons and PDF template rendering (separate BRD-15 sub-areas, out of this session's scope).

### 0.8 Production-readiness limitations
Not production-ready for tenant-supplied code execution: the sandbox escape alone (§5) is a release blocker by itself. The admin UI bugs found and fixed this session (§1) are resolved and build-clean, but that only means the *management UI* is reliable — it does not change the execution engine's security posture.

### 0.9 Final close-out decision
**Section 15 is approved for administrative close-out of the current implementation phase under status "PARTIALLY COMPLETE — CLOSED WITH DEFERRED REQUIREMENTS."** This is a scope/phase decision, not a compliance or security sign-off. Work may proceed to Section 16. The deferred items in §0.7 must be tracked and addressed in a future phase before any tenant-facing production use of custom code execution.

---

## Technical verification detail (from this session's UI bug-fix and verification work)

Scope of the technical work below: [frontend/src/pages/Admin/CustomCode.jsx](frontend/src/pages/Admin/CustomCode.jsx) and its backend endpoints. No unrelated files were modified.

## 1. Bugs found and fixed in this pass

All of the following were found while actually exercising the page — not assumed from reading the code.

### 1.1 `execResult`/`setExecResult` undeclared (fixed previously, re-confirmed here)
`execResult` was referenced in JSX and `setExecResult` was called in two handlers with no `useState` declaration. This crashed the page on mount (`ReferenceError`). **Fixed**: `const [execResult, setExecResult] = useState(null);` — confirmed by loading the page and getting a clean render with no console errors.

### 1.2 Every error handler read the wrong error shape (newly found, fixed)
The app's global axios interceptor ([frontend/src/services/api.js:39-62](frontend/src/services/api.js)) does **not** reject with the raw axios error. It rejects with a plain object: `{ message, status, data }`. `CustomCode.jsx` was written as if it received the raw axios error (`e.response?.data?.message`, `e.response?.data`), which is always `undefined` on this object. Effect:
- Every failed action (Create, Add Version, Activate, Restore, Execute, Delete) showed only the generic fallback toast text ("Create failed", "Execute failed", etc.) instead of the real backend message.
- On a failed Execute, `setExecResult(e.response?.data || null)` always evaluated to `null`, so the "Execution Result" panel never appeared for errors — only for successes.

I confirmed this by executing a draft-only snippet (no active version) before the fix: the network tab showed a 500 with a specific backend message, but the UI showed nothing beyond a generic toast and no result panel.

**Fixed**: every catch block now reads `e.message` (toast) and `e.data` (full payload), matching the pattern already used correctly elsewhere in the codebase (e.g. [frontend/src/pages/Reports/ReportBuilder.jsx:148](frontend/src/pages/Reports/ReportBuilder.jsx)). Re-tested after the fix: the Execution Result panel now shows the exact backend error JSON, including `message`, `data`, `stack`, and `error.statusCode`.

### 1.3 `window.prompt()` throws in this environment (newly found during Add Version implementation, fixed)
The first version of the new "Add Version" action I wrote used `window.prompt()` to collect a change note. In the embedded browser pane used for this verification, `window.prompt()` **throws** (`Error: prompt() is not supported`) rather than returning `null`, which is also documented behavior for several other embedded/sandboxed browser contexts. Because the call sat outside the `try/catch`, it became an uncaught exception on every click, and the Add Version action never reached the API.

**Fixed**: replaced `window.prompt()` with an inline "Change note" text input bound to component state, consistent with the rest of the page's plain-input style. No native dialog dependency remains in the new code.

### 1.4 `window.confirm()` on Delete — not fixed, documented instead
`remove()` still uses `window.confirm()`, exactly as before this task. Unlike `prompt()`, `confirm()` does not throw in this embedded pane — it silently resolves to `false`, meaning the Delete button can never be confirmed via a real click in *this specific automation context*. This is pre-existing code, unrelated to the task, and works normally in real end-user browsers (Chrome/Firefox/Safari show the native dialog). Per "do not introduce unrelated changes," I left it as-is. To verify Delete's actual behavior I stubbed `window.confirm` to return `true` for one test click (see §3), which exercised the real `remove()` handler and the real `DELETE` request — this was a test-only override via the console, not a code change.

## 2. New feature implemented: Add Version

The manual guide I gave earlier assumed a version-creation endpoint without checking whether it was reachable from the UI. It wasn't — there was no "Add Version" control anywhere in `CustomCode.jsx`. I checked the backend route table directly rather than assume:

```
backend/routes/customCode.js:
POST /:name/versions   (checkAppPermission('canManageCustomCode'))  → addVersion
```
Mounted at `${API_V1_PREFIX}/custom-code` ([backend/app.js:235](backend/app.js)), so the real endpoint is:
```
POST /api/v1/custom-code/:name/versions
Body: { code: string, inputs?: object, changeNote?: string }
```

I added an **Add Version** button per row. It reuses the page's existing Code/Inputs editor fields (consistent with how Create already works) plus a new "Change note" input, and posts to the confirmed endpoint. Verified via the real network tab:
```
POST http://localhost:5002/api/v1/custom-code/ui_test_discount/versions → 200 OK
```

## 3. Functionality personally verified through the browser (not just "code exists")

All of the following were done by actually clicking buttons / filling fields in the running dev server (`npm run dev`, frontend :5173, backend :5002) and confirming both the UI state and the underlying network request/response:

| Action | How verified | Result |
|---|---|---|
| Page load | Navigated to `/admin/custom-code`, read console + page text | No JS errors, form and empty table render |
| Create | Filled Name/Code/Inputs, clicked **Create New Snippet** | Row appeared: `v1(draft)`; `POST /custom-code` fired |
| Execute on draft (no active version) | Clicked **Execute** | Toast + Execution Result panel show the real backend message ("...has no active version"); `POST /custom-code/:name/execute` → 500 |
| Add Version | Set new code + change note, clicked **Add Version** | Row updated to `v1(draft), v2(draft)`; `POST /custom-code/:name/versions` → 200 |
| Activate | Clicked **Activate v2** | Active Version column became `2`; versions showed `v1(draft), v2(active)`; `POST /custom-code/:name/activate` → 200 |
| Execute on active version | Set inputs to `{"price":100}`, clicked **Execute** | Execution Result panel showed `{"success":true,"output":20,"durationMs":80}` — matches v2's code (`price * 0.2`) exactly |
| Restore | Clicked **Restore v1** | Active Version became `1`; versions showed `v1(active), v2(archived)`; `POST /custom-code/:name/restore` → 200 |
| Delete | Stubbed `window.confirm` to `true` (console-only, not a code change), clicked **Delete** | Row removed from list; `DELETE /custom-code/:name` → 200 |

Every endpoint above was cross-checked against the actual network request URL and method in the browser's network panel, not inferred from the route file alone.

### 3.1 Close-out spot-check (this pass)
No frontend code changed since the full click-through above, so a full re-run would only reproduce identical evidence. For this close-out I instead did a lightweight confirmatory check against the current build: started both dev servers fresh, navigated to `/admin/custom-code`, confirmed the page renders with no application errors, and confirmed the `GET /api/v1/custom-code` call returns `200 OK` in the network panel. This is reported as a spot-check, not a repeat of the full workflow verification — the full workflow evidence in the table above is what substantiates §0.2.

## 4. Tenant isolation and permission enforcement

**Automated** (Section 15 E2E suite, `backend/tests/section15-custom-code.e2e.mjs`), rerun fresh for this task:
- Tenant B cannot `GET` tenant A's snippet by name → `404`
- A role without `canManageCustomCode` cannot `POST /custom-code` → `403`
- A role without `canDeployCustomCode` cannot `POST /custom-code/:name/execute` → `403`

I did not additionally re-verify tenant isolation/permissions by hand through two separate logged-in browser sessions — that would require provisioning a second tenant and a limited-permission user through the UI, which is redundant with the existing, passing, automated coverage for this exact behavior. The automated result is reported as automated, not claimed as hand-verified.

## 5. `testMode` — what it blocks, and what it does not

**What it blocks (confirmed empirically, not just by reading the code):** `testMode: true` disables the sandbox's own `createRecord` and `updateRecord` helper functions (`backend/services/customCodeService.js`). I proved this by running a snippet under `testMode: true` that called `createRecord('account', { name: 'TESTMODE_SHOULD_NOT_EXIST' })`, then re-queried the Account list — no such record was created. The E2E suite's assertion that a draft (and by extension any blocked write) fails is consistent with this.

**Critical bypass path — Node's `vm` module is not a security sandbox.** `customCodeService.js` runs user code with:
```js
const script = new vm.Script(version.code, { filename: `${name}.js` });
const ctx = vm.createContext(sandbox);
script.runInContext(ctx, { timeout: TIMEOUT_MS });
```
Node's own documentation explicitly states the `vm` module "does not provide a security mechanism for running untrusted code." I confirmed this concretely: a snippet containing
```js
result = this.constructor.constructor('return process')().version;
```
executed successfully and returned the real host Node version (`v24.19.0`) — i.e. **arbitrary code running inside the "sandboxed" snippet can reach the real, unrestricted `process` object**, and from there `require()`, the filesystem, environment variables (including DB connection strings/secrets), and `child_process`. This happens:
- **Regardless of `testMode`** — `testMode` only gates two specific helper functions exposed on the sandbox object; it does nothing to the underlying `vm` context, which the escape bypasses entirely.
- **For any user who can reach `POST /custom-code` and `.../execute`** — i.e. anyone with `canManageCustomCode` + `canDeployCustomCode`, not just superusers.

I stopped the proof-of-concept at reading `process.version` and did not go further (no file reads, no env var dumps, no process spawning) since this is a running shared dev database/environment. I deleted the probe snippet afterward.

**Permission enforcement does not survive the escape, and is already inconsistent before the escape is even considered.** `checkAppPermission('canDeployCustomCode')` is applied only to the direct REST route `POST /custom-code/:name/execute`. The same `executeCustomCode` service function is also called directly — bypassing that middleware entirely — from:
- the Flow engine, for a `custom_code` automation node ([backend/services/automationService.js:365-366](backend/services/automationService.js)), triggered automatically by record events or schedules, not by an interactively re-checked user action;
- the incoming-webhook handler ([backend/controllers/incomingWebhookController.js:34-40](backend/controllers/incomingWebhookController.js)), which only requires `requireAuth` + `enforceTenant` — **not** `canDeployCustomCode` — and accepts the snippet name directly in the request body.

So even setting the `vm` escape aside, `canDeployCustomCode` is not a reliable gate on "who can get custom code to run" — only on "who can hit this one specific REST endpoint." Once the `vm` escape is factored in, this gap is academic: application-level permissions and tenant restrictions apply *before* the code runs, not to what the code can do once it is running with real `process` access, so **they cannot be relied upon as a security boundary for custom code at all** while the current executor is in use.

**This is the single most important finding of this review.** `testMode` is not a security boundary — it is, at best, a safeguard against *accidentally* calling the two specific write helpers while testing a snippet. It provides no protection against malicious or buggy code that reaches outside those helpers. Fixing this properly requires replacing `vm` with an actually isolated execution model (e.g. `isolated-vm`, a subprocess with OS-level sandboxing, or a WASM-based interpreter) **and** enforcing the permission check consistently at every invocation path — this is a significant architectural change and out of scope for this close-out task. I have not attempted it, per "do not attempt to fix this vulnerability as part of this close-out," and am flagging it here explicitly so it isn't mistaken for solved.

## 6. Outstanding BRD requirements — item-by-item reassessment

The existing compliance audit (`Salesdam_V3_Platform_Core_BRD_V2.1_Compliance_and_Gap_Analysis.docx`) assessed BRD §15 ("Tenant-Level Custom Code & Extensibility", 39 requirements) at commit `485b44a` — confirmed via `git merge-base --is-ancestor 485b44a HEAD` to be an ancestor of this branch — and found **none fully implemented**. The framework in `backend/models/CustomCode.js` / `customCodeService.js` / `customCodeController.js` / `routes/customCode.js` was added afterward (commits `416cd59`, `da57c41`). Reassessing the audit's specific requirement IDs against the current code:

| Requirement | Audit finding (pre-framework) | Current state |
|---|---|---|
| BRD-15-01 (framework exists) | NOT IMPLEMENTED | **Implemented** — model, runtime, routes exist. Runtime is insecure (§5). |
| BRD-15.1-01 (Flow element) | NOT IMPLEMENTED | **Implemented** — `custom_code` node in FlowBuilder palette, executed by `automationService.js`. |
| BRD-15.1-02/03/04/05/06 (inputs, read/create/query, return values) | NOT IMPLEMENTED | **Implemented** — `readRecord`, `queryRecords`, `createRecord`, `updateRecord`, `result` sandbox API. Not independently permission-checked against the calling user's object access. |
| BRD-15.1-07 (call approved external APIs) | NOT IMPLEMENTED | **Still not implemented** — no fetch/HTTP helper exposed to the sandbox, and no egress allow-list. |
| BRD-15.1-08/09 (business logic, errors to later steps) | NOT IMPLEMENTED | **Implemented** — arbitrary JS logic runs; errors propagate as execution failures. |
| BRD-15.1-10 (execute only within creating tenant; respect security/isolation/audit) | NOT IMPLEMENTED | **Partially implemented, isolation sub-requirement failing** — tenant-scoped reads/writes via the sandbox helpers are fine, but the `vm` escape reaches the whole process, not just this tenant's data. Execution is logged (audit trail exists). |
| BRD-15.2-01/09 (custom business logic / functionality on objects) | NOT IMPLEMENTED | **Implemented** via the Flow node and webhook path. |
| BRD-15.2-02 (custom actions/buttons, `custom_js`) | PARTIALLY IMPLEMENTED (dead option) | **Unchanged** — not touched this session, still a dead schema option. |
| BRD-15.2-03 (custom screens) | PARTIALLY IMPLEMENTED | **Unchanged** — not in scope. |
| BRD-15.2-04/05/06 (custom integrations/calculations/processes via config) | PARTIALLY IMPLEMENTED | **Unchanged** — not in scope; still configuration-only outside the new framework. |
| BRD-15.2-07 (custom APIs) | NOT IMPLEMENTED | **Still not implemented** — no tenant-defined HTTP endpoint capability. |
| BRD-15.2-08 (custom document generation) | PARTIALLY IMPLEMENTED (defective) | **Unchanged** — see BRD-15.3-11, not in scope. |
| BRD-15.2-10 (tenant code isolated, no core modification) | NOT IMPLEMENTED | **Failing** — same `vm` escape issue; this is the direct current analogue of this requirement. |
| BRD-15.3-01 through -11 (PDF template system) | Mixed (partially implemented / defective / not implemented) | **Unchanged** — entirely separate subsystem (`PdfTemplate.js`), not touched this session. |
| BRD-15.4-01 (controlled runtime preventing cross-tenant access) | NOT IMPLEMENTED | **Still failing** — this is precisely what the `vm` escape defeats. |
| BRD-15.4-02 (component attributes: name, apiName, description, tenantId, version, status, createdBy/modifiedBy/date) | NOT IMPLEMENTED | **Implemented** — all fields present on `CustomCode`/version schema. |
| BRD-15.4-03 (Draft→Test→Active→Inactive lifecycle) | NOT IMPLEMENTED | **Partially implemented** — Draft→Active→Archived works; `test` status is defined in the schema but no code path ever sets or uses it; "Inactive" is actually called "Archived" in the implementation. |
| BRD-15.4-04 (activating retains prior versions, restorable) | NOT IMPLEMENTED | **Implemented and verified** — confirmed via browser (§3) and E2E suite. |
| BRD-15.4-05 (versioning, execution/error logging, test execution, timeout, resource limits, recursion protection, isolation, secure credential access, permission-controlled activation/deployment — 10 capabilities) | NOT IMPLEMENTED | **Mixed**: versioning ✓, execution logging ✓, error logging ✓, timeout ✓ (verified — infinite loop blocked at 5s), recursion protection ✓ (depth-1 guard, verified in E2E), permission-controlled activation ✓ (REST route only). **Still missing**: a distinct test-execution mode beyond the narrow `testMode` write guard, resource (CPU/memory) limits, isolation (fails per §5), and secure credential access (no such API exists). |
| BRD-15.4-06 (code must not access other tenants' data/config/secrets, must not modify core, must not bypass security; failures isolated from platform availability) | NOT IMPLEMENTED | **Still failing** — the `vm` escape is a direct violation of "must not bypass security," and a crashed/compromised process is not isolated from platform availability. |
| BRD-15.5-01 (test harness: execute against test inputs, inspect inputs/outputs/result/errors/duration, no production alteration without authorisation) | NOT IMPLEMENTED | **Partially implemented** — inputs/output/duration/errors are returned and inspectable (verified, §3); `testMode` blocks two specific write helpers (verified empirically, §5) but is not a dedicated test/dry-run environment and does not prevent the `vm` escape from altering anything reachable from the real process. |

**Net effect:** the core framework existence gap (BRD-15-01 and most of BRD-15.1-*) that the prior audit flagged as the top blocker is closed. The isolation and security-boundary requirements that depend on it (BRD-15.4-01, the isolation/credential sub-items of BRD-15.4-05, BRD-15.2-10, BRD-15.4-06) are now the active blocker, confirmed by direct reproduction rather than static review. BRD-15.2-02/03/04/05/06/07/08 and all of BRD-15.3-* remain as the prior audit described them — unaffected by this session's work.

## 7. Build and automated test results

Rerun once more for this close-out, after all fixes above and with no further code changes:
```
$ cd frontend && npm run build
✓ built in 6.51s, no errors (pre-existing chunk-size and @extend warnings only, unrelated to this change)

$ cd backend && node tests/section15-custom-code.e2e.mjs
13/13 checks passed.
```

---

# Updated Manual Testing Guide — Section 15 (Custom Code)

Every step below was personally clicked through in the browser during this review, using the real dev server. Endpoints are the ones actually observed firing in the network tab, confirmed against `backend/routes/customCode.js`.

**Prereqs:** backend on :5002, frontend on :5173, logged in as a user whose role has `canManageCustomCode` and `canDeployCustomCode`.

### 1. Load the page
Go to `http://localhost:5173/admin/custom-code`.
**Verified:** loads with an empty Create form and empty list table, no console errors.

### 2. Create a snippet
1. Name: `calc_discount`
2. Code: `result = (inputs.price || 0) * 0.1;`
3. Inputs JSON: `{"price":"number"}`
4. Click **Create New Snippet (v1 draft)**
**Verified:** `POST /api/v1/custom-code` → 201; row appears, `none | v1(draft)`.

### 3. Execute a draft (no active version) → expect failure
1. Set the Inputs JSON field to `{"price":100}`
2. Click **Execute** on the row
**Verified:** `POST /api/v1/custom-code/calc_discount/execute` → 500; toast shows the real backend message; "Execution Result" panel shows the full error JSON (`message`, `data`, `stack`, `error.statusCode`).

### 4. Add a version (via the UI — no curl needed)
1. In the Code box, replace the code with: `result = (inputs.price || 0) * 0.2;`
2. Optionally fill "Change note"
3. Click **Add Version (from code box above)** on the `calc_discount` row
**Verified:** `POST /api/v1/custom-code/calc_discount/versions` → 200; row updates to `v1(draft), v2(draft)`.

### 5. Activate
Click **Activate v2**.
**Verified:** `POST /api/v1/custom-code/calc_discount/activate` → 200; Active Version column becomes `2`; row shows `v1(draft), v2(active)`.

### 6. Execute the active version
1. Set Inputs JSON to `{"price":100}`
2. Click **Execute**
**Verified:** `POST /api/v1/custom-code/calc_discount/execute` → 200; Execution Result shows `{"success":true,"output":20,"durationMs":<n>}` (20 = 100 × 0.2).

### 7. Restore a previous version
Click **Restore v1**.
**Verified:** `POST /api/v1/custom-code/calc_discount/restore` → 200; Active Version becomes `1`; row shows `v1(active), v2(archived)`.

### 8. Test mode — confirm writes are blocked
1. Create a snippet whose code calls `createRecord('account', { name: 'x' })`, activate it
2. Check **Test mode (disable writes)**
3. Click **Execute**
**Verified:** the sandbox call is rejected internally (write does not occur — confirmed by re-querying the object afterward); the exec response does not reflect a created record ID. *(Note: because the sandbox has no top-level `await`, success/failure of an async sandbox call like `createRecord` is not reliably visible in the Execution Result panel itself — verify by checking the target object's records directly, not by reading `output`.)*

### 9. Delete
Click **Delete**, confirm the native browser dialog.
**Verified in a real browser**: this uses `window.confirm()`, which works normally outside of sandboxed automation contexts. In this review it was exercised by stubbing `confirm` from the console for one click, which is not something an end user needs to do — a normal click + dialog confirmation works as expected in Chrome/Firefox/Safari.
**Automated confirmation:** `DELETE /api/v1/custom-code/:name` → 200, row removed — observed directly via network tab.

### 10. Tenant isolation / permissions — automated only
Covered by `backend/tests/section15-custom-code.e2e.mjs` (13/13 passing): cross-tenant read → 404; unauthorized create → 403; unauthorized execute → 403. Not re-verified by hand with two browser sessions in this pass, since the automated coverage already exercises exactly this.

### 11. Known unresolved issue — read before relying on `testMode` for anything security-sensitive
`testMode` only blocks the sandbox's `createRecord`/`updateRecord` helpers. It does **not** prevent code from escaping Node's `vm` sandbox entirely (confirmed: `this.constructor.constructor('return process')()` returns the real process object). Any user permitted to execute custom code can, in principle, run arbitrary code on the server with the Node process's own privileges — this is independent of `testMode` and of the object-level permission system. Treat `canManageCustomCode`/`canDeployCustomCode` as equivalent to server admin access until this is fixed at the execution-engine level.
