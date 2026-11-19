s=open('section13-test-manual.html').read()
head=s[:s.index('<div class="wrap">')].replace('Deployment Test Manual','Tenant Configuration Test Manual').replace('Deployment and Environments','Tenant Configuration')
tail=s[s.index('<script>'):].replace('salesdam-s13-tests-v1','salesdam-s14-tests-v1')
T=[]
def test(title,ref,steps,expect): T.append((title,ref,steps,expect))
CFG="Open <b>Setup → Admin Settings</b> and click the <b>Configuration</b> card."
test("A company sees every setting it may change, and whether each is its own value or the platform default",'§14.1, §14.3',
 ["Sign in as an administrator. "+CFG,
  "Read the list. Each row shows the setting's name, its key, a description, the current value, and a badge."],
 "The page lists about 34 settings (approval threshold, recycle-bin retention, default currency, minimum deal value, communication consent, branding, integration credentials, call-recording retention, file limits, password and login rules, MFA and single sign-on). A setting nobody has changed carries <b>Platform default</b>; one the company has changed carries <b>Company value</b> and a <b>Reset</b> button.")
test("A company value overrides the platform default, and Reset brings the default back",'§14.1, §14.2 (resolution order)',
 ["On the Configuration page change <b>Default Currency</b> from <b>ZAR</b> to <b>USD</b> and click <b>Save</b>.",
  "Read the row, then click <b>Reset</b> on it."],
 "After Save the badge reads <b>Company value</b> and a Reset button appears. After Reset the badge returns to <b>Platform default</b> and the value to <b>ZAR</b>. (Clicked; the same check was repeated for the Approval Threshold Amount in Section 8 and the Minimum Deal Value in Section 6.)")
test("A platform-wide default reaches every company that has not set its own, and a company value still wins",'§14.2, §14.3 (operator level)',
 ["<b>Needs an API call:</b> as a Super User call <code>PUT /api/v1/configuration/defaults/platform.default_currency</code> with <code>{\"value\":\"EUR\"}</code>. The screen offers no editor for an existing default; its <b>Add platform setting</b> box creates new ones.",
  "Open the Configuration page in a tenant that has no override: the row shows <b>EUR</b> with the <b>Platform default</b> badge.",
  "Save <b>USD</b> as that company's value, then click <b>Reset</b>. Finally <code>DELETE /api/v1/configuration/defaults/platform.default_currency</code>."],
 "Order of precedence seen at each step: <b>ZAR</b> (built-in default) → <b>EUR</b> (operator default) → <b>USD</b> (company value) → after Reset <b>EUR</b> → after deleting the operator default <b>ZAR</b>. The three levels are exactly: the company's own entry, then the platform entry, then the built-in value.")
test("A Super User can add a brand-new platform setting from the screen",'§14.1, §14.3',
 ["As a Super User click <b>Add platform setting</b>. Type the key <code>s14.demo_limit</code>, label <b>S14 Demo Limit</b>, default value <b>7</b>, and click <b>Add for every company</b>.",
  "Check the row appears. (Afterwards remove it: <code>DELETE /api/v1/configuration/defaults/s14.demo_limit</code>.)"],
 "The row <b>S14 Demo Limit</b> appears with the <b>Platform default</b> badge and the key. Validation rules can read it with <code>CONFIG(\"s14.demo_limit\")</code>. The box is shown to Super Users only.")
test("A setting the operator has locked cannot be changed by a company",'§14.3 (key exposure)',
 ["<b>Needs an API call to prepare:</b> as a Super User create a platform setting with <code>\"editableByTenant\": false</code> (<code>PUT /api/v1/configuration/defaults/s14.locked_setting</code>).",
  "Open the Configuration page and find the row <b>S14 Locked</b>.",
  "Try to save a value for it through the API: <code>PUT /api/v1/configuration/s14.locked_setting</code>. Remove the setting afterwards."],
 "The row is shown but its field and Save button are greyed out (clicked). The API answers <b>403 Configuration key 's14.locked_setting' is not available for tenant override.</b> An unknown key is refused the same way.")
