s=open('section13-test-manual.html').read()
head=s[:s.index('<div class="wrap">')].replace('Deployment Test Manual','Custom Code Test Manual').replace('Deployment and Environments','Custom Code and Extensibility')
tail=s[s.index('<script>'):].replace('salesdam-s13-tests-v1','salesdam-s15-tests-v1')
T=[]
def test(title,ref,steps,expect): T.append((title,ref,steps,expect))
CC="Open <b>Setup → Custom Code</b> (address <code>/admin/custom-code</code>)."

# ---------------- Part A
test("A new piece of tenant code can be created, starts as a Draft, and is listed with its description",'§15.4.2–§15.4.4, §15.4.6–§15.4.7, §15.4.12',
 [CC,"Under <b>New Snippet</b> type the name <b>s15_demo</b>, the description <b>S15 adds two inputs</b>, the code <code>result = { total: (inputs.a || 0) + (inputs.b || 0) };</code> and the test inputs <code>{\"a\":2,\"b\":3}</code>. Click <b>Create snippet (v1 draft)</b>.",
  "Find <b>s15_demo</b> in the <b>Snippets</b> list on the right."],
 "The card shows the name, the description, <b>No active version · 1 version</b> and a tag <b>v1 · draft</b>. The tenant, created-by, created date, last-modified-by and date are stored on the record and returned by <code>GET /api/v1/custom-code/s15_demo</code>; the card itself does not display them (see <b>Known limits</b>). The snippet name is the identifier a Flow uses.")
test("A Draft can be moved to Test and test-run before anyone activates it",'§15.4.12, §15.5.1–§15.5.5',
 ["On the <b>s15_demo</b> card click <b>Actions</b>, then <b>Mark v1 Test</b>. The tag becomes <b>v1 · test</b>.",
  "Click <b>Edit</b> on the card. Leave <b>Test mode — disable writes when executing</b> ticked and click <b>Execute</b>."],
 "The <b>Execution result</b> panel shows <b>success</b> and the time in milliseconds, then the <b>inputs</b> you supplied (<code>a: 2, b: 3</code>), the <b>output</b> (<code>total: 5</code>), <b>durationMs</b>, <b>version: 1</b> and <b>testMode: true</b>. A failing script shows the error text in the same panel instead of an output. Nothing was activated: the card still says <b>No active version</b>.")
test("Only an Active version can run in production",'§15.4.13',
 ["On the <b>s15_demo</b> card (still Test, not Active) click <b>Run</b>."],
 "The panel shows <b>failed</b> with the message <b>Custom code \"s15_demo\" has no active version</b>. A Flow that names this snippet would log the same failure (Test 11) and carry on.")
test("Activating a version makes it the one that runs; making it Inactive stops it",'§15.4.12, §15.4.13',
 ["On the card click <b>Actions</b>, then <b>Activate v1</b>. The tag shows <b>v1 · active</b> and the header reads <b>Active: v1</b>.",
  "Click <b>Run</b> on the card, then <b>Actions → Make v1 Inactive</b>. The tag becomes <b>v1 · inactive</b> and the header returns to <b>No active version</b>."],
 "While active the snippet returns <code>total: 5</code>; once inactive it is refused again as in Test 3. Activation and status changes are audited (<b>Audit Logs</b>: <code>custom_code_activate</code>, <code>custom_code_status</code>).")
test("Earlier versions are kept, and an earlier version can be restored",'§15.4.14, §15.4.15',
 ["Open the card's editor (<b>Edit</b>), change the change note and click <b>Add version</b>. Activate v2, then click <b>Actions → Restore v1</b>.",
  "Read the version tags."],
 "v1 and v2 both stay in the list; after Restore the tags read <b>v1 · active</b> and <b>v2 · archived</b>. <i>Not repeated in this run:</i> the same Restore v1 button was clicked in Section 13 (rollback of a code update), and the suite <code>section15-custom-code</code> proves a two-version history (22/22).")
