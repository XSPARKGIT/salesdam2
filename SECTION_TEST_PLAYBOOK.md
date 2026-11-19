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
