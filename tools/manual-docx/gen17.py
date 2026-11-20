s=open('section15-test-manual.html').read()
head=s[:s.index('<div class="wrap">')].replace('Custom Code Test Manual','Integration Test Manual').replace('Custom Code and Extensibility','Integration Framework and API')
tail=s[s.index('<script>'):].replace('salesdam-s15-tests-v1','salesdam-s17-tests-v1')
T=[]
def test(title,ref,steps,expect): T.append((title,ref,steps,expect))
INT="Open <b>Integrations</b> in the sidebar (address <code>/integrations</code>)."
MON="On <b>Integrations</b> click <b>Webhooks &amp; Integration Log</b> (address <code>/integrations/monitor</code>)."
KEYH="<b>Needs an API client:</b> run each request below from your own client with <code>X-API-Key: &lt;your key&gt;</code>; never paste the key anywhere that is stored or shared."
BASE="<code>http://localhost:5002/api/v1</code>"

# ---------------- Part A
test("An API key is created, shown once, and never shown again",'§17.2.1, §17.2.2, §17.2.6, §17.2.7',
 [INT,"Click <b>New API Key</b>. Name it <b>S17 key</b>, keep <b>Read</b> ticked, set <b>Rate limit (requests per minute)</b> to <b>3</b> and click <b>Create Key</b>.",
  "Read the dialog. Click the eye to reveal the key if you need to copy it, then <b>I've saved the key — close</b>. Reload the page and open the key's card."],
 "The dialog says <b>Copy this key now. It will never be shown again</b> and shows the key masked, with the name, prefix and scopes. After closing, the card shows only the <b>prefix</b>, scopes, limits and usage. Only a SHA-256 hash is stored; the key is not in the list API, the audit log or any log (suite <code>section17-governance</code>).")
test("A key retrieves records and metadata, and only within its tenant",'§17.1.1, §17.1.7, §17.1.11, §17.6.5',
 [KEYH,"<code>GET "+"{base}/objects</code> and <code>GET {base}/objects/&lt;object&gt;/fields</code> (replace {base} with "+BASE+").","<code>GET {base}/records/&lt;object&gt;/&lt;id of a record that belongs to ANOTHER tenant&gt;</code> and then <code>DELETE</code> the same address (use a throwaway tenant's key)."],
 "The first two return <b>200</b> with object and field metadata. The foreign record answers <b>404</b> to both, shows no data and is still there afterwards (suite: 404/404 and the record still exists). Clicked from the page: <code>GET /objects</code> with only the key returned <b>200</b>.")
test("A key creates, updates, queries and deletes records on standard and custom objects",'§17.1.1–§17.1.5',
 [KEYH,"Use a key with <b>Read, Write, Delete</b>. <code>POST {base}/records/policy</code> with a JSON body of the fields; then <code>PUT</code> it, <code>GET {base}/records/policy?filter={\"policy_status\":\"Active\"}</code> and <code>DELETE</code> it.","Repeat on <b>insured_life</b>."],
 "Create answers <b>201</b>, update <b>200</b>, the filtered list includes the record, delete <b>200</b> (the record goes to the Recycle Bin). Validation rules and field security apply exactly as in the screens (Sections 6 and 9). <i>Not clicked:</i> proved by the suite on a bill object; Policy and Insured Life not run through a key in this acceptance.")
test("A custom object and field created today are served by the API at once",'§17.1.10, §17.2',
 ["Open <b>Setup → Object Settings</b>, create the object <b>S17 Gadget</b> and add a text field <b>Colour</b>; add the object to your App (<b>Workspaces</b>).",KEYH,"<code>POST {base}/records/&lt;the new object&gt;</code> with <code>{\"name\":\"G1\",\"colour\":\"red\"}</code> then <code>GET</code> it back."],
 "Create answers <b>201</b> and the read returns <b>colour: red</b>. No engineering step, restart or code change is involved: the records API reads the object and field definitions per request. Undo: delete the record, then the object (<b>Setup → Object Settings</b>).")
