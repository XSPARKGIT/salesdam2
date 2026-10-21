import { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { ArrowLeft, ArrowRight, Check, Plus, X, AlertTriangle, BadgeCheck, FileSignature } from 'lucide-react';
import Layout from '../../../layout/Layout';
import Button from '../../../components/common/Button/Button';
import { useObjectPermissions } from '../../../hooks/useObjectPermissions';
import { getRecord } from '../../../services/api/records';
import {
  listInsuranceProducts,
  getProductVersionRules,
  startApplication,
  saveApplicationPart,
  priceApplication,
  captureAcceptance,
  validateApplication,
  submitApplication,
  issuePolicy,
} from '../../../services/api/insurance';
import PersonFields from './PersonFields';
import {
  STEPS,
  CHANNELS,
  PAYMENT_METHODS,
  EMPTY_FORM,
  emptyPerson,
  personPayload,
  toNumber,
  loadSavedApplication,
} from './newBusinessForm';
import styles from './NewBusiness.module.css';

const money = (v) =>
  v === undefined || v === null || v === ''
    ? '—'
    : `R ${Number(v).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const humanize = (v) => (v ? String(v).replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : '');
const errMessage = (err, fallback) => err?.response?.data?.message || err?.message || fallback;
const newKey = () =>
  globalThis.crypto?.randomUUID?.() || `nb-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/**
 * Insurance new business (Insurance BRD §2, §7, §10): product → members →
 * quote → acceptance → submit → issue. Each step is saved to the application
 * on the server, so a refresh resumes where the user left off.
 *
 * Route: /insurance/new-business[?application=<policyId>][&client=<id>][&lead=<id>]
 */
export default function NewBusinessWizard() {
  const [searchParams] = useSearchParams();
  // Read once: the wizard writes ?application= itself after step 1, and that
  // must not reload the page state it already holds.
  const [initialAppId] = useState(() => searchParams.get('application'));
  const clientId = searchParams.get('client');
  const leadId = searchParams.get('lead');
  const perms = useObjectPermissions('policy');

  const saved = useQuery({
    queryKey: ['new-business-resume', initialAppId],
    queryFn: () => loadSavedApplication(initialAppId),
    enabled: !!initialAppId,
    staleTime: 0,
    retry: false,
  });
  const client = useQuery({
    queryKey: ['new-business-client', clientId],
    queryFn: () => getRecord('client', clientId),
    enabled: !initialAppId && !!clientId,
    retry: false,
  });

  const shell = (body) => (
    <Layout title="New policy" description="Sell a new insurance policy">
      <div className={styles.page}>{body}</div>
    </Layout>
  );

  if (!perms.canCreate || !perms.canUpdate) {
    return shell(<div className={styles.notice}>You need permission to create and edit policies to sell a new policy.</div>);
  }
  if (saved.isLoading || client.isLoading) return shell(<div className={styles.notice}>Loading…</div>);
  if (saved.isError) {
    return shell(
      <div className={styles.notice}>
        This application couldn’t be loaded. <Link to="/insurance/new-business">Start a new one</Link>
      </div>,
    );
  }
  // Already submitted or further along: servicing happens on the policy record.
  if (saved.data && !['application_started', 'quote_generated'].includes(saved.data.status)) {
    return <Navigate to={`/o/policy/${initialAppId}`} replace />;
  }

  let initial = saved.data?.form || EMPTY_FORM;
  if (!saved.data) {
    initial = { ...EMPTY_FORM, leadId: leadId || '' };
    if (client.data) {
      initial.main = {
        ...initial.main,
        name: client.data.name || '',
        id_number: client.data.id_number || '',
        email: client.data.email || '',
        phone: client.data.phone || '',
        client_id: clientId,
      };
    }
  }

  return (
    <WizardForm
      initial={initial}
      initialStep={saved.data?.step ?? 0}
      initialAppId={initialAppId}
      initialAcceptance={saved.data?.acceptance || null}
      shell={shell}
    />
  );
}

function WizardForm({ initial, initialStep, initialAppId, initialAcceptance, shell }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [, setSearchParams] = useSearchParams();

  const [form, setForm] = useState(initial);
  const [step, setStep] = useState(initialStep);
  const [appId, setAppId] = useState(initialAppId);
  const [acceptance, setAcceptance] = useState(initialAcceptance);
  const [idempotencyKey] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [quoteVersion, setQuoteVersion] = useState(0); // bump after saves to re-price
  const [accept, setAccept] = useState({ confirmed: false, terms: '', signature: '', recording: '', fallback: false });
  const [submitted, setSubmitted] = useState(null);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  /* ── Product data ──────────────────────────────────────────────────── */
  const { data: products = [], isLoading: loadingProducts } = useQuery({
    queryKey: ['insurance-products'],
    queryFn: listInsuranceProducts,
    staleTime: 0,
  });
  const versions = useMemo(
    () =>
      products.flatMap((p) =>
        (p.versions || [])
          .filter((v) => !v.status || v.status === 'active')
          .map((v) => ({ ...v, productName: p.name })),
      ),
    [products],
  );
  const version = versions.find((v) => v.id === form.productVersionId);
  const { data: rules } = useQuery({
    queryKey: ['product-version-rules', form.productVersionId],
    queryFn: () => getProductVersionRules(form.productVersionId),
    enabled: !!form.productVersionId,
  });
  const limits = rules?.limits || {};
  const coverOptions = useMemo(
    () =>
      [...new Set((rules?.benefit_covers || []).map((c) => Number(c.cover_amount)).filter((n) => !Number.isNaN(n)))].sort(
        (a, b) => a - b,
      ),
    [rules],
  );
  const ageHint =
    limits.min_entry_age != null || limits.max_entry_age != null
      ? `Entry age ${limits.min_entry_age ?? 0}–${limits.max_entry_age ?? '∞'}`
      : null;

  /* ── Quote & review data ───────────────────────────────────────────── */
  const quote = useQuery({
    queryKey: ['application-quote', appId, quoteVersion],
    queryFn: () => priceApplication(appId),
    enabled: !!appId && step === 4,
    retry: false,
    staleTime: 0,
  });
  const validation = useQuery({
    queryKey: ['application-validate', appId, quoteVersion, !!acceptance],
    queryFn: () => validateApplication(appId),
    enabled: !!appId && step === 6 && !submitted,
    retry: false,
    staleTime: 0,
  });

  /* ── Saving each step ──────────────────────────────────────────────── */
  const run = async (fn) => {
    setBusy(true);
    try {
      await fn();
      return true;
    } catch (err) {
      toast.error(errMessage(err, 'That step couldn’t be saved.'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const mainPayload = () =>
    form.main.client_id
      ? { client_id: form.main.client_id, age: toNumber(form.main.age), cover_amount: toNumber(form.main.cover_amount) }
      : personPayload(form.main, { age: toNumber(form.main.age), cover_amount: toNumber(form.main.cover_amount) });

  const saveStep = async () => {
    if (step === 0) {
      if (!form.productVersionId) return toast.error('Choose a product.');
      if (appId) return true; // product & channel are fixed once the application exists
      return run(async () => {
        const state = await startApplication({
          channel: form.channel,
          product_version_id: form.productVersionId,
          lead_id: form.leadId || undefined,
          idempotency_key: idempotencyKey,
        });
        setAppId(state.policy.id);
        setSearchParams((p) => {
          const next = new URLSearchParams(p);
          next.set('application', state.policy.id);
          return next;
        }, { replace: true });
      });
    }
    if (step === 1) {
      const m = form.main;
      if (!m.client_id && !m.name.trim()) return toast.error('Enter the main member’s name.');
      if (!m.client_id && !m.id_number.trim() && !m.email.trim() && !m.phone.trim()) {
        return toast.error('Add an ID number, email or phone so the member can be matched to an existing client.');
      }
      if (m.age === '') return toast.error('Enter the main member’s age.');
      const age = Number(m.age);
      if (limits.min_entry_age != null && age < limits.min_entry_age) return toast.error(`Minimum entry age is ${limits.min_entry_age}.`);
      if (limits.max_entry_age != null && age > limits.max_entry_age) return toast.error(`Maximum entry age is ${limits.max_entry_age}.`);
      if (m.cover_amount === '') return toast.error('Choose a cover amount.');
      return run(async () => {
        const state = await saveApplicationPart(appId, 'main-member', mainPayload());
        if (form.payerSame) {
          await saveApplicationPart(appId, 'premium-payer', { client_id: state.policy.main_member });
        }
      });
    }
    if (step === 2) {
      if (form.spouse.enabled && !form.spouse.name.trim()) return toast.error('Enter the spouse’s name, or remove the spouse.');
      if (form.children.some((c) => !c.name.trim())) return toast.error('Every child needs a name.');
      if (form.extended.some((e) => !e.name.trim() || e.cover_amount === '')) {
        return toast.error('Every extended family member needs a name and their own cover amount.');
      }
      return run(async () => {
        if (limits.allow_spouse) {
          await saveApplicationPart(
            appId,
            'spouse',
            form.spouse.enabled ? personPayload(form.spouse, { age: toNumber(form.spouse.age) }) : { remove: true },
          );
        }
        if (limits.allow_children) {
          await saveApplicationPart(appId, 'children', {
            children: form.children.map((c) => personPayload(c, { age: toNumber(c.age) })),
          });
        }
        if (limits.allow_extended_family) {
          await saveApplicationPart(appId, 'extended-family', {
            members: form.extended.map((e) => personPayload(e, { age: toNumber(e.age), cover_amount: toNumber(e.cover_amount) })),
          });
        }
        setQuoteVersion((v) => v + 1);
      });
    }
    if (step === 3) {
      if (!form.payerSame && !form.payer.name.trim()) return toast.error('Enter the premium payer’s name.');
      if (form.beneficiary.enabled && !form.beneficiary.name.trim()) return toast.error('Enter the beneficiary’s name, or remove them.');
      return run(async () => {
        if (!form.payerSame) await saveApplicationPart(appId, 'premium-payer', personPayload(form.payer));
        await saveApplicationPart(appId, 'payment-method', {
          payment_method: form.payment.payment_method,
          provider_reference: form.payment.provider_reference.trim() || undefined,
        });
        if (form.beneficiary.enabled) await saveApplicationPart(appId, 'beneficiary', personPayload(form.beneficiary));
        setQuoteVersion((v) => v + 1);
      });
    }
    if (step === 4) {
      if (!quote.data) return toast.error('The application can’t be priced yet — fix the issue shown first.');
      return true;
    }
    if (step === 5) {
      if (acceptance) return true;
      if (!accept.confirmed) return toast.error('Confirm that the client accepted the terms and declaration.');
      const terms = (accept.terms || version?.name || '').trim();
      if (!terms) return toast.error('Enter the terms/declaration version the client accepted.');
      if (form.channel === 'branch' && !accept.signature.trim()) return toast.error('Branch sales need a signature reference.');
      if (form.channel === 'telephone' && !accept.recording.trim() && !accept.fallback) {
        return toast.error('Telephone sales need a call-recording reference, or an approved fallback.');
      }
      return run(async () => {
        const record = await captureAcceptance(appId, {
          channel: form.channel,
          accepted_terms_version: terms,
          signature_reference: accept.signature.trim() || undefined,
          recording_reference: accept.recording.trim() || undefined,
          tenant_fallback: form.channel === 'telephone' && accept.fallback ? true : undefined,
        });
        setAcceptance(record);
      });
    }
    return true;
  };

  const next = async () => {
    const ok = await saveStep();
    if (ok === true) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const submit = () =>
    run(async () => {
      const result = await submitApplication(appId);
      setSubmitted(result);
      queryClient.invalidateQueries({ queryKey: ['records', 'policy'] });
      toast.success(`Application ${result.policy?.policy_number || ''} submitted.`);
    });

  const issueNow = () =>
    run(async () => {
      await issuePolicy(appId);
      toast.success('Policy issued.');
      navigate(`/o/policy/${appId}`, { replace: true });
    });

  /* ── Rendering ─────────────────────────────────────────────────────── */
  if (submitted) {
    const p = submitted.policy || {};
    return shell(
      <div className={styles.done}>
        <div className={styles.doneIcon}><Check size={28} /></div>
        <h1 className={styles.title}>Application {p.policy_number} submitted</h1>
        <p className={styles.subtitle}>
          Monthly premium <strong>{money(submitted.premium?.totals?.premium ?? p.current_premium)}</strong>. Issue it now to
          activate cover and generate the contract and schedule — or issue it later from the policy record.
        </p>
        <div className={styles.doneActions}>
          <Button variant="secondary" onClick={() => navigate(`/o/policy/${appId}`)}>Open policy</Button>
          <Button icon={<BadgeCheck size={15} />} loading={busy} onClick={issueNow}>Issue policy now</Button>
        </div>
      </div>,
    );
  }

  const coverInput = (value, onChange, label = 'Cover amount') =>
    coverOptions.length > 0 ? (
      <label className={styles.field}>
        <span className={styles.label}>{label}</span>
        <select className={styles.input} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">— Choose cover —</option>
          {coverOptions.map((c) => (
            <option key={c} value={c}>{money(c)}</option>
          ))}
        </select>
      </label>
    ) : (
      <label className={styles.field}>
        <span className={styles.label}>{label} (R)</span>
        <input className={styles.input} type="number" min={0} value={value} onChange={(e) => onChange(e.target.value)} />
      </label>
    );

  const listEditor = (key, label, addLabel, withCover, max) => {
    const rows = form[key];
    const update = (i, patch) => set({ [key]: rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
    return (
      <div className={styles.group}>
        <div className={styles.groupHeader}>
          <h3 className={styles.groupTitle}>{label}</h3>
          <span className={styles.help}>{max ? `Up to ${max}` : ''}</span>
        </div>
        {rows.map((r, i) => (
          <div key={i} className={styles.member}>
            <div className={styles.memberFields}>
              <PersonFields value={r} onChange={(v) => update(i, v)} idPrefix={`${key}-${i}`} contact={false} requireAge={withCover} />
              {withCover && coverInput(r.cover_amount, (v) => update(i, { cover_amount: v }), 'Own cover amount')}
            </div>
            <button
              type="button"
              className={styles.iconBtn}
              onClick={() => set({ [key]: rows.filter((_, j) => j !== i) })}
              aria-label={`Remove ${label.toLowerCase()} ${i + 1}`}
            >
              <X size={15} />
            </button>
          </div>
        ))}
        {(!max || rows.length < max) && (
          <button
            type="button"
            className={styles.addBtn}
            onClick={() => set({ [key]: [...rows, withCover ? { ...emptyPerson(), cover_amount: '' } : emptyPerson()] })}
          >
            <Plus size={14} /> {addLabel}
          </button>
        )}
      </div>
    );
  };

  const stepBody = () => {
    switch (STEPS[step].key) {
      case 'product':
        return (
          <>
            <div className={styles.grid}>
              <label className={styles.field}>
                <span className={styles.label}>Product</span>
                <select
                  className={styles.input}
                  value={form.productVersionId}
                  disabled={!!appId}
                  onChange={(e) => set({ productVersionId: e.target.value })}
                >
                  <option value="">{loadingProducts ? 'Loading products…' : '— Choose a product —'}</option>
                  {versions.map((v) => (
                    <option key={v.id} value={v.id}>{v.productName} — {v.name}</option>
                  ))}
                </select>
                {!loadingProducts && versions.length === 0 && (
                  <span className={styles.error}>No active product versions are set up for this tenant.</span>
                )}
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Sales channel</span>
                <select className={styles.input} value={form.channel} disabled={!!appId} onChange={(e) => set({ channel: e.target.value })}>
                  {CHANNELS.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
                <span className={styles.help}>Decides what acceptance evidence is required.</span>
              </label>
            </div>
            {rules && (
              <ul className={styles.facts}>
                <li>Entry age {limits.min_entry_age ?? 0}–{limits.max_entry_age ?? 'any'}</li>
                <li>Spouse {limits.allow_spouse ? 'allowed' : 'not covered'}</li>
                <li>Children {limits.allow_children ? `allowed${limits.max_children ? ` (up to ${limits.max_children})` : ''}` : 'not covered'}</li>
                <li>Extended family {limits.allow_extended_family ? 'allowed' : 'not covered'}</li>
                {coverOptions.length > 0 && <li>Cover {coverOptions.map(money).join(', ')}</li>}
              </ul>
            )}
            {appId && <p className={styles.help}>Product and channel are fixed once the application has started.</p>}
          </>
        );
      case 'main':
        return (
          <>
            {form.main.client_id ? (
              <div className={styles.existing}>
                <span>Existing client: <strong>{form.main.name || 'Client'}</strong>{form.main.id_number ? ` · ID ${form.main.id_number}` : ''}</span>
                <button type="button" className={styles.linkBtn} onClick={() => set({ main: { ...form.main, client_id: '' } })}>
                  Use a different person
                </button>
              </div>
            ) : (
              <PersonFields value={form.main} onChange={(v) => set({ main: { ...form.main, ...v } })} idPrefix="main" ageHint={ageHint} requireAge />
            )}
            <div className={styles.grid}>
              {form.main.client_id && (
                <label className={styles.field}>
                  <span className={styles.label}>Age</span>
                  <input className={styles.input} type="number" min={0} value={form.main.age} onChange={(e) => set({ main: { ...form.main, age: e.target.value } })} />
                  {ageHint && <span className={styles.help}>{ageHint}</span>}
                </label>
              )}
              {coverInput(form.main.cover_amount, (v) => set({ main: { ...form.main, cover_amount: v } }), 'Main cover amount')}
            </div>
            <label className={styles.check}>
              <input type="checkbox" checked={form.payerSame} onChange={(e) => set({ payerSame: e.target.checked })} />
              The main member also pays the premium
            </label>
            <p className={styles.help}>Existing clients are matched by ID number, then email, then phone; otherwise a new client is created.</p>
          </>
        );
      case 'family': {
        const none = !limits.allow_spouse && !limits.allow_children && !limits.allow_extended_family;
        if (none) return <p className={styles.muted}>This product covers the main member only. Continue to the next step.</p>;
        return (
          <>
            {limits.allow_spouse && (
              <div className={styles.group}>
                <div className={styles.groupHeader}>
                  <h3 className={styles.groupTitle}>Spouse</h3>
                  <label className={styles.check}>
                    <input type="checkbox" checked={form.spouse.enabled} onChange={(e) => set({ spouse: { ...form.spouse, enabled: e.target.checked } })} />
                    Cover a spouse
                  </label>
                </div>
                {form.spouse.enabled && (
                  <PersonFields value={form.spouse} onChange={(v) => set({ spouse: { ...form.spouse, ...v } })} idPrefix="spouse" contact={false} />
                )}
              </div>
            )}
            {limits.allow_children && listEditor('children', 'Children', 'Add child', false, limits.max_children)}
            {limits.allow_extended_family && listEditor('extended', 'Extended family members', 'Add family member', true, limits.max_extended_family)}
            <p className={styles.help}>The quote on the next steps uses the cover rates for this family combination.</p>
          </>
        );
      }
      case 'payment':
        return (
          <>
            <div className={styles.group}>
              <h3 className={styles.groupTitle}>Premium payer</h3>
              {form.payerSame ? (
                <p className={styles.muted}>
                  The main member ({form.main.name || 'main member'}) pays.{' '}
                  <button type="button" className={styles.linkBtn} onClick={() => set({ payerSame: false })}>Someone else pays</button>
                </p>
              ) : (
                <>
                  <PersonFields value={form.payer} onChange={(v) => set({ payer: { ...form.payer, ...v } })} idPrefix="payer" showAge={false} />
                  <button type="button" className={styles.linkBtn} onClick={() => set({ payerSame: true })}>The main member pays instead</button>
                </>
              )}
            </div>
            <div className={styles.group}>
              <h3 className={styles.groupTitle}>Payment method</h3>
              <div className={styles.grid}>
                <label className={styles.field}>
                  <span className={styles.label}>Method</span>
                  <select
                    className={styles.input}
                    value={form.payment.payment_method}
                    onChange={(e) => set({ payment: { ...form.payment, payment_method: e.target.value } })}
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>Reference (optional)</span>
                  <input
                    className={styles.input}
                    value={form.payment.provider_reference}
                    onChange={(e) => set({ payment: { ...form.payment, provider_reference: e.target.value } })}
                    placeholder="e.g. debit order mandate number"
                  />
                </label>
              </div>
            </div>
            <div className={styles.group}>
              <div className={styles.groupHeader}>
                <h3 className={styles.groupTitle}>Beneficiary</h3>
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={form.beneficiary.enabled}
                    onChange={(e) => set({ beneficiary: { ...form.beneficiary, enabled: e.target.checked } })}
                  />
                  Add a beneficiary
                </label>
              </div>
              {form.beneficiary.enabled && (
                <PersonFields value={form.beneficiary} onChange={(v) => set({ beneficiary: { ...form.beneficiary, ...v } })} idPrefix="beneficiary" showAge={false} />
              )}
            </div>
          </>
        );
      case 'quote': {
        if (quote.isLoading) return <p className={styles.muted}>Pricing the application…</p>;
        if (quote.isError) {
          return (
            <div className={styles.problem}>
              <AlertTriangle size={16} />
              <div>
                <strong>This application can’t be priced.</strong>
                <p>{errMessage(quote.error, 'The premium could not be calculated.')}</p>
                <p className={styles.help}>Go back and adjust the members or cover, or check the product’s rates.</p>
              </div>
            </div>
          );
        }
        const q = quote.data;
        const rows = [
          { label: `Main member — ${money(q.main?.cover_amount)} cover`, value: q.main?.premium },
          ...(q.children || []).map((c, i) => ({ label: `Child ${i + 1}${c.cover_amount ? ` — ${money(c.cover_amount)} cover` : ''}`, value: c.premium })),
          ...(q.extended_family || []).map((e, i) => ({ label: `Extended family ${i + 1} — ${money(e.cover_amount)} cover`, value: e.premium })),
        ];
        return (
          <>
            <table className={styles.quote}>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label}>
                    <td>{r.label}</td>
                    <td>{r.value !== undefined && r.value !== null ? money(r.value) : 'included'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total monthly premium</td>
                  <td>{money(q.totals?.premium)}</td>
                </tr>
              </tfoot>
            </table>
            <ul className={styles.facts}>
              <li>Rate category: {humanize(q.rate_category)}</li>
              {q.main?.waiting_period_months != null && <li>Waiting period: {q.main.waiting_period_months} months</li>}
              <li>Priced on {q.effective_date}</li>
            </ul>
          </>
        );
      }
      case 'acceptance':
        if (acceptance) {
          return (
            <div className={styles.existing}>
              <FileSignature size={16} />
              <span>
                Acceptance captured ({humanize(acceptance.channel)}, terms {acceptance.accepted_terms_version}
                {acceptance.accepted_at ? `, ${format(new Date(acceptance.accepted_at), 'd MMM yyyy HH:mm')}` : ''}).
              </span>
            </div>
          );
        }
        return (
          <>
            <p className={styles.muted}>
              Record the client’s acceptance of the terms and declaration. {humanize(form.channel)} sales require{' '}
              {form.channel === 'branch' ? 'a signature reference' : form.channel === 'telephone' ? 'a call-recording reference' : 'no extra evidence'}.
            </p>
            <div className={styles.grid}>
              <label className={styles.field}>
                <span className={styles.label}>Terms / declaration version</span>
                <input
                  className={styles.input}
                  value={accept.terms || version?.name || ''}
                  onChange={(e) => setAccept({ ...accept, terms: e.target.value })}
                />
              </label>
              {form.channel === 'branch' && (
                <label className={styles.field}>
                  <span className={styles.label}>Signature reference</span>
                  <input className={styles.input} value={accept.signature} onChange={(e) => setAccept({ ...accept, signature: e.target.value })} placeholder="e.g. scanned form number" />
                </label>
              )}
              {form.channel === 'telephone' && (
                <label className={styles.field}>
                  <span className={styles.label}>Call-recording reference</span>
                  <input className={styles.input} value={accept.recording} onChange={(e) => setAccept({ ...accept, recording: e.target.value })} />
                  <label className={styles.check}>
                    <input type="checkbox" checked={accept.fallback} onChange={(e) => setAccept({ ...accept, fallback: e.target.checked })} />
                    Recording unavailable — approved fallback
                  </label>
                </label>
              )}
            </div>
            <label className={styles.check}>
              <input type="checkbox" checked={accept.confirmed} onChange={(e) => setAccept({ ...accept, confirmed: e.target.checked })} />
              The client has read and accepted the terms and declaration
            </label>
          </>
        );
      case 'review': {
        const v = validation.data;
        return (
          <>
            <dl className={styles.summary}>
              <div><dt>Product</dt><dd>{version ? `${version.productName} — ${version.name}` : '—'}</dd></div>
              <div><dt>Channel</dt><dd>{humanize(form.channel)}</dd></div>
              <div><dt>Main member</dt><dd>{form.main.name || '—'}{form.main.age !== '' ? `, age ${form.main.age}` : ''} · {money(form.main.cover_amount)} cover</dd></div>
              <div><dt>Premium payer</dt><dd>{form.payerSame ? 'Main member' : form.payer.name || '—'}</dd></div>
              <div><dt>Family</dt><dd>{[form.spouse.enabled && 'spouse', form.children.length && `${form.children.length} child${form.children.length === 1 ? '' : 'ren'}`, form.extended.length && `${form.extended.length} extended`].filter(Boolean).join(', ') || 'None'}</dd></div>
              <div><dt>Payment</dt><dd>{PAYMENT_METHODS.find((m) => m.value === form.payment.payment_method)?.label}</dd></div>
              <div><dt>Monthly premium</dt><dd><strong>{money(v?.premium?.totals?.premium)}</strong></dd></div>
            </dl>
            {validation.isLoading && <p className={styles.muted}>Checking the application…</p>}
            {v && !v.valid && (
              <div className={styles.problem}>
                <AlertTriangle size={16} />
                <div>
                  <strong>Fix these before submitting:</strong>
                  <ul>{v.errors.map((e) => <li key={e.field + e.message}>{e.message}</li>)}</ul>
                </div>
              </div>
            )}
            {v?.valid && <p className={styles.ok}><Check size={14} /> Everything required is in place.</p>}
          </>
        );
      }
      default:
        return null;
    }
  };

  const isLast = step === STEPS.length - 1;
  return shell(
    <>
      <div className={styles.header}>
        <div>
          <Link to="/o/policy" className={styles.back}><ArrowLeft size={14} /> Policies</Link>
          <h1 className={styles.title}>New policy</h1>
          <p className={styles.subtitle}>Each step is saved as you go — you can leave and resume this application later.</p>
        </div>
      </div>

      <ol className={styles.stepper}>
        {STEPS.map((s, i) => (
          <li key={s.key} className={`${styles.stepItem} ${i === step ? styles.stepCurrent : ''} ${i < step ? styles.stepDone : ''}`}>
            <button
              type="button"
              className={styles.stepBtn}
              disabled={busy || i > step || (i > 0 && !appId)}
              onClick={() => setStep(i)}
            >
              <span className={styles.stepNum}>{i < step ? <Check size={12} /> : i + 1}</span>
              <span className={styles.stepLabel}>{s.label}</span>
            </button>
          </li>
        ))}
      </ol>

      <section className={styles.card}>
        <h2 className={styles.cardTitle}>{STEPS[step].label}</h2>
        {stepBody()}
      </section>

      <div className={styles.footer}>
        <Button variant="secondary" icon={<ArrowLeft size={15} />} disabled={step === 0 || busy} onClick={() => setStep((s) => s - 1)}>
          Back
        </Button>
        {isLast ? (
          <Button icon={<Check size={15} />} loading={busy} disabled={!validation.data?.valid} onClick={submit}>
            Submit application
          </Button>
        ) : (
          <Button iconRight={<ArrowRight size={15} />} loading={busy} onClick={next}>
            {step === 0 && !appId ? 'Start application' : 'Save & continue'}
          </Button>
        )}
      </div>
    </>,
  );
}
