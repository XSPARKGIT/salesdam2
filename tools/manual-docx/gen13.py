import re
s=open('section12-test-manual.html').read()
head=s[:s.index('<div class="wrap">')].replace('Import and Export Test Manual','Deployment Test Manual').replace('Data Import and Export','Deployment and Environments')
tail=s[s.index('<script>'):].replace('salesdam-s12-tests-v1','salesdam-s13-tests-v1')
T=[]
def test(title,ref,steps,expect):
    T.append((title,ref,steps,expect))
test("A sandbox is a full copy of a tenant's configuration, built in one click",'§13.1 (sandbox / test tenant)',
 ["Sign in as an administrator. In the top bar open the <b>Tenant</b> switcher and choose the tenant you want to copy (for the acceptance run, <b>My Company</b>). Open <b>Setup → Deployments</b>.",
  "Under <b>Clone Sandbox Tenant</b> choose <b>My Company</b> in <b>Source tenant…</b>, type <b>S13 Sandbox A</b> in <b>Sandbox name</b> and click <b>Clone</b>.",
  "Wait for the green message (it can take up to a minute on the remote database)."],
 "The message reads <b>Sandbox created (N components)</b>. For My Company we saw <b>67 components</b>: 5 objects, 48 fields, 2 layouts, 1 flow, 3 approval processes and the 7 Policy validation rules (rules travel inside their object). The Apps (workspaces) are copied too, so the objects show in the sandbox's sidebar, but not their members. Counts were read from the database by the Salesdam team.")
test("A sandbox contains no business records",'§13.1 (no production data)',
 ["In the top bar open the <b>Tenant</b> switcher and choose <b>S13 Sandbox A</b>. Open Policies, Insured Lives, Claims and Brokers from the sidebar.",
  "Switch back to <b>My Company</b> and open Policies for comparison."],
 "The Policies list reads <b>0 records</b> and <b>No policies found.</b> (clicked). Insured Life, Claim and Broker lists were not clicked; their counts in the sandbox were <b>0</b> in the database (My Company held 8, 6, 8 and 0).")
test("Several different components can be bundled into one package",'§13.2 (change set)',
 ["Make something to package. In the <b>S13 Sandbox A</b> tenant add two text fields on Policy (<b>S13 Reference</b>, <b>S13 Note</b>, API names <b>s13_ref</b>, <b>s13_note</b>), one validation rule named <b>S13 Note not BAD</b> (<code>s13_note == \"BAD\"</code>), a Custom Code snippet <b>s13_calc</b> made active, a document template with API name <b>s13_letter</b> and a flow <b>s13_flow</b> that calls the snippet and generates that template. (The Salesdam team created these directly for the acceptance run.)",
  "With <b>S13 Sandbox A</b> selected in the top bar, open <b>Setup → Deployments</b>. Under <b>Create Change Set</b> type the name <b>S13 Mixed Package</b>.",
  "Add six components one at a time: choose the type, type the key, click <b>Add</b>: <b>field</b> <code>policy.s13_ref</code>; <b>field</b> <code>policy.s13_note</code>; <b>validation_rule</b> <code>policy:S13 Note not BAD</code>; <b>custom_code</b> <code>s13_calc</code>; <b>pdf_template</b> <code>s13_letter</code>; <b>flow</b> <code>s13_flow</code>. Click <b>Create Change Set</b>."],
 "The six lines appear in the list and then the green message <b>Change set created</b>. The table under <b>Change Sets</b> shows <b>S13 Mixed Package</b>, status <b>draft</b>, <b>6</b> components. A wrong key (for example a typo in the field name) is refused with <b>Components not found</b>.")