test("A key can trigger a Flow only when the flow allows it and the key and its owner may",'§17.1.9, §17.6.4',
 ["Open <b>Setup → Automation</b>, open a flow, and in its <b>Settings</b> tab tick <b>Allow this flow to be started by an API key, access token or incoming webhook</b> (off by default) and save.",KEYH,"<code>POST {base}/automations/&lt;flow id&gt;/run-action</code> with <code>{\"recordId\":\"&lt;id&gt;\",\"objectApiName\":\"&lt;object&gt;\"}</code> using a <b>Write</b> key. Then repeat with (a) a flow that is <b>not</b> ticked, (b) a key whose <b>Allowed Objects</b> excludes that object, (c) a key created by someone whose role may not update that object. Open <b>Integrations → Webhooks &amp; Integration Log → Integration Log</b> and <b>Authentication Failures</b>."],
 "The ticked flow runs and the record changes. (a), (b) and (c) answer <b>403</b> with the reason (<b>not enabled for API triggering</b>, <b>This key may not act on…</b>, <b>The key owner may not update…</b>), the flow does <b>not</b> run, and each refusal shows as a failed <b>403</b> inbound row in the Integration Log and a row in Authentication Failures (suite). <b>The rule:</b> API-key, token and incoming-webhook starts need (1) the flow's API flag, (2) the key's object list to include the object, (3) the key owner's role to allow updating that object. Signed-in people using buttons in the app are unchanged. The flag checkbox was seen only in code and the suite, not clicked.")
test("A key is limited by scope, by chosen objects and by its owner's role",'§17.6.4, §17.1.5',
 [INT,"Create a key with only <b>Read</b>, and a key with <b>Allowed Objects</b> set to a single object.",KEYH,"With the read-only key <code>POST {base}/records/&lt;object&gt;</code>; with the single-object key <code>GET</code> a different object. Then create a key while signed in as a user whose role may read but not create that object and repeat both calls."],
 "<b>403</b> each time, with a message naming the missing scope or object. A key acts as the person who created it, so it can never do more than their role: read allowed, create <b>403</b>, an unshared object <b>403</b> (suite).")
test("A request for another tenant, or with no or a bad key, is refused and logged",'§17.1.11, §17.6.3, §17.6.5',
 [INT,"Open the card of <b>S17 key</b> and note its prefix.",KEYH,"Send <code>GET {base}/objects</code> with the key and the header <code>X-Tenant-ID: &lt;another tenant's id&gt;</code>; then with no key; then with the key changed to a wrong value.",MON,"Open the <b>Authentication Failures</b> tab."],
 "The calls answer <b>403</b>, <b>401</b>, <b>401</b>. The tab lists <b>api-key</b> rows with the date and time, the <b>first characters</b> of the key (never the whole key), the reason (for example <b>This API key does not belong to the requested tenant</b>), the source address and the request. A wrong key sent <i>without</i> naming a tenant cannot be tied to one, so it appears only to a superuser (<code>GET /api-keys/auth-failures?scope=platform</code>).")
test("API rate limiting stops a key that goes over its limit",'§17.6.1',
 ["Use the key from Test 1 (limit <b>3</b> per minute) and a throwaway tenant only.",KEYH,"Send <code>GET {base}/objects</code> five times in a row, then wait a minute and send once more."],
 "Calls 1–3 answer <b>200</b>, calls 4 and 5 answer <b>429</b> with a <b>Retry-After</b> header; the sixth, after the minute, answers <b>200</b>. Clicked: 200, 200, 200, 429, 429. Keep tests like this on a throwaway tenant and a low limit; the default is <b>300</b> per minute per key.")
test("Usage is monitored per key and for the whole tenant",'§17.6.2',
 [INT,"On the key's card click <b>Usage</b> and read the figures; choose <b>Last 30 days</b>.",MON,"Open the <b>Integration Log</b> tab and read the line above the table."],
 "The panel shows total calls, success rate, errors, average response, last used, calls per day, by method, status codes and recent requests. The log tab reads <b>API usage, last 7 days: N calls, N errors, success rate N%, average N ms</b>. <i>Limit:</i> a call stopped by the rate limit is recorded as an authentication failure, not as a usage row.")
