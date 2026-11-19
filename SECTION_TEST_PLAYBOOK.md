# Section test playbook

How to run a BRD section through the application and come out with a client-ready
test manual, without burning credits doing it.

Written after Section 3 (Object & Field Metadata Engine), which produced
`X Spark - Salesdam Metadata Engine Test Manual.docx` — 32 tests, 11 pages, six
green test suites and two commits of product fixes. Sections 4–24 are still to do.

---

## 1. Model and effort

The model matters less than the volume. Pick per phase rather than per section.

| Phase | Model | Effort | Why |
|---|---|---|---|
| Clicking through screens, reading pages, recording what you saw | **Sonnet 5.5** | medium | Mechanical and high-volume. This is most of the work by token count. |
| Diagnosing *why* something is broken | **Opus 5** | high | Section 3's root cause was Joi `stripUnknown` silently dropping fields — three layers below the symptom. A cheaper pass patches the controller and declares victory. |
| Writing the manual's prose | **Opus 5** | medium | It goes to a client. The difference between a checklist and something readable is judgement. |
| Building the .docx | **any** | low | Deterministic — the scripts in `tools/manual-docx/` do it. |

**Don't use Haiku for the manual.** It will be technically complete and you will rewrite it.

**Don't run everything at high effort.** Section 3 needed high effort for roughly
four debugging stretches and medium for everything else. Running the whole thing
high is paying detective rates for stocktaking.

---

## 2. Session hygiene — the biggest lever

**One session per section. Not one session for 4–24.**

Every turn re-sends the whole conversation. A session that has already walked
Sections 4 through 9 carries all of it on every turn of Section 10, pays for it
repeatedly, and buys nothing. The Section 3 session ran long enough to be
summarized, and everything after that point was paying for history it no longer needed.

End the session when the section's manual is done. Start the next one fresh.

---

## 3. Token discipline

- **Prefer `read_page` and `get_page_text` over `screenshot`.** Every screenshot is
  an image in context and costs far more than the text equivalent — which usually
  tells you more anyway, since it gives you `ref_N` handles you can click.
- **When you do screenshot, pass `scale: 0.5`.** Quarter the tokens, still legible
  for layout checks. Coordinates stay in the full-resolution frame either way.
- **Batch predictable steps** with `browser_batch` — navigate, click, type, read in
  one round trip instead of four.
- **Don't re-read files you have already read** in the same session.
- **Navigating the pane (or a Kanban/Calendar toggle) reloads the page and drops `window.__api`.** Re-define it inline at the top of every `javascript_exec` instead of relying on it. Server-side session workspace (`POST /workspaces/switch`) must match the pane's `localStorage.activeWorkspaceId`, or records answer 403 / the page shows the app picker.

---

## 4. The toolchain (`tools/manual-docx/`)

Already built and reusable. Do not re-derive the house format from the PDF —
that alone took a meaningful slice of the Section 3 session.

```
tools/manual-docx/
  section3-test-manual.html   reference: the structure every manual follows
  extract.py                  HTML -> blocks.json
  build.js                    blocks.json -> plain .docx (docx-js)
  cover.py                    splices in the X Spark cover + logo + date
  package.json                docx ^9.15.4
```

### Running it

`node_modules` is not committed. Once per machine:

```bash
cd tools/manual-docx && npm install
```

Unpack the house reference document, which `cover.py` takes the cover artwork from:

```bash
mkdir -p /tmp/xspark-ref && unzip -q -o tools/manual-docx/assets/xspark-house-reference.docx -d /tmp/xspark-ref
```

> That reference is the shipped Automation Step Runbook. The cover and logo are EMF
> graphics lifted straight out of it, so the front matter is byte-identical to the
> house document rather than a re-creation. `cover.py` only needs its
> `word/document.xml` plus `word/media/image1.emf` and `image2.emf`, so any X Spark
> `.docx` carrying the same cover would also serve.

Then, per section — run these from `tools/manual-docx/`:

```bash
python3 extract.py sectionN-test-manual.html
```