test("A company administrator who is not a Super User cannot change platform defaults",'§14.3',
 ["<b>Needs a person:</b> sign in as an ordinary company administrator (not a Super User) in a second browser window. Open Configuration: every setting is listed, an ordinary one (for example <b>Recycle Bin Retention</b>) can be saved and reset, the locked row from test 5 is greyed out, and there is no <b>Add platform setting</b> box.",
  "Then call <code>PUT /api/v1/configuration/defaults/records.recycle_bin_retention_days</code> from that window."],
 "The platform-defaults call answers <b>403</b>, as do the matching <b>GET</b> and <b>DELETE</b>. Proved by the suite <code>section14-config</code> (40/40), which creates a throwaway tenant with a real, non-Super-User administrator (random password, never printed), signs in over HTTP and checks: can view the list, can override and reset an editable key, cannot override a locked key (403), cannot read, change or delete operator defaults (403). The screen itself was not clicked as that person: the browser pane holds one signed-in user.")
test("One company's settings never change another company's",'§14.5, §14.12',
 ["Create a copy of your working tenant (<b>Setup → Deployments → Clone Sandbox</b>, Section 13). In the top bar <b>Tenant</b> switcher choose the copy, open Configuration, and set a company name, colour and logo (test 12).",
  "Switch back to your working tenant and open Configuration and look at the page header."],
 "The working tenant still shows <b>Salesdam</b>, the default colour and no logo; its Branding rows say <b>Platform default</b>. The pre-sign-in branding address (test 14) returns the copy's branding for the copy and the default for the working tenant. The suites <code>tenant-isolation</code> (23/23) and <code>section14-config</code> prove the same for two tenants.")
test("Validation rules, approvals, flows and the recycle bin read these settings",'§14.2 (applies uniformly)',
 ["No new steps: these were clicked in earlier sections. Validation rule <code>CONFIG(\"deals.minimum_value\")</code> follows the Configuration page (Section 6, Test on CONFIG); an approval entry criterion reads the Approval Threshold Amount (Section 8); the recycle-bin purge reads its retention days per tenant (Section 3); flows read settings through the same <code>CONFIG()</code> function.",
  "Settings that are stored but not yet read by any behaviour are listed under <b>Known limits</b>."],
 "Each behaviour reads the company's own value first, then the platform value, then the built-in default. Single sign-on, password policy, lockout, MFA, file-size and file-type limits, default currency, call-recording retention, communication consent, the default communication template and the WhatsApp, Meta, telephony and webhook keys also read the company's value first (tests 9–11 and the credential tests near the end).")
test("Branding is set from a screen: company name, colour, header logo and login-page logo",'§14.4, §14.6–§14.10, §14.16',
 ["In the throwaway tenant (see <b>Before you start</b>) open Configuration. In the <b>Company Name</b> row type <b>Acme S14</b> and click <b>Save</b>.",
  "In <b>Primary Brand Colour</b> type <b>#B8312F</b> (a colour picker appears beside the box once the value is a valid colour) and click <b>Save</b>.",
  "In <b>Company Logo URL</b> and <b>Login Page Logo URL</b> use the file button to choose a small PNG (up to 500 KB; a preview appears) or paste an https address, then click <b>Save</b> on each row. <b>Needs a person:</b> the operating-system file chooser cannot be driven here; the acceptance run supplied the file to the same handler."],
 "Each row turns to <b>Company value</b> and a green message names the setting. No developer, deployment or restart was needed.")
test("The company logo and colour appear on every standard screen",'§14.7, §14.9, §14.10, §14.11',
 ["Reload the page and look at the top bar and the user avatar. Then open <b>Audit Logs</b> from the sidebar and look again.",
  "Click a different workspace in the sidebar and look again (not clicked in the acceptance run)."],
 "The top bar shows the company logo (our test image, 64 px square shown at 24 px) and the avatar and accents take the company colour (<b>#B8312F</b>). Seen on the Configuration and Audit Logs screens (clicked). The bar is part of the shared page frame, so every workspace and standard screen uses it. The company name is shown in place of the logo when no logo is set.")