test("A change set exports as a package file that carries no credentials",'§13.2 (deployable package)',
 ["With the source tenant selected in the top bar, find <b>S13 Mixed Package</b> in the <b>Change Sets</b> table and click <b>Export</b>."],
 "The message <b>Package file exported</b> appears and a file named <b>S13-Mixed-Package.salesdam-package.json</b> downloads (about 5 KB). It holds <b>format</b>, <b>version 1</b>, the source tenant's name and id, the creation time, the six components with their settings, and a <b>checksum</b>. Anything that looks like a password, token, secret or API key is blanked; integration configurations are never included. The save dialog itself needs a person; we read the file's content from the page.")
test("A package file imports into another tenant as a change set that follows the normal path",'§13.2 (import into another tenant)',
 ["Switch the top-bar <b>Tenant</b> to the tenant that should receive the package (<b>S13 Sandbox target</b>). Under <b>Import Package File</b> choose the file you exported. <b>Needs a person:</b> the file chooser cannot be driven by our tool; we supplied the same file to the same screen handler instead.",
  "A new row <b>S13 Mixed Package</b> (draft, 6 components) appears in <b>Change Sets</b>. Choose a target tenant (a tenant without the object is blocked at <b>Validate</b> with <b>Missing object: policy</b>; <b>S13 Sandbox Del</b>, another clone, passes), click <b>Validate</b> then <b>Deploy</b>, and read the <b>Deployment Log</b>."],
 "Import message: <b>Package imported as a change set</b>. Validate and Deploy behave exactly as in the earlier tests: the log row reads <b>deployed</b> with 6 components, the By column names the administrator, and <b>Rollback</b> removes the components again (clicked end to end).")
test("A changed, forged or oversized package file is refused and leaves nothing behind",'§13.2 (untrusted file)',
 ["In the receiving tenant, import a copy of the file in which you changed one setting (for example edit the snippet's description) without recalculating the checksum.",
  "Import copies in which: the <b>version</b> is 2; a component type is changed to <b>user</b>; the file is not JSON at all.",
  "Look at the <b>Change Sets</b> table after each attempt."],
 "Each is refused with a red message: <b>Package refused: the integrity checksum does not match – the file was changed after export.</b>, <b>package version 2 is not supported (expected 1)</b>, the same checksum message for the changed type, and <b>the file is not valid JSON</b>. No row is added (clicked). Also refused, proved by the automated suite only: an unknown component type or an operator key with a valid checksum, a component whose key does not match its settings, a file over 5 MB, and any import by a non-Super User.")
test("A package is blocked when the object it needs does not exist in the target",'§13.2.1, §13.2.9',
 ["Under <b>Target Tenant</b> choose a tenant that has none of your objects (the acceptance run used an empty tenant, <b>ZZ_S13 Bare Target</b>). In the <b>S13 Mixed Package</b> row click <b>Validate</b>."],
 "<b>Validation Result</b> reads <b>Blocked – 1 required dependency is missing in the target tenant</b> and lists <b>Missing object: policy</b>. The <b>Deploy</b> button stays greyed out.")
test("A package is blocked when a flow's custom code or document template is missing",'§13.2.3, §13.2.6, §13.2.8, §13.2.9',
 ["Create a second change set, <b>S13 Flow Only</b>, containing only the <b>flow</b> <code>s13_flow</code>.",
  "Under <b>Target Tenant</b> choose the second sandbox (<b>S13 Sandbox target</b>, a clone of My Company, which has Policy but no snippet or template). Click <b>Validate</b> on <b>S13 Flow Only</b>."],
 "<b>Blocked – 2 required dependencies are missing</b>: <b>Missing custom code: s13_calc (needed by flow:s13_flow)</b> and <b>Missing document template: s13_letter (needed by flow:s13_flow)</b>.")
test("A package is blocked when a field its validation rule uses is missing",'§13.2.2, §13.2.5, §13.2.9',
 ["Create a third change set, <b>S13 Rule Only</b>, containing only the <b>validation_rule</b> <code>policy:S13 Note not BAD</code>. With the same target selected click <b>Validate</b>."],
 "<b>Blocked – 1 required dependency is missing</b>: <b>Missing field: policy.s13_note (needed by validation_rule:policy:S13 Note not BAD)</b>.")