test("Every run is logged, including failures",'§15.4.16, §15.4.17',
 ["After running a snippet (Tests 2–4), look at its card footer, then open it with <b>GET /api/v1/custom-code/s15_demo</b> (<b>Needs an API client</b>) and read <b>executions</b>."],
 "The card shows <b>1 run</b> and <b>Last run just now</b>. The API lists the last 50 runs, each with version, start and finish, duration, success, error, inputs, output and whether it was a test run. A failed run is recorded with its error text.")
test("Only people allowed to manage or deploy code can change or run it",'§15.4.24, §15.1.12',
 ["<b>Needs a person:</b> sign in as a user whose role does not have <b>Manage Custom Code</b> or <b>Deploy Custom Code</b> and open <code>/admin/custom-code</code>; then try <code>POST /api/v1/custom-code/s15_demo/execute</code>."],
 "The page and the call are refused (<b>403</b>). Proved by the suite <code>section15-custom-code</code> (limited user: create 403, execute 403) and by the other tenant getting <b>404</b> on the snippet; not clicked as a second person.")

# ---------------- Part B
test("A Flow has a Custom Code step that names a tenant's own active snippet",'§15.1.1, §15.1.2, §15.1.11',
 ["Open <b>Setup → Automation</b> and the flow <b>S15 Code Flow</b> (prepared for you on <b>My Company</b>; see <b>Before you start</b>). Open the <b>Steps</b> tab and click <b>Add Step</b>.",
  "Read the <b>ACTIONS</b> group, then close the picker and click the step <b>Review</b>."],
 "<b>Custom Code</b> sits under <b>ACTIONS</b> beside Send Email, HTTP Request and Generate PDF. The Review step shows <b>Snippet</b> (only active snippets are offered, here <code>s15_always_fails</code> and <code>s15_claim_review</code>), <b>Inputs (JSON)</b> and <b>Output variable</b> (<code>rv</code>). <b>Needs a person:</b> dragging the action onto the canvas; the pane cannot start a drag, so the step was opened from the saved flow.")
test("The code receives the triggering record and the Flow's inputs, can read, query, create and update records, and hands values back",'§15.1.3–§15.1.7, §15.1.9',
 ["Open <b>Claims</b> and click <b>New</b>. Enter Claim Number <b>S15-CODE</b>, Claim Amount <b>15000</b>, Claim Status <b>Draft</b> and save (the prepared flow only runs for this claim number).",
  "Wait about ten seconds and reopen the claim. Then open the <b>Claims</b> list."],
 "The claim's <b>Description</b> reads <b>risk=high doubled=30000</b> (the code received <b>15000</b> from the record and returned two values the next step used) and <b>Approval Note</b> reads <b>code saw 15000</b> (the code re-read the record and updated it). The list holds one extra claim, <b>S15 created by code</b>, with a normal auto-number (the code created it). The code's input from the Flow (<code>label: from-flow</code>) is echoed in its output.")
test("A Flow decision can branch on what the code returned",'§15.1.7',
 ["On the claim from Test 9 read <b>Claim Status</b>.",
  "Create a second claim with number <b>S15-CODE</b> and amount <b>500</b>, wait, and read its status."],
 "The 15000 claim moved to <b>Pending Approval</b> (the decision outcome <b>High risk</b> matched the code's <code>risk</code> value); the 500 claim stays <b>Draft</b> and its description reads <b>risk=low doubled=1000</b>. <i>Limit:</i> the branch on the returned value was configured through the API (<code>$rv.risk</code>); the builder's own condition picker lists record fields, so from the screen a returned value is branched on after an <b>Update Record</b> step writes it to a field. Not clicked.")
test("An error raised by the code does not break the Flow, and a later step can handle it",'§15.1.10',
 ["Re-read the 15000 claim from Test 9: its <b>Rejection Reason</b>.",
  "Look at the flow's <b>High risk</b> outcome: it runs the snippet <b>s15_always_fails</b> (which always throws) and then a decision on the step's <code>__ok</code> value."],
 "<b>Rejection Reason</b> reads <b>handled: Custom code \"s15_always_fails\" failed: deliberate failure</b>. The Flow carried on, the failure was written to the flow trace, and the step's result variables <code>{$bad__ok}</code> and <code>{$bad__error}</code> were available to later steps. Cleanup: delete the S15 claims you made (Recycle Bin).")