test("The login page shows the company's own logo and name before anyone signs in",'§14.8',
 ["Open the public branding address, with no sign-in: <code>GET /api/v1/configuration/public-branding?tenant=&lt;tenant id or slug&gt;</code>.",
  "Open the login page without signing out of the administrator window: use a second browser or a private window, or the same machine under the other host name (<code>http://127.0.0.1:5173/login?tenant=&lt;tenant id&gt;</code> when you normally use <code>localhost</code>), so no sign-in cookie applies. A browser that has signed in to the tenant before shows the same branding without the <code>?tenant=</code> part."],
 "The address answers with only the four branding values (company name, colour, logo, login logo): <b>Acme S14</b>, <b>#B8312F</b> and the images for the copy; <b>Salesdam</b>, <b>#0066FF</b> and no logo for the default. Nothing else is exposed, no key marked secret is ever returned, and the address is rate limited (120 a minute per visitor). Before this change the login page asked for the authenticated settings list, so it could only ever show Salesdam. <b>Clicked (second host name):</b> the login screen for the copy read <b>Acme S14b</b> in place of Salesdam and its <b>Sign in</b> button took the company colour (<b>rgb(5, 5, 15)</b>); with no tenant given the same screen read <b>Salesdam</b> in the default colour (<b>#244C64</b>). The header logo is read from the same value; a login-page logo image was not seen on screen in this run.")
test("Clearing a branding value falls back to the Salesdam default",'§14.12, §14.13, §14.14',
 ["In the throwaway tenant click <b>Reset</b> on each of the four Branding rows.",
  "Reload and look at the top bar and the public branding address from test 14."],
 "The rows return to <b>Platform default</b>, the top bar shows <b>Salesdam</b> with no logo and the default blue (<b>#0066FF</b>), and the public address returns the defaults.")
test("Unusable branding values are refused with a clear message",'§14.15',
 ["In <b>Primary Brand Colour</b> type <b>red</b> and click <b>Save</b>.",
  "Through the API try a logo of <code>javascript:alert(1)</code> and a company name of 81 characters."],
 "The screen shows <b>Primary colour must be a hex colour such as #0066FF.</b> (clicked). The API refuses the logo (<b>Logo must be an http(s) URL or a PNG, JPEG, GIF or WebP image.</b>) and the long name (<b>Company name must be 80 characters or fewer.</b>); a logo over 500 KB is refused too. Nothing is stored.")
test("A very light brand colour cannot make the screen unreadable",'§14.15 (accessibility)',
 ["Save the colour <b>#FFFF99</b> (pale yellow) on the throwaway tenant, then reload and read the top bar and buttons."],
 "The application darkens any colour whose contrast against white text is below 3:1, so <b>#FFFF99</b> is shown as <b>#97975A</b> and white text stays readable. The saved value is unchanged; only the displayed shade is corrected. A very dark colour is handled in the dark theme: <b>#05050F</b> is shown as <b>#717177</b> when the dark theme is switched on, and as saved in the light theme (clicked, read from the page). The workspace avatar in the sidebar uses the same corrected shade.")
test("Branding does not break the layout on a phone",'§14.15 (layout, responsiveness)',
 ["With the branding saved, make the browser window phone width (375 px) and reload any screen.",
  "Return to the desktop width."],
 "No sideways scrolling (page width equals window width), the logo is held to 24 × 24 px in the top bar, and the menu and Configuration page work as before.")
test("A saved credential is masked on the screen and in every answer from the server",'§14.2.11',
 ["In a throwaway tenant, on the Configuration page, find <b>SMTP Password</b> (key <code>integration.email.smtp_password</code>). The box is a password field. Type a dummy value (never a real one) and click <b>Save</b>.",
  "Look at the row after saving, and open the page's text. Do the same for <b>Telephony API Key</b> through the API."],
 "After saving, the box shows <b>••••••••</b>; the dummy value appears nowhere on the page. The settings list answers <b>••••••••</b> for every credential, and the answer to the save itself no longer carries the value (not even in encrypted form). Credentials are never sent back.")