test("A flow is blocked when a field, object or sub-flow it uses is missing in the target",'§13.2.1, §13.2.2, §13.2.3, §13.2.9',
 ["Package a flow whose steps write a field, create records on an object, or call a sub-flow that the target does not have, and click <b>Validate</b> against that target."],
 "Blocked with <b>Missing field: policy.&lt;field&gt;</b>, <b>Missing object: &lt;object&gt;</b> or <b>Missing flow: &lt;sub-flow&gt;</b>. Putting the sub-flow in the same package clears its entry. Not clicked: proved by the automated suite. Fields are checked for Update Record, Create Record, Get Records and Delete Records steps; other step types are not inspected.")
test("A blocked deployment is refused and recorded, never half-applied",'§13.2.9, §13.3 (log)',
 ["Deploy is disabled in the screen until a package validates, so this step uses the API: with <b>S13 Sandbox A</b> selected, call <code>POST /api/v1/change-sets/&lt;id of S13 Flow Only&gt;/deploy</code> with the target tenant id. (The Salesdam team did this from the browser; it needs a person who can call the API.)",
  "Under <b>Target Tenant</b> choose <b>S13 Sandbox target</b> and read the <b>Deployment Log</b> at the bottom of the page."],
 "The API answers <b>409 Deployment blocked: missing dependencies (s13_calc, s13_letter)</b>. The log gains a row, status <b>blocked</b>, <b>2 missing</b> (hover the row to see which). Nothing was created in the target.")
test("Dependencies that are present let the whole package deploy",'§13.2, §13.1.3 (configuration and custom code together)',
 ["Select <b>S13 Sandbox target</b> as the target and click <b>Validate</b> on <b>S13 Mixed Package</b>, then <b>Deploy</b>."],
 "<b>All dependencies are present – ready to deploy.</b> The package status becomes <b>deployed</b>, 6 components, and a <b>Rollback</b> button appears. Switch to the target tenant and open <b>Setup → Custom Code</b>: <b>s13_calc</b> shows <b>Active: v1 · 1 version</b> with the note <b>Deployed from change set</b> (clicked). The fields, rule, template and flow were read from the database: both fields, the rule, the template, and the flow whose PDF step points at the target's own template, not the source's. Those Setup screens were not clicked.")
test("The deployment log says what was deployed, when and by whom",'§13.3 (deployment log)',
 ["With <b>S13 Sandbox target</b> still chosen under <b>Target Tenant</b>, read the <b>Deployment Log</b> table."],
 "One row per attempt with <b>When</b> (date and time), <b>Change set</b>, <b>From</b> (source tenant), <b>By</b> (the administrator's name), <b>Status</b> (deployed / blocked / rolled back) and <b>Components</b>. Blocked and rolled-back attempts stay in the log.")
test("Promoting a new custom-code version keeps the one it replaces",'§13.1.2, §13.3.1',
 ["In <b>S13 Sandbox A</b> make a second version of <b>s13_calc</b> active (Setup → Custom Code → <b>Activate v2</b>; the acceptance run set it directly).",
  "Create a change set <b>S13 Code Update</b> with the single component <b>custom_code</b> <code>s13_calc</code>. Choose <b>S13 Sandbox target</b>, click <b>Validate</b>, then <b>Deploy</b>."],
 "Validation passes and the log shows <b>S13 Code Update – deployed – 1</b>. In the target the snippet now has <b>v2 active</b> and <b>v1 archived</b> (read from the database). Only the active (approved) version is ever packaged, never a draft.")
test("Rolling back a code deployment returns the immediately preceding active version",'§13.3.1, §13.3.2',
 ["In the <b>Deployment Log</b> of <b>S13 Sandbox target</b>, find the <b>S13 Code Update</b> row and click its <b>Rollback</b> button."],
 "The row's status changes to <b>rolled back</b> and its Rollback button disappears. In the target the snippet is back to <b>v1 active</b> with only v1 present (the previous state, exactly).")