test("A key can be switched off and back on without losing anything, and a replacement key retires the old one",'§17.2.8, §17.6.6, §17.6.7',
 [INT,"On the key's card click <b>Deactivate</b>. The key moves to <b>Revoked / Expired</b> and offers <b>Activate</b>. Call the API with it (as in Test 7).","Click <b>Activate</b>; call again. Then click <b>Rotate</b> (<b>Needs a person:</b> the browser confirmation cannot be driven by tools), copy the new key and call with the old key and the new one."],
 "While deactivated the key is refused (<b>401</b>); after <b>Activate</b> it works (<b>200</b>). After <b>Rotate</b> the card is renamed <b>(rotated)</b>, the new key works and the old key is refused (<b>401</b>). Clicked: deactivated 401, activated 200, rotate (confirmation answered by script) old 401, new 200. No tenant or business data is touched by any of this.")
test("A revoked key can never be brought back",'§17.2.8',
 [INT,"Click <b>Revoke</b> on a key and confirm (<b>Needs a person:</b> the confirmation is a browser dialog). Look for an <b>Activate</b> button on the revoked card and call the API with the key."],
 "The key is refused and the card has no Activate button (<code>POST /api-keys/&lt;id&gt;/activate</code> answers <b>400</b>: a revoked key cannot be reactivated). Revoke and delete are audited as <code>api_credential_revoke</code> / <code>api_credential_delete</code>.")
test("An integration access token works as a Bearer credential, within its permissions",'§17.2.4, §17.2.5',
 ["Open <b>Setup → Admin Settings → Integrations</b> (address <code>/admin/settings/integrations</code>), click <b>Create Integration</b>, give it a name and create it; the token dialog shows the token once (masked, with an eye and a Copy Token button). Close it and click <b>View Token</b>: it now explains the token is shown only once and offers <b>Regenerate Token</b>.",KEYH,"<code>GET {base}/records/&lt;object&gt;?limit=1</code> with <code>Authorization: Bearer &lt;token&gt;</code>, then <code>POST</code> a record. Set the integration to inactive and call again."],
 "The read answers <b>200</b> (clicked: 200 with the token, 401 with a wrong one), the write <b>403</b>, and an inactive or expired integration <b>401</b>. The token is stored only as a hash and is never returned after creation (suite). <b>OAuth is not built:</b> there is no authorization-code or client-credentials flow. API keys and access tokens are the supported mechanisms; credentials for calling out to other systems are held server-side in External Objects (Section 15).")

# ---------------- Part B incoming
test("An incoming webhook creates and updates a record",'§17.3.1–§17.3.3',
 [KEYH,"<code>POST {base}/webhooks/incoming</code> with <code>{\"objectApiName\":\"policy\",\"action\":\"create\",\"data\":{...},\"source\":\"partner\",\"eventType\":\"policy.sent\"}</code>; then the same with <code>\"action\":\"update\",\"recordId\":\"&lt;the new id&gt;\"</code>."],
 "Both answer <b>200</b>; the record exists and then changes. Validation rules apply (a failing rule answers <b>400</b> with every message) and the body is deduplicated if you send <b>X-Idempotency-Key</b>. Suite-proven; not clicked.")
test("An incoming webhook starts a Flow, or runs approved custom code, or just records an event",'§17.3.4–§17.3.6',
 [KEYH,"Add <code>\"flowId\":\"&lt;flow id&gt;\",\"recordId\":\"&lt;id&gt;\"</code> to the update request (the flow must be ticked for API triggering, otherwise <b>403</b>); then send <code>{\"customCode\":\"&lt;snippet name&gt;\",\"data\":{}}</code>; then send <code>{\"source\":\"erp\",\"eventType\":\"invoice.paid\",\"externalEventId\":\"ev-1\"}</code> with no object."],
 "The flow runs (the reply names it and says <b>success</b>); custom code runs only when its version is <b>Active</b> (a draft answers with the error <b>has no active version</b>); the event-only request is accepted and recorded, and sending the same <code>externalEventId</code> again does not create a second entry. See Test 23 for the log.")