test("Credentials are encrypted in the database, and kept out of logs, audit records and formulas",'§14.2.11',
 ["<b>Needs a person with database access (read-only):</b> read the stored configuration row, the email-sender row and the webhook row for the dummy credentials. Read the Audit Logs screen and the server log for the dummy text.",
  "Write a validation rule or flow formula that calls <code>CONFIG(\"integration.email.smtp_password\")</code>."],
 "The stored values begin <b>enc:</b> followed by random text (AES-256-GCM, a fresh random value per save); the dummy text is not in the row. The audit entry records only the key name (<b>tenant_config_update</b>), and the server log and audit records do not contain the dummy text. Formulas receive nothing for a credential key, so a rule cannot copy a secret into a record or an error message. The key is the server's <code>ENCRYPTION_KEY</code> setting; the server now refuses to start in production without it. There is no automatic key rotation.")
test("An email sender's password and a webhook's signing secret are encrypted too",'§14.2.2, §14.2.7, §14.2.11',
 ["Create an email sender (the Email Senders screen, or <code>POST /api/v1/email-senders</code>; the acceptance run used the API) with a dummy SMTP password, and a webhook with <code>POST /api/v1/webhooks</code>. List both through the screens or API.",
  "<b>Needs a person with database access:</b> read both stored rows."],
 "The sender list never contains the user name or password. A webhook shows its signing secret once, at creation, and never again. Both are stored as <b>enc:…</b>. Sending mail and signing webhook calls still work: the model decrypts on use. Rows saved before this change are still read correctly (as plain text) and are encrypted the next time they are saved.")

NEW=[]
def ntest(*a): NEW.append(a)
ntest("The company's default currency decides what the application shows and what new records get",'§14.1 (default currency), §14.2',
 ["On the Configuration page set <b>Default Currency</b> to <b>EUR</b> and click <b>Save</b>. Open <b>Setup → Admin Settings → Company Information</b>.",
  "Create a record on an object that has a <b>Currency</b> field (for example a Deal) and leave the field empty. Then click <b>Reset</b> on <b>Default Currency</b>."],
 "Company Information reads <b>Selected currency: Euro (EUR)</b> (clicked; it read South African Rand before). The sign-in session carries EUR, so every amount the application formats uses it. A new record with an empty Currency field receives the tenant's code (suite; not clicked). The order is the company's value, then a platform-wide value (test 3), then the built-in ZAR; another company is unaffected. A company that only ever used the older Operating Currency box on Company Information keeps that choice until a Default Currency is set.")
ntest("Call recordings are cleared after the company's retention period, and only for companies that set one",'§14.2.10',
 ["Set <b>Call Recording Retention (days)</b> to <b>7</b> on a throwaway tenant. The built-in value is <b>0</b>, which keeps recordings for ever.",
  "<b>Needs a person with database access:</b> add two call activities carrying a recording link, one 30 days old and one 1 day old, and a 400-day-old call in a second tenant that has no retention set. Wait for the hourly sweep (or run it from a script)."],
 "Only the 30-day-old call in the tenant with the 7-day window loses its recording link (a purge time is stamped; the call itself, who, when and how long, stays). The 1-day-old call and the other tenant's 400-day-old call are untouched. A value of 0 or a negative number purges nothing. Proved by the suite with throwaway data (the purge job mirrors the recycle-bin job: hourly, one tenant at a time, a failure in one tenant does not stop the rest). The Configuration row itself was saved by clicking, as in test 2.")
ntest("Communication consent settings stop an opted-out client being contacted, wherever the message is sent",'§14.2.9',
 ["Set <b>Enforce Communication Consent</b> to <b>Yes</b> on a throwaway tenant. Record that a client has opted out of email (Section 17's consent screen), then queue an email to that client (a policy communication, an Inbox reply, a flow's send step or custom code)."],
 "With enforcement on the send is refused with <b>Contact blocked: consent withdrawn</b>; with enforcement off, the default, it goes ahead. <b>Default Opt-In (unknown consent)</b> decides what happens for clients with no record. The Inbox, flow and custom-code paths already checked consent; the queued policy communications did not and now do (suite).")