test("Code cannot see or change another tenant's records",'§15.1.11, §15.4.25, §15.4.26',
 ["Create a snippet <code>result = readRecord('insured_life', '&lt;id of a record that belongs to another tenant&gt;').then(function (r) { result = { visible: r !== null }; });</code>, mark it Test and <b>Execute</b> it (Test mode on). <b>Needs a person with database access</b> to obtain a foreign record id.",
  "Repeat with an id that does not exist."],
 "Both runs return <code>visible: false</code>. The server adds the caller's tenant to every read, query, create and update; the code cannot name another tenant. Run in this acceptance with a real record id from a different tenant: <b>false</b>. A snippet also cannot be read, changed or run by another tenant (suite: 404).")

# ---------------- Part C
test("A runaway loop is stopped after five seconds",'§15.4.19, §15.4.30',
 ["Open the card for <b>s15_demo</b> (<b>Edit</b>), replace the code with <code>while (true) {}</code> in the draft, click <b>Save changes</b>, then <b>Execute</b>.",
  "Open any other page (for example <b>Home</b>)."],
 "After about five seconds the panel reads <b>Script execution timed out after 5000ms</b> and the rest of the application keeps answering. (The same loop in a Flow fails only that step.)")
test("Code that eats memory or recurses without end is stopped, and the platform stays up",'§15.4.20, §15.4.21, §15.4.30',
 ["Replace the draft's code with <code>function f(n) { return f(n + 1) + 1 } result = f(0);</code> and <b>Execute</b>.",
  "Replace it with a script that keeps adding large arrays to a list and <b>Execute</b> (<b>Needs a person:</b> write the loop yourself; it is stopped within a second or two by a 64 MB cap)."],
 "The first run reports <b>Maximum call stack size exceeded</b>. The second reports <b>Execution stopped (resource limit or crash)</b>. Each run is a separate short-lived process, so neither can take the server down; after both, other pages load normally. A snippet cannot be started again while it is already running (<b>429 recursion blocked</b>) and a tenant may run at most five at once (both by code and suite design, not exercised here); code has no way to call another snippet or start a Flow, so Flow → code → Flow loops cannot form.")
test("A throw or a rejected promise inside the code is contained",'§15.4.30',
 ["Execute a snippet containing <code>throw new Error(\"boom\")</code>.",
  "Execute one containing <code>Promise.reject(new Error(\"rej\")); result = \"after\";</code>."],
 "The first shows <b>failed: boom</b>. The second succeeds with output <b>after</b>: an unhandled rejection in tenant code cannot crash the server. The list and every other page still work.")
test("The code cannot reach the server's internals, secrets or other processes",'§15.4.1, §15.4.22, §15.4.27–§15.4.29',
 ["Create a snippet with the code <code>result = (function () { var o = {}; try { o.escape = typeof inputs.constructor.constructor('return 1')(); } catch (e) { o.escape = 'refused'; } o.process = typeof process; o.require = typeof require; return o; })();</code>, mark it Test and <b>Execute</b> it."],
 "The output is <b>escape: refused</b>, <b>process: undefined</b>, <b>require: undefined</b>. Running code from a string is switched off, there is no <code>process</code>, <code>require</code> or file access, and the script runs in its own operating-system process that has no file-system, child-process or worker permission and an empty environment. <i>Residual limit:</i> see <b>Known limits</b> (the run still has a network).")