test("Incoming webhooks are authenticated, tenant-specific and permission-checked",'§17.3.7, §17.6.4',
 [KEYH,"<code>POST {base}/webhooks/incoming</code> with no key, with a key for another tenant (or <code>X-Tenant-ID</code> of another tenant), with a read-only key, and with a key limited to other objects.","In <b>Setup → Admin Settings → Configuration</b> set a dummy <b>Webhook secret</b> for <i>Integration</i>; send the same body unsigned, with a wrong <code>X-Webhook-Signature</code>, and with <code>sha256=&lt;HMAC-SHA256 of the body using the secret&gt;</code>. Reset the setting afterwards."],
 "No key <b>401</b>; other tenant <b>403</b>; read-only and wrong-object keys <b>403</b>. With a tenant secret set, unsigned and wrongly signed requests answer <b>401</b> (and are logged as <b>webhook</b> authentication failures); the correct signature answers <b>200</b>. The signature check is optional: when no secret is configured, the API key alone authenticates the sender.")

# ---------------- Part C outgoing
test("An administrator configures an outgoing webhook; its signing secret is shown once",'§17.4.1, §17.2.6, §17.2.7',
 ["<b>Before you start:</b> run any small local program that accepts HTTP posts and prints them (a request-capture receiver of your choice) and note its address.",MON,"On <b>Outgoing Webhooks</b> click <b>New Webhook</b>. Name <b>S17 hook</b>, your address as <b>Endpoint URL</b>, tick <b>record.created</b>, <b>flow.completed</b> and <b>approval.completed</b>, type <b>claim_escalated</b> as the custom business event, set <b>Retries</b> 2, <b>Retry interval</b> 1, <b>Backoff</b> Exponential, and click <b>Create Webhook</b>."],
 "A yellow box shows the <b>Signing secret (shown once)</b>; after <b>I have copied it</b> it is gone and the list shows the webhook with its events (including <b>custom.claim_escalated</b>), <b>2 x 1s exponential</b>, delivered/failed counts and <b>Active</b>. The secret is encrypted at rest and never returned again. An unknown event name is refused with <b>400</b>.")
test("A test delivery arrives signed, and a failing receiver is reported",'§17.4.1, §17.5.7, §17.5.8',
 ["On the webhook row click <b>Test</b>. Read the toast and the receiver's output.","Make the receiver answer an error (HTTP 500) and click <b>Test</b> again."],
 "The first shows <b>Test delivered (HTTP 200)</b>; the receiver sees <code>X-Webhook-Event: test</code> and <code>X-Webhook-Signature: sha256=…</code>, which equals the HMAC-SHA256 of the body with the secret. The second shows <b>Test failed: Request failed with status code 500</b>. Both appear in the Integration Log (Test 23). The row's counters read <b>1 / 1</b>.")
test("Record created and deleted are delivered, with the fields you mapped",'§17.4.2–§17.4.4, §17.4.12',
 [MON,"Create a webhook with <b>record.created</b> and <b>record.deleted</b>, <b>Only these objects</b> <code>policy</code> and the <b>Payload mapping</b> <code>{\"policyNo\":\"policy_number\",\"status\":\"policy_status\",\"premium\":\"monthly_premium\"}</code> (custom fields).","Create a Credit Life policy (Policies → New: policy number <b>S17-HOOK-1</b>, status Active, premium 150, a start date) and then delete it from its page."],
 "The receiver gets <b>record.created</b> and then <b>record.deleted</b>, each signed, each with <code>object: policy</code>, the record id and exactly <code>policyNo</code>, <code>status</code> and <code>premium</code> in <code>data</code>; nothing else. <b>record.updated</b> behaves the same (suite). Undo: delete the webhook (Test 25) and clear the Recycle Bin entry.")