ntest("A channel uses the company's own WhatsApp, Meta and telephony credentials first, then the platform's, and never another company's",'§14.2.3–§14.2.6, §14.2.12, §14.2.13',
 ["On a throwaway tenant save <b>WhatsApp Access Token</b>, <b>Meta App Secret</b> and <b>Telephony API Key</b> with dummy values. A Super User may also save a platform-wide default for the same keys (test 3).",
  "<b>Needs a person with a test channel:</b> send a WhatsApp message and post a signed inbound telephony call to a channel account that has no credential of its own."],
 "The WhatsApp request carries the channel account's own token if it has one, else the company's, else the platform's, else the message stays <b>queued</b> with <b>Missing accessToken</b>. An inbound call or Meta message is accepted only if it is signed with the account's secret, else the company's key, else the platform's; a different company's key is refused (<b>401</b>). Proved by the suite with the HTTP call to the provider stubbed (no message is sent); not clicked.")
ntest("Email sending uses the company's own stored credentials (captured, not delivered)",'§14.2.2, §14.2.11',
 ["<b>Needs a person with a mail catcher:</b> start any local SMTP catcher on the machine (for example MailHog, or <code>python3 -m aiosmtpd -n -l 127.0.0.1:1025</code>). Create an email sender on a throwaway tenant: host <code>127.0.0.1</code>, port <b>1025</b>, a dummy user and a dummy password.",
  "Click the sender's <b>Send test email</b> (or <code>POST /api/v1/email-senders/&lt;id&gt;/test</code> with a <code>to</code> address)."],
 "The catcher receives one message and shows the dummy user and password in its sign-in step: the application decrypts the stored password to use it. The answers to the create, test and list calls, and the application log, never contain the password. Proved by the suite with its own capture server (nothing left the machine).")
ntest("A webhook is signed with the company's secret, on the first try and on a retry",'§14.2.7, §14.2.11',
 ["<b>Needs a person with a local receiver:</b> run any local HTTP receiver that prints the <code>X-Webhook-Signature</code> header and the raw body. Create a webhook pointing at it (<code>POST /api/v1/webhooks</code>) and keep the secret from the answer: it is shown once.",
  "Call <code>POST /api/v1/webhooks/&lt;id&gt;/test</code>. For a retry, record a failed delivery log row that is due, or let a real failed delivery be retried."],
 "The receiver gets <b>sha256=</b> plus the HMAC-SHA256 of the body computed with the secret you saved, both for the test and for the retry (recomputed in the suite and compared). The delivery log and the webhook list never show the secret. A secret or company id supplied by the caller in the create call is ignored; before this change a caller-supplied secret was stored while a different one was shown.")
ntest("A secret is not exposed anywhere else: reports, flows, search, audit history, logs and exports",'§14.2.11',
 ["With dummy credentials saved (the credentials tests above), search for the word <b>integration</b>, open Audit Logs and read the change entries, and read the Configuration, Channel Accounts, Email Senders and Webhooks lists.",
  "Write a validation rule or a flow formula that reads a credential with <code>CONFIG(\"integration.meta.app_secret\")</code>."],
 "No screen or answer contains a dummy value. The change history records only that a key changed, never its value. Credentials are not held in any record object, so the report builder, dashboard widgets, Data Export and search (which read records only) cannot reach them; flows and approvals receive nothing for a credential key, so it cannot be copied into a record, an error message or a flow's history. Proved by the suite, which searches every answer, the audit records, the stored rows and the application log for random dummy text. A custom field a company creates to hold a secret is an ordinary field and is exported and reported like any other.")