```bash
MANUAL_TITLE="Page Layout Test Manual" MANUAL_FILE="Page-Layout-Test-Manual.docx" \
MANUAL_DESCRIPTION="Client acceptance script for BRD Section 4 — Page Layout & UI Configuration." node build.js
```

```bash
rm -rf mine && mkdir mine && (cd mine && unzip -q -o ../Page-Layout-Test-Manual.docx)
```

```bash
python3 cover.py /tmp/xspark-ref mine Page-Layout-Test-Manual.docx "19 November 2026"
```

`extract.py` writes `blocks.json`; `build.js` reads it and writes the base `.docx`
(its title, filename and description come from the `MANUAL_*` variables, so the
script itself never changes per section); `cover.py` reads that unpacked copy in
`mine/`, splices the front matter in and repacks over the same filename.
Everything except `assets/` and the scripts is derived and gitignored.

The HTML manual is generated, not hand-written: reuse
`section3-test-manual.html` as the page shell (its CSS and tick-box script) and
swap in the new masthead and tests. Verified end to end for Sections 3 and 4.

### Checking the output

There is no LibreOffice on this machine, but Word is installed and scriptable. **Two
rules, learned the hard way:**

1. **Never use `active document` or close anything you did not open.** Word may already
   have the person's own documents open; "active" can be theirs, and closing it with
   `saving no` discards their unsaved edits. Address your own copy **by name**.
2. **Render from the scratchpad, not the repo.** Word's sandbox can stall on a
   file-access prompt for a new folder; a copy under the session scratchpad opens
   without one. Use a **uniquely named copy each time** — Word caches by filename and
   will hand back a stale PDF.

```bash
D=/path/to/scratchpad; N="render-$(date +%H%M%S)"; cp Manual.docx "$D/$N.docx"
osascript -e 'with timeout of 600 seconds
tell application "Microsoft Word"
  open POSIX file "'"$D/$N"'.docx"
  set myName to "'"$N"'.docx"
  repeat 40 times
    if (exists document myName) then exit repeat
    delay 1
  end repeat
  set d to document myName
  save as d file name POSIX file "'"$D/$N"'.pdf" file format format PDF
  close d saving no
end tell
end timeout'
```

Run it in the background (it can take a few minutes), then rasterise with PyMuPDF and
look at the pages. Check that the PDF is the document you meant — the footer names it.

---

## 5. The manual's structure

`section3-test-manual.html` is the contract. Keep to it and `extract.py` works unchanged:

- `<h2>` — a Part
- `<p class="sec-note">` — the BRD range and what the Part covers
- `<div class="callout">` / `.callout.warn` — setup and cautions, with `<h3>`, `<ul>` or `<dl class="creds">`, optional trailing `<p>`
- `<div class="test">` — number + title in `<span class="t">`, BRD refs in `<span class="ref">`, `<ol class="steps">`, `<div class="expect">`
- `<div class="aside">` — background that is not itself a step

Tests are numbered continuously across Parts. Label them by the problem they prove,
not by the mechanism — the same convention as the automation runbook.

---

## 6. Things that cost time in Section 3

Worth knowing before they cost it again.

**Setup and environment**

- **A new object is invisible until it is added to a workspace.** Setup → Workspaces
  → Insurance → Objects. Otherwise: "This object isn't available". This bit twice.
- **Page loads take 10–30s.** The app runs locally but the database is remote Atlas
  (~70–190ms per round trip, 3.9s to connect). Environmental, not a product fault —
  a non-DB backend route answers in 0.3s. Don't chase it as a bug.
- **Writing temp files into `backend/` restarts nodemon**, which drops the request
  you were in the middle of. Keep scratch scripts outside the watched tree.

**Driving the UI**

- **Setting a `<select>` via injected JS does not fire React's `onChange`.** It looks
  like it worked and the value silently reverts. This produced a false bug report
  that took a while to retract. **Use `form_input` for every select.**
- Native value setter + `input`/`change` dispatch is fine for text inputs.

**Browser tools (Section 4)**

- **`read_page` on the layout builder dumps ~50 workspace options** (the workspace
  selector) — expensive. Use `find`, or scope with `ref_id`.