test("Rolling back a mixed package removes everything it added",'§13.3',
 ["In the same log click <b>Rollback</b> on the <b>S13 Mixed Package</b> row."],
 "Status becomes <b>rolled back</b>. The snippet is gone from the target's Custom Code page; in the database the target again had no <b>s13_</b> fields, no rule, no template and no flow. A component that already existed before the deployment would instead be put back as it was.")
test("An administrator can restore an earlier custom-code version from the Custom Code page",'§13.3.2',
 ["Open <b>Setup → Custom Code</b> in <b>S13 Sandbox A</b>. Find <b>s13_calc</b> (<b>Active: v2 · 2 versions</b>) and click <b>View code</b>.",
  "Click <b>Restore v1</b> (the browser may ask you to confirm)."],
 "The heading changes to <b>Active: v1 · 2 versions</b>; v1 reads active, v2 archived. The previous version was kept all along, so nothing is lost.")
test("Code that has only a draft cannot be packaged for deployment",'§13.1.3, §13.2.9',
 ["Create a snippet that has only a draft version, add it to a change set as a <b>custom_code</b> component and click <b>Validate</b> against any tenant."],
 "Blocked with <b>Missing custom code approved version: &lt;snippet name&gt;</b>. Not clicked: proved by the automated suite (<b>section13-deployment</b>).")
test("A flow that calls an integration is blocked until the target has that integration",'§13.2.7, §13.2.9',
 ["Package a flow whose HTTP step uses an Integration (external object) and validate it against a tenant without an integration of the same name."],
 "Blocked with <b>Missing integration: &lt;name&gt;</b>. Not clicked: proved by the automated suite. The integration itself is not packaged (it holds addresses and credentials); each tenant sets up its own and the package finds it by name.")
test("A sandbox can be deleted, but only a sandbox, and only deliberately",'§13.1 (clean-up of test tenants)',
 ["Under <b>Delete Sandbox Tenant</b> open <b>Sandbox to delete…</b>. Only tenants created with <b>Clone</b> are listed; a tenant that was not made by cloning (for example the empty target) and your real tenants are absent.",
  "Choose the sandbox you are currently working in: <b>Delete sandbox…</b> is greyed out and the note <b>You are working in this sandbox. Switch to another tenant in the top bar first.</b> appears.",
  "Switch to another tenant, choose a sandbox, click <b>Delete sandbox…</b>, type a wrong name (the <b>Delete permanently</b> button stays disabled), then type the exact name and click <b>Delete permanently</b>."],
 "The message <b>Sandbox deleted</b> appears and the sandbox leaves both pickers (clicked). Its configuration, users, roles, change sets and logs are removed; the source tenant is untouched. The server also refuses (suite): a non-clone tenant, the tenant you are signed in to, a wrong name and a non-Super User.")