test("Code can only call external systems the company has approved, and never sees their credentials",'§15.1.8, §15.4.23',
 ["Execute <code>callApi(\"Not Approved\", \"/x\").then(function () { result = \"called\"; }, function (e) { result = \"refused: \" + e.message; });</code> in Test mode.",
  "<b>Needs a person:</b> add the system under <b>External Objects</b> (base address and credential), then call <code>callApi(\"&lt;its name&gt;\", \"/path\")</code>."],
 "The unapproved name is refused with <b>is not an approved external system for this tenant</b>. For an approved system the call goes only to its host (a full URL or a different host is refused), the credential is attached by the server and is never visible to the code, test runs are limited to <b>GET</b>, and the reply is capped at 1 MB. The approved path was proved by code and suite, not clicked.")
test("A test run cannot change production records",'§15.5.6',
 ["Execute <code>createRecord(\"claim\", { description: \"x\" }).then(function () { result = \"wrote\"; }, function (e) { result = e.message; });</code> with <b>Test mode</b> ticked."],
 "The result is <b>Test mode: createRecord is disabled to prevent production changes.</b> and no claim appears. <b>Test mode is on by default</b> in the editor and in the API (a production write needs <code>\"testMode\": false</code> sent on purpose, and only people holding Deploy Custom Code can run snippets at all). Updates are blocked the same way. Proved by the suite; the message shown here was clicked.")

# ---------------- Part D
test("A document template is built from text, merge fields, a calculated value, a conditional section, a signature line, header and footer",'§15.3.1, §15.3.3, §15.3.4, §15.3.8, §15.3.9, §15.3.10, §15.3.11',
 ["Open <b>Setup → PDF Templates</b> and the prepared <b>S15 Claim Letter</b> (see <b>Before you start</b>).",
  "Read the blocks, then click the block <b>REFER-TO-MANAGER paragraph…</b> and read the <b>Show only if</b> box. Open the page settings and read <b>Header HTML</b> and <b>Footer HTML</b>."],
 "The blocks are: a heading <code>{record.name}</code>, a line with <code>{record.claim_amount}</code> and the calculated value <code>{= claim_amount * 1.15 }</code>, two paragraphs with <b>Show only if</b> <code>claim_amount &gt; 10000</code> and <code>claim_amount &lt;= 10000</code>, and a signature line. The header reads <b>X Spark - Claim {record.name}</b> and the footer <b>Confidential</b> (<code>{pageNumber}</code> and <code>{totalPages}</code> work in either). <b>Signatures:</b> a signature <i>line</i> is a text block; there is no electronic signature capture.")
test("A document can be generated by hand from a record",'§15.3.13, §15.3.4',
 ["In the template, click <b>Generate PDF</b> (top of the editor), paste the id of a claim record (for example the one from Test 9; its id is in its address) and click <b>Generate PDF</b> in the box."],
 "The pane confirms <b>PDF generated and downloaded</b> and a PDF of about 1.6 KB downloads. <b>Needs a person:</b> open the file. Read from the file in this run: heading <b>Claim letter CLM-…</b>, <b>Amount claimed: 20000; with 15% VAT: 23000</b>, only the <b>REFER-TO-MANAGER</b> paragraph, the signature line, the header and <b>Confidential | Page 1 of 1</b> in the footer. A record you may not see answers <b>Record not found</b> (code, not clicked).")
test("A Flow generates the document automatically and files it on the record",'§15.3.13',
 ["Open <b>Setup → Automation → S15 PDF Flow</b>: a record-created flow on Claim with one <b>Generate PDF</b> step naming <b>S15 Claim Letter</b> and the file name <code>Letter-{record.claim_number}</code>.",
  "Create a claim with number <b>S15-PDF</b> and amount <b>20000</b>, wait, and look at the claim's Files."],
 "A file <b>Letter-S15-PDF.pdf</b> is attached to the claim and contains that claim's own values (the claim's name, amount and the VAT calculation) — the step used to render with no record at all. Seen in this run by reading the stored file; the Files screen was not clicked.")