i8=[k for k,(a,*_) in enumerate(T) if a.startswith('Validation rules, approvals')][0]
for j,nt in enumerate(NEW[:3]): T.insert(i8+1+j,nt)
T.extend(NEW[3:])
html=head+'''<div class="wrap">

  <header class="mast">
    <div class="eyebrow">Salesdam V3 · Client Acceptance Test</div>
    <h1>Tenant Configuration</h1>
    <p class="standfirst">A step-by-step script for BRD Section&nbsp;14. You see which settings a company can change, override one and reset it, watch the platform default take over, set a company's name, colour and logos and see them appear (and fall back), and prove that saved credentials are masked, encrypted and kept out of logs. Everything that changes data happens in a throwaway copy of a tenant, which is deleted at the end.</p>
    <div class="mast-meta"><span><b>Scope</b> BRD §14</span><span><b>Tests</b> %d</span><span><b>Time</b> ~75 minutes</span><span><b>Issued</b> 19 Nov 2026</span></div>
  </header>
  <div class="progress-bar"><span class="count" id="count">0 of %d complete</span><div class="track"><div class="fill" id="fill"></div></div><button class="btn-reset" id="reset" type="button">Reset</button></div>
<h2>Before you start</h2><div class="callout"><h3>Signing in</h3><dl class="creds"><dt>Address</dt><dd>http://localhost:5173</dd><dt>Who</dt><dd>An administrator (Super User) of the tenant being tested</dd></dl>
  <p style="margin:12px 0 0;font-size:14px;color:var(--ink-soft)">Ask your Salesdam contact for the sign-in details. Pages can take 10–30 seconds to fill because the database is remote. The Configuration page is under <b>Setup → Admin Settings → Configuration</b>. The top-bar <b>Tenant</b> switcher decides which tenant you are changing.</p></div>
<div class="callout"><h3>Prepare a throwaway tenant</h3><ul>
<li>Open <b>Setup → Deployments</b>, choose your working tenant under <b>Clone Sandbox Tenant</b>, name the copy <b>S14 Config Sandbox</b> and click <b>Clone</b>. Switch to it with the <b>Tenant</b> switcher.</li>
<li>Use dummy credentials only. Never type a real password, token or key into this script.</li></ul></div>
<div class="callout warn"><h3>Cleaning up</h3><ul>
<li>Switch back to your working tenant, then delete the copy with <b>Setup → Deployments → Delete sandbox…</b> (type its name). This removes its settings, credentials, email senders and webhooks.</li>
<li>Remove any platform setting you created (tests 3–5) and return any value you changed in your working tenant with <b>Reset</b>.</li></ul></div>
<h2>Settings and the order they are read in</h2><p class="sec-note">BRD §14.1–§14.3 — the company's value, then the platform's, then the built-in default.</p>
'''%(len(T),len(T))
idx=lambda t:[k for k,(a,*_) in enumerate(T,1) if a.startswith(t)][0]
secs={idx('Branding is set'):('Branding','BRD §14.4–§14.16 (tenant branding) — name, colour and logos per company, with a Salesdam fallback.'),idx('A saved credential'):('Credentials and secrets','BRD §14.2 (communication and integration configuration) — masked, encrypted and kept out of logs.')}
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
<li><b>Settings now acted on:</b> default currency, call-recording retention (0 = keep), communication consent, default communication template, and the WhatsApp, Meta, telephony and webhook keys. <b>Still not built:</b> the Meta Messenger/Instagram <i>page</i> token and each channel account's own provider credentials keep living on the channel account (encrypted), because they are per page or number, not per company; call recordings themselves are not stored by Salesdam, only their link, so retention removes the link; no setting yet drives the language or time zone.</li>
<li>The Configuration screen cannot edit an existing platform-wide default (only add a new one); that is done through the API, by a Super User.</li>
<li>Logos are uploaded as a small image (up to 500 KB) or linked by address. The login page needs to know the tenant: it uses <code>?tenant=</code> in the address or the tenant last used in that browser; an address without either shows Salesdam.</li>
<li>The browser tab title on application pages and the workspace name in the sidebar are not branded; the company name appears in the top bar when no logo is set.</li>
<li><b>Encryption key.</b> Credentials are encrypted with the server's <code>ENCRYPTION_KEY</code> setting (documented in <code>.env.example</code>). In production the server <b>refuses to start</b> without it; set it to a long random value (<code>node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"</code>) in the server's environment, and keep a copy: without the key stored credentials cannot be read. To change the key, run <code>node scripts/rotateEncryptionKey.mjs</code> with <code>OLD_ENCRYPTION_KEY</code> and the new <code>ENCRYPTION_KEY</code> set (a dry run first, then <code>--apply</code>); it re-encrypts configuration secrets, email-sender passwords, webhook secrets, channel-account credentials and MFA secrets. The re-encryption helper is covered by a suite check; the full script was not run against live data.</li>
<li>The deployment package (Section 13) deliberately omits credentials.</li></ul></div>

'''+tail
open('section14-test-manual.html','w').write(html)
print(len(T))