html=head+'''<div class="wrap">

  <header class="mast">
    <div class="eyebrow">Salesdam V3 · Client Acceptance Test</div>
    <h1>Deployment and Environments</h1>
    <p class="standfirst">A step-by-step script for BRD Section&nbsp;13. You copy a tenant into a sandbox, bundle several kinds of configuration and custom code into one package, prove that a package with a missing dependency is refused, deploy a complete one, read the deployment log, and roll deployments back. Everything happens in throwaway tenants; your working tenant is never deployed into.</p>
    <div class="mast-meta"><span><b>Scope</b> BRD §13</span><span><b>Tests</b> %d</span><span><b>Time</b> ~60 minutes</span><span><b>Issued</b> 19 Nov 2026</span></div>
  </header>
  <div class="progress-bar"><span class="count" id="count">0 of %d complete</span><div class="track"><div class="fill" id="fill"></div></div><button class="btn-reset" id="reset" type="button">Reset</button></div>
<h2>Before you start</h2><div class="callout"><h3>Signing in</h3><dl class="creds"><dt>Address</dt><dd>http://localhost:5173</dd><dt>Who</dt><dd>An administrator (Super User) of the tenant being tested</dd></dl>
  <p style="margin:12px 0 0;font-size:14px;color:var(--ink-soft)">Ask your Salesdam contact for the sign-in details. Pages can take 10–30 seconds to fill because the database is remote. Deployments and sandboxes are Super User screens: <b>Setup → Deployments</b> and <b>Setup → Custom Code</b>. The <b>Tenant</b> switcher in the top bar decides which tenant you are looking at, and a new change set is built from that tenant.</p></div>
<div class="callout"><h3>What can travel in a package</h3><ul>
<li><b>Yes:</b> objects, fields, validation rules (alone or inside their object), layouts, layout assignments, flows, approval processes, approver groups, duplicate rules, configuration values, <b>custom code</b> (active version only) and <b>document (PDF) templates</b>.</li>
<li><b>Checked for dependencies:</b> objects, fields (used by layouts, layout assignments and validation rules), layouts, roles, approver groups, custom code, document templates and integrations (a flow's integration is found by name).</li>
<li><b>Not packaged:</b> integration configurations themselves (they hold credentials), email and message templates, users and records. Flows are checked for the objects, fields (on Update/Create/Get/Delete Record steps) and sub-flows they use; other step types are not inspected.</li></ul></div>
<div class="callout warn"><h3>Cautions</h3><ul>
<li>Use only throwaway tenants as targets. Deploying changes the target's live configuration.</li>
<li>Validate first. A deployment re-checks the same dependencies and refuses to start if anything is missing.</li>
<li>Rolling back a package puts each component back to its state before the deployment; it does not touch records.</li></ul></div>
<h2>Sandbox and package</h2><p class="sec-note">BRD §13.1–§13.2 — copy a tenant's configuration without its data, and bundle components into a package.</p>
'''%(len(T),len(T))
idx=lambda t:[k for k,(a,*_) in enumerate(T,1) if a.startswith(t)][0]
secs={idx('A package file imports'):('Package files','BRD §13.2 — export to a file, import into another tenant, refuse a tampered file.'),idx('A package is blocked when the object'):('Dependency checks','BRD §13.2 — a package is refused when something it needs is missing in the target.'),idx('Dependencies that are present'):('Deployment, log and rollback','BRD §13.1.2, §13.3 — deploy, read what happened, and undo it.'),idx('Code that has only a draft'):('Cases checked by the test suite only','BRD §13.1.3, §13.2.7 — not clickable on a standard screen.')}
for n,(title,ref,steps,exp) in enumerate(T,1):
    if n in secs: html+='<h2>%s</h2><p class="sec-note">%s</p>'%secs[n]
    html+='''<div class="test">
    <label class="test-head"><input type="checkbox" data-id="t%d">
      <span class="test-title"><span class="t">%d. %s</span>
        <span class="refs"><span class="ref">%s</span></span></span></label>
    <div class="test-body">
      <ol class="steps">%s</ol>
      <div class="expect"><b>Expected</b>%s</div>
    </div>
  </div>
'''%(n,n,title,ref,''.join('<li>%s</li>'%x for x in steps),exp)
html+='''<h2>Known limits</h2><div class="callout warn"><h3>Worth knowing</h3><ul>
<li>A package file is JSON with a checksum; it is checked before anything is created, but it is not encrypted or signed, so treat it like any other company file.</li>
<li>A deployment does not carry users, records, email/message templates or the credentials of an integration.</li>
<li>Deploying a custom-code component adds it as the next version in the target and activates it; the target's earlier version stays in its history.</li>
<li>Sandbox cloning copies configuration, Apps and every custom-code version (drafts included), but no records, users, App members or files. The sandbox starts without members, so only Super Users see its Apps until you add people.</li></ul></div>  <footer>Salesdam V3 · Deployment and Environments acceptance script · issued 19 November 2026. Tick-box progress is remembered in this browser only.</footer>
</div>

'''+tail
open('section13-test-manual.html','w').write(html)
print(len(T))