test("A document can include a repeating table of related records with a total, tenant branding and fields of a related object",'§15.3.2, §15.3.5–§15.3.7',
 ["<b>Needs an API call to prepare</b> (the editor's Data Table block takes a list passed in by a Flow; a table of a record's children is set in the template data): create a template whose Data Table block has <code>relatedObject: insured_life</code>, <code>lookupField: policy</code> and the columns Name, Relationship and Sum assured with <code>total: \"sum\"</code>; add an Image block with an embedded picture (or <code>useBranding: true</code> for the company logo).",
  "Use <b>Generate PDF</b> with the id of policy <b>POL-00001</b>."],
 "The PDF lists the three insured lives (Thabo, Naledi and Lesedi Mokoena, with their relationship and cover) and a <b>Total 450000</b> row, with the picture at the top. Merge fields also read one level through a lookup (<code>{record.policy.policy_number}</code>). Proved by rendering the template to a PDF and reading the text (not clicked); a custom object's fields work the same way because nothing is object-specific. Remote picture addresses are deliberately never fetched.")

# ---------------- Part E
test("Where tenant-specific extensions beyond a Flow already live",'§15.2.1–§15.2.13',
 ["Read the table in <b>Known limits</b>. For each row open the screen named (action buttons: Section 4; automation, screens and approvals: Sections 7–8; webhooks and integrations: Setup menu)."],
 "Every §15.2 item is covered by an existing mechanism except custom screens written in code (the platform has configured <b>Screen Flows</b>, not tenant-authored UI) and code attached directly to an object event outside a Flow. Both are listed as not built. This test is a walk-through, not a new check.")

n=len(T)
html=head+'''<div class="wrap">

  <header class="mast">
    <div class="eyebrow">Salesdam V3 · Client Acceptance Test</div>
    <h1>Custom Code and Extensibility</h1>
    <p class="standfirst">A step-by-step script for BRD Section&nbsp;15. You create tenant code, move it Draft → Test → Active → Inactive, test-run it safely, call it from a Flow, see it read and write records and return values, watch the runtime contain loops, crashes and escape attempts, and generate documents from templates by hand and from a Flow.</p>
    <div class="mast-meta"><span><b>Scope</b> BRD §15</span><span><b>Tests</b> %d</span><span><b>Time</b> ~90 minutes</span><span><b>Issued</b> 19 Nov 2026</span></div>
  </header>
  <div class="progress-bar"><span class="count" id="count">0 of %d complete</span><div class="track"><div class="fill" id="fill"></div></div><button class="btn-reset" id="reset" type="button">Reset</button></div>
<h2>Before you start</h2><div class="callout"><h3>Signing in</h3><dl class="creds"><dt>Address</dt><dd>http://localhost:5173</dd><dt>Who</dt><dd>An administrator who may manage and deploy custom code, in the tenant being tested</dd></dl>
  <p style="margin:12px 0 0;font-size:14px;color:var(--ink-soft)">Ask your Salesdam contact for the sign-in details. Pages can take 10–30 seconds to fill because the database is remote.</p></div>
<div class="callout"><h3>What is prepared on My Company</h3><ul>
<li>Custom code <b>s15_claim_review</b> (reads, queries, creates and updates claims, returns a risk value) and <b>s15_always_fails</b> (always raises an error), both Active.</li>
<li>Flow <b>S15 Code Flow</b> (Claim created and claim number is <b>S15-CODE</b>) and flow <b>S15 PDF Flow</b> (claim number is <b>S15-PDF</b>), both Active. Other claims are not touched.</li>
<li>PDF templates <b>S15 Claim Letter</b> and <b>S15 Policy Schedule</b>.</li>
<li>Run the code-runtime tests (Tests 1–7 and 14–19) in a copy of your tenant, not in production: <b>Setup → Deployments → Clone Sandbox Tenant</b>, name it <b>S15 Sandbox</b>, switch to it with the <b>Tenant</b> switcher. A copy has no records, so record tests (9–13, 21–23) use My Company.</li></ul></div>
<div class="callout warn"><h3>Safe-testing rules</h3><ul>
<li>The security tests use probes that only <i>report</i> whether something is reachable. Do not paste code from other sources into a snippet, and never put real credentials into one.</li>
<li>Leave <b>Test mode</b> ticked unless a test says otherwise. A run that is not in test mode writes real records.</li></ul></div>
<div class="callout warn"><h3>Cleaning up</h3><ul>
<li>Delete your snippets (<b>Setup → Custom Code</b>, trash icon) and the S15 claims (Recycle Bin). Switch back to your home tenant, then remove the copy with <b>Setup → Deployments → Delete sandbox…</b> (type its name).</li></ul></div>
'''%(n,n)
idx=lambda t:[k for k,(a,*_) in enumerate(T,1) if a.startswith(t)][0]
secs={1:('Code components, statuses and test runs','BRD §15.4.2–§15.4.18, §15.5 — create, version, test, activate, log.'),
 idx('A Flow has a Custom Code step'):('Custom code in Flows','BRD §15.1 — the Custom Code step, data in and out, branches and errors.'),
 idx('A runaway loop'):('The runtime: limits and isolation','BRD §15.4.1, §15.4.19–§15.4.30 — what the code cannot do, and what it cannot take down.'),
 idx('A document template'):('Custom documents','BRD §15.3 — templates, generation by hand and from a Flow.'),
 idx('Where tenant-specific'):('Beyond Flows','BRD §15.2 — what exists, and what does not.')}