- **A top-level `return` in `javascript_exec` makes the tool report `undefined`**
  even though the code ran. Wrap in `(async () => { … })()` and return from that.
- **The pane can be tiny (~700×300).** The app drops to a compact layout with a
  slide-over sidebar that swallows keystrokes and shifts click targets. Prefer DOM
  clicks and `form_input`; don't trust coordinate clicks or screenshots there.
- **Pointer and keyboard input cannot start a drag** in this environment.
  `@hello-pangea/dnd` (layout builder): find `onDragEnd` on the React fiber and call it
  with a real drop result. HTML5 drag (Kanban): dispatch `DragEvent`s carrying a
  `DataTransfer`. Both exercise the app's own drop handler. Mark the gesture itself as
  "needs a person" in the manual rather than claiming it was driven.
- **Calling the API from the page:** the backend is `http://localhost:5002` (it is
  `VITE_API_URL`; Vite's `/api` does not proxy). Cookie session plus an `X-Tenant-ID`
  header from `localStorage.tenantId`. A small `window.__api(method, path, body)` makes
  fixtures cheap and goes through the real validators.
- **Existing e2e suites are the cheapest regression net.** For layouts, assignment,
  action buttons and saved views: `layout-assignment`, `layout-assignment-changeset`,
  `action-buttons`, `section10-search-views`. macOS has no `timeout` command.

**Data shapes (Section 4)**

- **The records API returns flat records with `id`**, not `{ data: {…} }` and not
  `_id`. Code that reads `record.data[...]` or `record._id` silently finds nothing —
  this is why the generic calendar never showed an event.
- **"Required" is two flags:** `isRequired` and `validations.required`. Any logic about
  required fields must check both (`isFieldRequired` in `utils/layoutBackfill.js`).
- **Selects:** setting `select.value` directly fails, but the native prototype setter
  plus a bubbling `change` event works with React. Verify by reading the state back.

**Diagnosing**

- **Joi runs with `stripUnknown: true`.** A field absent from the schema is deleted
  from the body before the controller ever sees it, with no error. If a saved value
  silently reverts to its default, check `backend/utils/validators.js` *first* — the
  controller will look innocent.
- **Check the function the button actually calls** before patching a similarly named one.
- **Date fields are BSON `Date`.** Comparing them against a caller's string never
  matches. Same class of bug may exist elsewhere.
- **Prove a failing test is pre-existing** (stash your changes and re-run) before
  assuming you caused it.

---

## 7. Brief for a new section session

Start fresh, paste this, fill in the section:

> Test BRD Section N against the running app (backend :5002, frontend :5173,
> workspace **My Company → Insurance**). Click through every requirement, fix what
> is simply fixable and state plainly what is not and why.
>
> Then write the client manual as HTML following the same structure as
> `tools/manual-docx/section3-test-manual.html`, and build the .docx with the
> generator in `tools/manual-docx/` — `extract.py`, then `build.js`, then `cover.py`
> for the X Spark cover. Read `SECTION_TEST_PLAYBOOK.md` first.
>
> Create any test data the manual needs, and make the manual use those records.
> Label tests by the problem they prove.

---

## 8. Where Section 3 ended

Done and committed on `feature02` (`cbecaf1`, `b9c534e`). Six suites green:
duplicate-detection 21/21, record-merge 23/23, insurance-metadata 9/9,
global-value-set-picklist 8/8, validation-evaluation 18/18,
workspace-object-isolation 31/31.

Fixture left in place for the client: `POL-00001` with three insured lives
(Thabo Mokoena, Naledi Mokoena, Lesedi Mokoena), objects `policy` and `insured_life`.

Deliberately out of scope, listed at the end of the manual:

- **§3.4.17–3.4.19** — duplicate detection via Data Import, API and integrations.
  Verified structurally: all five entry points share `duplicateDetectionService.check`.
- **§3.4.22** — record merging by hand (its suite passes 23/23).
- **§3.3.3–3.3.4** — the Type field driving layouts, required fields and flow
  branching. Belongs with Sections 4, 6 and 7.

**Expect the ratio to shift from Section 4 onwards.** Flows, approvals, security and
integrations are far more interlinked than the metadata engine — more time debugging,
less time clicking, so budget a larger share of Opus than Section 3 needed.

---

## 9. Where Section 4 ended

**Tested:** all of §4.1–§4.4 through the UI, plus the four existing suites (layout
assignment 19/19, its change-set 15/15, action buttons 24/24, saved views / Kanban /
calendar 36/36). Manual: 28 tests, `tools/manual-docx/section4-test-manual.html`.

**Fixed along the way** (all uncommitted until you say so):

- 3-column sections (schema, builder, and the two places that assumed two columns).
- Layout-level Required / Read-only per field, plus a per-field visibility condition
  (shared `ConditionEditor`). Layouts can tighten a requirement, never relax one.
- Conditional visibility was ignored on *create* forms; hidden fields no longer block saving.
- A "simplified" layout could not omit fields — the form re-added every missing one.
  Now only fields the builder cannot place (auto-number, formula, read-only) and
  required fields are added back (`utils/layoutBackfill.js`).
- Related lists: per-layout selection, order, heading, columns, default sort, default
  filters, rows and New/Edit/Delete buttons (`RelatedListsPanel.jsx`).
- The generic calendar showed no events and linked to `/undefined` (flat-record shape).
- `POST /layouts` spread the request body after `tenantId` — a cross-tenant write.

**Left for a person:** the drag gestures themselves (layout builder, Kanban card), and
layouts as the Administrator / Standard User / Read Only profiles (one user exists).

**Known and not fixed:** Kanban cards show the Record Owner as a raw id; default
filters are not applied to many-to-many related lists; layout-only Required /
Read-only rules are UI-level, not enforced by the API.

---

## 10. Where Section 5 ended

**Tested:** all of §5.1–§5.3 through the UI, plus the `app-access` (26/26) and
`workspace-object-isolation` (31/31) suites. Manual: 15 tests,
`tools/manual-docx/section5-test-manual.html`. In this product an **App is a
Workspace** — look under Setup → Workspaces, Roles and Permission Sets.

**Already built before Section 5:** App attributes, shared objects, the App
switcher with App-scoped navigation, default landing (including a Home option) and
App access through Roles and Permission Sets. The existing suites prove the access rules.

**Fixed:** an App's tab order. The sidebar sorted by the object's own global `navOrder`,
so a shared object sat in the same slot in every App. It now follows the App's own
object list, and the Objects tab has Move up / Move down.

**Fixtures created:** Broker object, **Broker Desk** App (Brokers, Policies; lands on
Brokers), Insurance reordered (Policies, Insured Lives; lands on Policies), and the
**Broker Desk Access** permission set (nobody assigned).

**Worth knowing for next time**

- Slow database means lists look empty for 10–30 s. **Poll for content** in
  `javascript_exec` instead of guessing a wait; two "bugs" this session were just that.
- `window.confirm` is auto-declined in the pane, so a delete that uses it cannot be
  clicked through; use the API and say so in the manual.
- Switching Apps refetches the object list; the nav takes 2–3 s to settle.
- A page's controls can be huge (the icon picker is dozens of unnamed buttons); filter
  your DOM dumps instead of listing every control.
- Existing Apps' sidebar order now follows each App's object list; if an App was set
  up in an arbitrary order, that is the order people will now see.

---

## 11. Where Section 6 ended

**Tested:** all of §6.1–§6.2 through the UI (rule list, add/edit/toggle, formula
builder, create/update/inline-edit/delete on Policy, top-of-record and per-field
errors, `CONFIG("deals.minimum_value")` via Setup → Configuration), plus the suites
`validation-evaluation` 18/18, `validation-rules` 22/22, `section20-validation-rule-audit`
29/29, `section15-custom-code` 13/13, `section12-import-export` 15/15, `section14-config`
14/14, `configuration` 18/18 and `remediation.validationService` 13/13. Manual: 18 tests,
`tools/manual-docx/section6-test-manual.html` (built from the Section 5 page shell by a
small throwaway script; the HTML is the source).
`flow-definition` is 24/25 — one scheduled-trigger check fails the same way on a clean
copy of HEAD, so it is not from this work.

**Already built before Section 6:** rule model and tab, ISCHANGED, CONFIG, enforcement
on create/update/import/merge/inbox/flows/webhooks, all-failures-together reporting.

**Fixed (uncommitted):**
- A rule naming a field that does not exist (a typo) was accepted and silently never
  fired. Now refused on save and flagged live in the builder (`knownFields` option on
  `validateFormula`; rules only — formula fields unchanged).
- Custom-code `createRecord` / `updateRecord` bypassed rules; now blocked.
- Two suites needed updating (`section20` fixture fields; new checks in `validation-rules`).

**Fixtures left:** seven rules on Policy (Funeral Plan link, ISCHANGED policy number,
premium > 0, start date not future, Credit Life premium cap at top of record, inactive
Province rule, CONFIG minimum). POL-00004 got a document link and POL-00003 a commission
rate so earlier manuals still save. The Credit Life rule was deliberately written on
premium (not commission) because Section 4's POL-TEST-NEW step saves a Credit Life policy
without one. Recycle Bin holds soft-deleted test records. `deals.minimum_value` is at its default.

**Known and not fixed:** insurance-module system writes (`services/insurance/*`) and
other internal writers (tenders, facebook leads, deal/quote conversion, recurring tasks)
do not run rules; admin import "bypass validation" skips them by design; layout-required
fields are reported before rules; the POL-00003/00004 `policy_status` was set to Active
while checking edits (earlier value not recorded).

**Lessons**
- A new rule can shadow older fixtures: re-check every earlier manual's edit/create steps.
- Layout-required fields and field defaults (Province defaults to Gauteng) hide a rule —
  pick a rule field with no default and no layout requirement.
- Rules use `==`, not `=`; the save refuses `=` with a clear message.
- The custom-code sandbox does not await scripts; a blocked write shows as a rejection
  inside the script, so probe it with try/catch plus a visible marker write.
- The in-pane record Delete is an in-page modal (clickable); only rule delete uses `window.confirm`.
- `git archive HEAD backend` into the scratchpad (symlink `node_modules`, copy `.env`) is
  a safe way to prove a test fails without your changes — never stash.

---

## 12. Where Section 8 ended

**Tested:** all of §8.1–§8.7 through the UI (process list, editor, entry-criteria formula
and `CONFIG("approvals.threshold_amount")`, picker for several matching processes, Active /
Inactive, submit, lock badge, approve with comment, reject with required reason, recall,
My Approvals, bell notifications), plus suites `approval-process` 43/43, `approval-builder`
55/55, `approver-group-changeset` 9/9, `validation-evaluation` 18/18, `record-merge` 23/23.
`insurance-approval` is 2/16 and fails identically on a clean copy of HEAD: its login uses a
non-email username (`insapr_…`) and login is now email-only, so every call is 401. Stale test,
not from this work; it should log in with the user's email like `approval-builder` does. Manual: 22 tests,
`tools/manual-docx/section8-test-manual.html` (built from `gen8.py`-style generator off the
Section 6 shell; the HTML is the source). Almost all of §8 was **already built**.

**Fixed (uncommitted):**
- Bulk delete and merge ignored the approval lock (single edit/delete returned 423, bulk
  delete deleted a locked record). `lockedRecordIds` in `approvalProcessService`, used by
  `bulkDelete` and `recordMergeService`.
- Approval screens showed "Failed to submit…" instead of the server's reason (e.g. "No manager
  could be found…"): the shared `api` rejects with `{message,status,data}`, not an axios error,
  so `err.response.data.message` is always undefined. Fixed in ApprovalPanel, the process
  list/editor, approver groups and LeadApprovalSettings. **Other screens likely have the same
  pattern** — grep `err.response?.data` before trusting any error toast.

**Fixtures left:** object **Claim** (auto-number CLM-, in Insurance), processes Claim Manager
Review / High Value Review / Referral Review, group Claims Panel, flow *Claim Approval Stamp*,
roles Claims Manager (parent) and Claims Handler, Approval Threshold Amount = **1000**
(company value; platform default is 0), claims CLM-00001…00008 (S8-001…S8-008), two test users
(sec8.submitter / sec8.approver @example.com) **deactivated**. Policies untouched.

**Worth knowing**
- Non-admin roles cannot supply the object's *name* field (always read-only) — an object that
  non-admins create records on needs an **auto-number** name. The name field's type cannot be
  changed afterwards (system field); delete and recreate (`DELETE /objects/x?force=true`) which
  also strips the object from roles' permissions. Role object permissions need
  `fieldPermissions` entries with `canEdit`, or every field is stripped.
- Set a user's role with `POST /roles/assign`, not `PUT /users/:id` (silently ignored).
  Lookup-to-user fields: create the field, then `PUT` it with `lookupObjectApiName: 'user'`.
- The device's `activeWorkspaceId` in localStorage overrides the server session's workspace; an
  object outside it renders a **blank page**. Set it before opening records.
- A partial `PUT` of a record fails required-field checks; the UI edit form sends the whole record.
- Recall uses `window.confirm` (auto-declined): override `window.confirm=()=>true` then click.
- With one real user, a second/third person was simulated by real test users driven through the
  API from a scratch script (`as.mjs`: login with a cookie cache; password kept in a 0600 file).
- Always filter scratch DB reads by `tenantId` — other tenants hold same-named objects (`claim`).
- The Lead Approval built-in process is only seeded for tenants with a `lead` object.

---

## 13. Where Section 9 ended

**Tested:** all of §9.1–§9.4. Admin screens clicked (Roles list, Role form tabs, field-level panel, New Role, Permission Sets, Sharing Settings with the rule table); everything that needs a *second person* proven through the API as real test users (`s9.*@example.com`, created in the app) with scratch scripts `p1/p2/p3.mjs` (OWD Private / Public Read-Only / Public Read-Write, manager chain, Funeral Plan rule to a group, field Visible/Read-only/Hidden on detail, list, write, export, search, suggest, all 18 system permissions one at a time, Permission Set, independence from object access, call recordings, secure-by-default object and field). Suites: `system-permissions` 49/49 (7 new checks), `sharing-model` 58/58 after a fixture fix, `app-access` 26/26, `workspace-object-isolation` 31/31, `section10-search-views` 36/36, `section12-import-export` 15/15, `activity` 17/17, `telephony` 16/16, `csv-roundtrip` 11/11, `omnichannel` 42/42. Manual: 38 tests, `tools/manual-docx/section9-test-manual.html` (generated by a throwaway script off the Section 8 shell).

**Already built before Section 9:** Role/PermissionSet models, 21 system permission keys, `checkAppPermission` on nearly every admin route, OWD / hierarchy / sharing rules / public groups (approver groups), secure-by-default object and field provisioning, App Access.

**Fixed (uncommitted):**
- **Call recordings (9.3.17) were unprotected:** the permission was stored, nothing checked it. `redactCallRecordings` strips `metadata.recordingUrl` from activity list/timeline/get/update and call history.
- **Export / Import Data (9.3.14/15) were not enforced on the per-object routes** (`/records/:o/export|import` needed only the object-level right). Both system permissions are now required too.
- **Search leaked hidden fields (Medium-High):** global search returned every field of a matched record and matched by hidden-field text; suggestions could probe a hidden field. Fixed in `searchController.js`.
- **Admin screens were gated by role *name*** (`requireAdmin`), so a Profile holding e.g. Manage Users passed the server but was bounced home by the UI. ~42 routes in `App.jsx` and the Setup sidebar now use the matching system permission; Audit Logs and Email Templates use their own. Checked as admin only; not clicked as a permission holder.
- Test fixtures: `sharing-model` editor role needed `canExportData`; `system-permissions` gained export/import/recording checks.

**Fixtures left:** object **S9 Case** (not in Insurance; Insurance restored to Policy, Insured Life, Claim), roles S9 Agent / Reader / Exporter / Customizer, group S9 Funeral Team, seven test users `s9.*@example.com` **deactivated** (password was random, kept only in the session scratchpad). Cases are in the Recycle Bin. OWD for every object is back to Private.

**Known and not fixed:** a non-admin's write to a record they can see but may not edit answers 404, not 403 (hides existence; deliberate). Administrator / Super User show all-off ticks in the Profile form but bypass them. Webhooks/Analytics are extra permissions beyond the BRD's 18. `/admin/email-senders`, backups, incidents, custom-screen pages are still `requireAdmin`. The second-user UI could not be clicked: the pane cannot be signed in as two people (CORS blocks `127.0.0.1`; signing out would lose the admin session whose password nobody has) — use private windows.

**Lessons**
- With one real user, add an *Administrator* test user too, so scripts can set up and tear down without the pane; keep every password out of transcripts by serving it from a localhost one-shot (`pwserve.py`) to the pane.
- The records API takes **flat** bodies (`{reference: …}`), not `{data:{…}}`; Read-only fields are silently dropped on create, so identify fixtures by auto-number or id, not by a read-only field.
- A new permission check on an old route can break old test fixtures: `sharing-model` failed once for exactly that reason.
- Scripts that poll the DB through the remote Atlas take 1–2 minutes; run them in the background and read the file.

---

## 14. Where Section 10 ended

**Tested:** §10.1 by API from the page on a throwaway object (searchable object/field on/off, new field, rename, delete/restore, App boundary), §10.3 on that second object in the UI (Kanban columns and December calendar read from the page), §10.2 saved view with filter/columns/sort via API. Suites: `section10-search-views` 36/36, `action-buttons` 24/24. Manual: 14 tests, `tools/manual-docx/section10-test-manual.html` (generated by a throwaway script off the Section 9 shell; overlaps Section 4, which is cited, not repeated).

**Already built:** global search is fully metadata-driven (no object names hardcoded), object and field Searchable flags, saved views, Kanban/Calendar config.

**Fixed (uncommitted):** the field form had **no Searchable toggle** (the flag existed only in the API) — added to `FieldModal.jsx`; deleting an object left its saved list views and recently-viewed rows behind — now cascaded in the `ObjectMeta` pre-deleteOne hook (rename still does not migrate list views); turning a field's Searchable **off**, or deleting a searchable field, left the old text matching until each record was re-saved (`fieldController.js`); records written by flows, custom code, inbox, conversions and insurance services never got search text (new `pre('save')` hook in `models/DynamicRecord.js`, checked with a scratch save).

**Known and not fixed:** search matches whole words only (`Zephy` finds nothing; Mongo `$text`); the list header still hardcodes `task` (Recurring Task, Calendar shortcut), `quote`/`invoice` (no New) and `policy` (New goes to the application flow); native action buttons are forced to `record_detail`, only flow/screen-flow buttons can sit on lists; writers that use `insertMany`/`updateOne` bypass the hook.

**Lessons:** a new object needs adding to the workspace *and* the session workspace must match; objects are deleted with `DELETE /objects/x?force=true`; an action-button `location: record_list` on a native action is silently normalised to `record_detail` (by design, not a bug).

**Second pass (manual walked literally in the UI):** wording corrected from the screen — the sidebar item is **Object Settings** (not Object Manager); workspaces are at `/workspaces` (not under Setup); the object switch is **Allow Search**; list-view sort comes from clicking the column header (once ascending, twice descending) and columns from **Choose columns**, then **New List View…** saves both; Kanban/Calendar pickers only offer picklist/date fields. Field delete uses `window.confirm` (marked Needs a person); object delete is a typed-name modal. Re-indexing takes several seconds on the remote DB and the top-bar box ignores a repeated identical query, so search a different word or wait. Suites after the `DynamicRecord` pre-save hook: section10-search-views 36/36, action-buttons 24/24, record-merge 23/23, section15-custom-code 13/13, duplicate-detection 21/21.

---

## 15. Where Section 11 ended

**Tested:** §11.1–§11.3. Clicked in the report builder on Insured Life / Policy (all five functions, group-by, filter, roll-up totals, save and reopen, one-level cross-object by Policy Number and Status), Analytics Quick Report and dashboard widgets (figures checked against the data), Allow Reports off. Suites: `section11-reporting` 91/91 (grown from 54), `app-access` 26/26, `sharing-model` 58/58. Manual: 13 tests, `tools/manual-docx/section11-test-manual.html`.

**Already built:** `/reports/run` with aggregates, filters, one-hop `crossObject`; saved reports; dashboards; the same five functions as roll-ups everywhere.

**Fixed (uncommitted):** `/reports/run` ignored Allow Reports, field security and the related object's record visibility, never checked that the lookup field really was a relationship, and interpolated the function name into a Mongo operator (operator injection) — new `utils/reportGuards.js`; View/Manage Analytics now gate `/reports` (they were stored but unchecked); **dashboard `widget-data` checked nothing** (no Read, no record visibility, no Allow Reports, no field security) — now guarded; the widget object picker only offered the current App's objects; Analytics Quick Report swallowed errors (now shows the message) and accepted any lookup text; a cross-object group is labelled with the related field; Min/Max wording aligned.

**Known and not fixed:** `/analytics/report` stays Read-based (BRD 5.3, proven by app-access), so View Analytics gates only the `/reports` API and the menu; lookups to User cannot be followed one level (Users are not a reportable object) and grouping on them shows ids; dashboard widgets are single-object; no fixture Lookup between reportable objects (the suite builds one); the table header for an ungrouped count reads "Category".

**Lessons:** the pane can read 0x0, so recharts draws nothing: `resize_window` 1200x800 then read `svg text` (reset afterwards); the pane once bounced to /login after backend restarts although the session was valid, so just navigate again; `extract.py` drops `<div class="aside">`, so use a `callout warn` for caveats; `/reports/run` and `/analytics/report` are two separate runners, change both.

---

## 16. Where Section 12 ended

**Tested:** §12.1–§12.3 on a throwaway object **S12 Lead** (auto-number name, Company required, Score, Stage, Start Date, Policy lookup, Internal Notes, formula Double Score, a rule and a record-triggered flow). Clicked: Data Import (new field appears after ↻ Refresh fields, header auto-match, required-column notice, default import with per-row reasons, admin bypass) and Data Export (subset, filter, JSON, all fields) by dropping a `File` on the drop area and capturing the export `Blob` via `URL.createObjectURL`; non-admin and hidden-field cases by real test-user requests (`na.mjs`). Suites once each: `section12-import-export` 15/15, `csv-roundtrip` 11/11, `duplicate-detection` 21/21. Manual: 12 tests, `tools/manual-docx/section12-test-manual.html`.

**Already built:** mapping reads live fields; `fields=` export param with field security; admin-only bypass (403 for others) that skips **validation rules and flows** (not type/required/duplicate checks) and is audited (`bypassValidation`).

**Fixed (uncommitted):** Data Import page was **blank** (`fileRef` never declared); calculated fields offered as mapping targets (now hidden, auto-match skips them); import checked editable-field security only when the UI sent a mapping, not for header auto-match (API); **formula columns exported empty** (now computed in all three export paths; the screen no longer hides formula fields); Import/Export error toasts read `err.response.data.message` (now `err.message`); "create or update" wording; Audit Logs screen had no **Details** column (bypass flag was invisible).

**Known and not fixed:** non-admins cannot import into an object whose name field is Text (name is read-only to them); dates must be ISO and picklists case-exact; export column order follows field order, not tick order; roll-up fields are not exportable; the page's CSV preview splits on commas (quoted commas in a header misalign the preview only).

**Lessons:** the first `select` on admin pages is the tenant switcher: find the object select by its options; the file chooser and `window.confirm` cannot be driven, but a dropped `File` and `window.confirm=()=>true` exercise the same handlers; a role cannot be deleted while a (deactivated) user holds it.

**Left behind:** role *S12 Importer* (held by deactivated user s12.importer@example.com). Object, records, flow deleted.