test("A webhook never sends a field its creator's role cannot see",'§17.1.2, §17.2, §17.4.12',
 ["Sign in as an administrator. On an object give a role <b>Hidden</b> on one field (<b>Setup → Roles → the role → field-level security</b>) and let that role manage webhooks (<b>Manage Webhooks</b>).","As a person with that role create a webhook on <b>record.created</b> and <b>record.updated</b> with no mapping, and a second with a mapping that names the hidden field. Create and then edit a record that has a value in the hidden field.",MON],
 "Neither the full-record payloads (create and update) nor the mapped payload contain the hidden field or its value. For the mapping the hidden field is <b>left out</b> (not refused); the Integration Log row reads <b>Note: Not sent (field security): &lt;field&gt;</b> and <b>Note: Mapping \"&lt;name&gt;\" names hidden field &lt;field&gt;: left out</b>. The rule uses the webhook <b>creator's</b> role; an administrator's webhook sends every field. A webhook whose creator is inactive or removed sends only the name field. Updates send the new values only (no previous values are sent). Suite-proven with a role that hides a field; not clicked.")
test("A Flow can raise a custom business event, and flow completion is reported",'§17.4.6, §17.4.11',
 ["Open <b>Setup → Automation → New</b>, choose <b>Record-Triggered Flow</b>, <b>Create Flow</b>, open <b>Steps</b>, <b>Add Step</b> and find <b>Raise Business Event</b> under <b>ACTIONS</b>. Give it the event name <b>claim_escalated</b> (do not save unless you want to keep the flow).","To see delivery: save a flow on an object with that step, with an active webhook that lists <b>custom.claim_escalated</b> and <b>flow.completed</b>, and create a record that meets it."],
 "The step exists and takes an event name (clicked). A saved flow sends <b>custom.claim_escalated</b> and then <b>flow.completed</b> (with the flow's name) to the subscribed webhook (suite; delivery not clicked). A flow also has the <b>HTTP Request</b> step for ad-hoc calls.")
test("Approval completed, lead received and communication sent are delivered, signed and logged",'§17.4.5, §17.4.7, §17.4.9',
 ["Subscribe a webhook to <b>approval.completed</b>, <b>lead.received</b> and <b>communication.sent</b>.","Approve (or reject) a pending request; create a record on an object whose API name is <code>lead</code>; open an Inbox conversation (<b>Setup → Channels → Test event</b> creates a synthetic inbound message) and send a reply.","Read the receiver, then the <b>Integration Log</b>."],
 "Each action sends its event once with <code>X-Webhook-Signature</code> equal to the HMAC of the body, and the log has an <b>outbound / success / 200</b> row for it. Suite-proven end to end with a local receiver (approval by a named approver, a record on a <code>lead</code> object, a reply on a synthetic channel with no real message). <b>lead.received</b> fires for any creation of a record on an object named <code>lead</code>, including the Facebook lead path (it uses the same hook; that path itself was not run because it calls Meta). My Company has no Lead object, so not clicked there. <b>Needs a person</b> to see the three in the screens.")
test("A failing receiver is retried with your count and backoff, and an administrator is told",'§17.5.10, §17.5.12, §17.5.13',
 [MON,"With the receiver answering 500, trigger a real event (Test 18), then open <b>Integration Log</b> and read the newest row.","Make the receiver answer 200 again and wait for the next retry (every 30 seconds) or call <code>POST {base}/webhooks/process-retries</code>.","After the last allowed attempt fails (receiver kept failing), open the <b>bell</b> notifications as an administrator."],
 "The failing row reads <b>retrying</b>, the HTTP status, the error and <b>attempt 1 of 3, next …</b> (retries + 1 attempts). When the receiver recovers the row becomes <b>success</b> and <b>delivered on attempt 2</b>. After the final attempt it reads <b>failed · attempt 3 of 3</b> and every administrator (and the webhook's creator) gets <b>Webhook … keeps failing</b> once the number of failed deliveries in a row reaches <b>Alert admins after N failures</b> (default 3; 0 = never). The bell was clicked: after three failed test deliveries the badge showed 1 and the entry read <b>Webhook \"…\" keeps failing — 3 deliveries in a row failed. Last HTTP status: 500</b> (the bell refreshes when the page loads).")