for k,(title,ref,steps,exp) in enumerate(T,1):
    if k in secs: html+='<h2>%s</h2><p class="sec-note">%s</p>'%secs[k]
    html+='''<div class="test">
    <label class="test-head"><input type="checkbox" data-id="t%d">
      <span class="test-title"><span class="t">%d. %s</span>
        <span class="refs"><span class="ref">%s</span></span></span></label>
    <div class="test-body">
      <ol class="steps">%s</ol>
      <div class="expect"><b>Expected</b>%s</div>
    </div>
  </div>
'''%(k,k,title,ref,''.join('<li>%s</li>'%x for x in steps),exp)
html+='''<h2>Known limits</h2><div class="callout warn"><h3>Worth knowing</h3><ul>
<li><b>How the code is isolated.</b> Each run starts its own operating-system process (Node permission model: no files, no child processes, no workers, no add-ons; empty environment; 64 MB heap; text-to-code switched off) and every data call goes back to the server, which fixes the tenant. This is much stronger than a plain Node <code>vm</code> context, which is <i>not</i> a security boundary and was what the platform used before this section; it is still not a hardware-isolated sandbox. <b>Residual risks:</b> the run process can still open network connections (including to internal addresses) because the Node permission model does not restrict the network, and a flaw in Node itself would be an escape; a container or separate host for the runner would close both and is the recommended next step before untrusted developers are allowed to write code.</li>
<li><b>Code runs with the platform's authority, not the triggering user's.</b> It is limited to the tenant, but it does not apply the user's role, sharing or field security, so only people trusted with Deploy Custom Code should activate code.</li>
<li><b>Display gaps.</b> The code card does not show tenant, created by/date, last modified by/date or an API name (the data is stored); the version tags show Draft, Test, Active, Inactive and Archived.</li>
<li><b>Not built:</b> custom screens written in code, code attached directly to an object event or button without a Flow, tenant-defined REST endpoints (an inbound webhook can name a snippet to run), electronic signature capture, per-user permission checks inside documents, document-template UI for related-record tables and the logo block (set in the template data).</li>
<li><b>Existing mechanisms for §15.2:</b> custom actions and buttons — action buttons that start a Flow or Screen Flow; custom screens — Screen Flows; custom integrations — Webhooks, Integrations and External Objects, the HTTP Request step and <code>callApi</code>; custom calculations — formula and roll-up fields and code; custom processes — Flows and Approvals; custom APIs — inbound webhooks; custom documents — PDF templates; functionality on any object — Flows with a Custom Code step.</li></ul></div>
</div>
'''+tail
open('section15-test-manual.html','w').write(html)
print(n,'tests')