test("The Integration Log shows every column and only your tenant's traffic",'§17.5.1–§17.5.10',
 [MON,"Open <b>Integration Log</b>. Read the headings, then filter <b>Direction</b> to <b>Outbound</b> and <b>Result</b> to <b>Failed</b>."],
 "The columns are <b>Tenant, Integration, Direction, Date / time, Event, Endpoint, Result, HTTP status, Error details, Retry status</b>. Outgoing deliveries, incoming webhooks and API-key calls appear together. Another tenant never sees these rows (suite). <i>Limit:</i> the log shows the last 100–300 rows per source; there is no date filter and no export.")
test("No key, token, signing secret or Authorization header is ever in a log",'§17.2.6, §17.2.7, §17.5.11',
 [MON,"Read the <b>Integration Log</b>, <b>Authentication Failures</b> and <b>Outgoing Webhooks</b> tabs for any key, secret or header value. In <b>Setup → Audit Logs</b> read the entries for API key and webhook creation. Open a Flow's execution history."],
 "None is shown. Keys appear as an eight-character prefix; delivery rows keep only the field <i>names</i> once finished (the record values used for a retry are removed when the delivery succeeds or finally fails); a field called password, secret, token or key in an incoming body is stored as <b>[hidden]</b>. A search of the suite's audit, delivery, incoming and authentication-failure rows found none of the dummy secrets, keys or Authorization header.")
test("A webhook can be switched off, its secret changed, or the webhook removed, without touching business data",'§17.2.8, §17.6.6, §17.6.7',
 [MON,"Click <b>Deactivate</b> on a webhook, trigger an event, then <b>Activate</b>. Click <b>Delete</b>, then <b>Confirm delete</b>.","<b>Needs an API client:</b> <code>POST {base}/webhooks/&lt;id&gt;/rotate-secret</code> as an administrator and trigger an event."],
 "While inactive nothing is sent. Delete asks for a second click and removes the webhook (clicked); the old Integration Log rows remain labelled <b>(deleted webhook)</b>. Rotating returns a new secret once; the next delivery is signed with the new secret only (suite).")

n=len(T)
html=head+'''<div class="wrap">

  <header class="mast">
    <div class="eyebrow">Salesdam V3 · Client Acceptance Test</div>
    <h1>Integration Framework and API</h1>
    <p class="standfirst">A step-by-step script for BRD Section&nbsp;17. You create and rotate API keys, call the API with them, prove that another tenant, a wrong key or a missing key is refused and logged, watch the rate limit and usage figures, send incoming webhooks, configure outgoing webhooks to a receiver of your own, see signed deliveries, retries and alerts, and read the Integration Log.</p>
    <div class="mast-meta"><span><b>Scope</b> BRD §17</span><span><b>Tests</b> %d</span><span><b>Time</b> ~2 hours</span><span><b>Issued</b> 19 Nov 2026</span></div>
  </header>
  <div class="progress-bar"><span class="count" id="count">0 of %d complete</span><div class="track"><div class="fill" id="fill"></div></div><button class="btn-reset" id="reset" type="button">Reset</button></div>
<h2>Before you start</h2><div class="callout"><h3>Signing in</h3><dl class="creds"><dt>Address</dt><dd>http://localhost:5173</dd><dt>Who</dt><dd>An administrator who may manage API keys, integrations and webhooks</dd></dl>
  <p style="margin:12px 0 0;font-size:14px;color:var(--ink-soft)">Ask your Salesdam contact for the sign-in details. Pages can take 10–30 seconds to fill because the database is remote. The <b>Integrations</b> sidebar item is shown when the feature switch <code>VITE_FEATURE_INTEGRATIONS</code> is <code>true</code> for the web application.</p></div>
<div class="callout"><h3>What you need</h3><ul>
<li><b>A copy of your tenant.</b> Run the key, rate-limit and webhook tests in a copy, not in production: <b>Setup → Deployments → Clone Sandbox Tenant</b>, name it <b>S17 Sandbox</b>, switch to it with the <b>Tenant</b> switcher. A copy has no records, so record tests use <b>My Company</b> (Tests 3, 5 and 18).</li>
<li><b>An API client</b> (curl, Postman, a script) for the steps marked <i>Needs an API client</i>. Use only <b>your own throwaway keys</b>; a key is shown once in the screen and must not be pasted into chats, tickets or this manual.</li>
<li><b>A request receiver you run yourself</b> (any small local program that accepts HTTP posts and prints them). Never point a test at a real external system.</li></ul></div>
<div class="callout warn"><h3>Safe-testing rules</h3><ul>
<li>Rate-limit tests use a throwaway key with a low limit in a copy of the tenant. Do not hammer the sign-in page or any public address.</li>
<li>Use dummy secrets only. Never put real credentials into a webhook, header or configuration value while testing.</li></ul></div>
<div class="callout warn"><h3>Cleaning up</h3><ul>
<li>Delete or revoke your test keys and delete your test webhooks. Remove the Policy record S17-HOOK-1 (Recycle Bin). Switch back to your home tenant, then remove the copy with <b>Setup → Deployments → Delete sandbox…</b> (type its name).</li></ul></div>
'''%(n,n)
idx=lambda t:[k for k,(a,*_) in enumerate(T,1) if a.startswith(t)][0]
secs={1:('API keys, the API and API governance','BRD §17.1, §17.2, §17.6 — credentials, what the API serves, refusals, limits, usage and rotation.'),
 idx('An incoming webhook creates'):('Incoming webhooks','BRD §17.3 — external systems notify Salesdam.'),
 idx('An administrator configures'):('Outgoing webhooks, monitoring and error handling','BRD §17.4, §17.5 — events, payloads, retries, alerts and the Integration Log.')}
for k,(title,ref,steps,exp) in enumerate(T,1):
    if k in secs: html+='<h2>%s</h2><p class="sec-note">%s</p>'%secs[k]
    steps=[x.replace('{base}','http://localhost:5002/api/v1') for x in steps]
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
<li><b>OAuth is not built</b> (no authorization-code or client-credentials flow). API keys and Bearer access tokens are the supported credentials; there is no other mechanism type.</li>
<li><b>Authentication of incoming webhooks</b> is the API key or access token (always) plus an optional tenant HMAC secret. A per-webhook signing secret for senders, replay windows and IP allow-lists per webhook are not built (a key can have an IP list).</li>
<li><b>Rate limiting</b> is per key, in memory in each server process; with several servers each applies its own count (restarting a server resets it). There is also the platform-wide per-address limit. There is no per-tenant quota or billing meter.</li>
<li><b>Webhook payloads</b> carry the record's fields selected by your mapping (or all fields if you leave it blank) <i>minus</i> anything the webhook creator's role cannot see (Test 19).</li>
<li><b>Tokens created before this release</b> were stored in readable form; regenerate them in <b>Setup → Admin Settings → Integrations</b> (new tokens are stored only as a hash).</li>
<li><b>Custom code cannot raise events</b> for webhooks; only a Flow's Raise Business Event step can.</li><li><b>Revoke</b> and <b>Rotate</b> ask for a browser confirmation that tools cannot answer: <b>Needs a person</b>.</li>
<li><b>The Integration Log</b> has no date filter or export, and a call refused by the rate limit appears under Authentication Failures rather than usage.</li></ul></div>
'''
html+=tail
open('section17-test-manual.html','w').write(html)
print(n,'tests')
