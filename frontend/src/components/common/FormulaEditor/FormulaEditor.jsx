import React, { useState, useRef, useCallback, useEffect } from 'react';
import { CheckCircle, XCircle, Loader, ChevronDown, ChevronUp } from 'lucide-react';
import api from '../../../services/api';
import styles from './FormulaEditor.module.css';

// ─── Reference data ───────────────────────────────────────────────────────────
// `returns` is the primitive kind the function evaluates to, mirroring
// FN_RETURN_KINDS in backend/services/formulaParser.js. 'any' means the kind
// comes from the arguments, so the function fits any return type.
const FUNCTIONS = [
  { name: 'IF',           sig: 'IF(condition, whenTrue, whenFalse)', returns: 'any',     desc: 'Pick one of two values — only the taken branch is evaluated' },
  { name: 'LENGTH',       sig: 'LENGTH(field)',                      returns: 'number',  desc: 'Number of characters in a text value' },
  { name: 'ABS',          sig: 'ABS(number)',                        returns: 'number',  desc: 'Absolute value' },
  { name: 'ROUND',        sig: 'ROUND(number, decimals)',            returns: 'number',  desc: 'Round to N decimal places' },
  { name: 'YEAR',         sig: 'YEAR(date)',                         returns: 'number',  desc: 'Year part of a date' },
  { name: 'MONTH',        sig: 'MONTH(date)',                        returns: 'number',  desc: 'Month (1–12) of a date' },
  { name: 'DAY',          sig: 'DAY(date)',                          returns: 'number',  desc: 'Day of the month' },
  { name: 'DAYS_BETWEEN', sig: 'DAYS_BETWEEN(from, to)',             returns: 'number',  desc: 'Whole days from one date to another' },
  { name: 'DAYS_UNTIL',   sig: 'DAYS_UNTIL(date)',                   returns: 'number',  desc: 'Days from today until a date — negative once it has passed' },
  { name: 'UPPER',        sig: 'UPPER(field)',                       returns: 'text',    desc: 'Value in UPPERCASE' },
  { name: 'LOWER',        sig: 'LOWER(field)',                       returns: 'text',    desc: 'Value in lowercase' },
  { name: 'TRIM',         sig: 'TRIM(field)',                        returns: 'text',    desc: 'Value with whitespace removed' },
  { name: 'ISBLANK',      sig: 'ISBLANK(field)',                     returns: 'boolean', desc: 'True if field is empty or null' },
  { name: 'ISNULL',       sig: 'ISNULL(field)',                      returns: 'boolean', desc: 'True if field is null' },
  { name: 'CONTAINS',     sig: 'CONTAINS(field, "text")',            returns: 'boolean', desc: 'True if field contains substring' },
  { name: 'REGEX',        sig: 'REGEX(field, "pattern")',            returns: 'boolean', desc: 'True if field matches regex pattern' },
  { name: 'TODAY',        sig: 'TODAY()',                            returns: 'date',    desc: 'Current date (no time)' },
  { name: 'NOW',          sig: 'NOW()',                              returns: 'date',    desc: 'Current date and time' },
  { name: 'DATEVALUE',    sig: 'DATEVALUE(field)',                   returns: 'date',    desc: 'Convert a text or number value to a date' },
  { name: 'TEXT',         sig: 'TEXT(value)',                        returns: 'text',    desc: 'Any value as text' },
  { name: 'CONCATENATE',  sig: 'CONCATENATE(a, b, …)',               returns: 'text',    desc: 'Join values into one piece of text' },
  { name: 'AND',          sig: 'AND(cond1, cond2, …)',               returns: 'boolean', desc: 'True when every condition is true — nest freely, e.g. AND(a, OR(b, c))' },
  { name: 'OR',           sig: 'OR(cond1, cond2, …)',                returns: 'boolean', desc: 'True when any condition is true' },
  { name: 'NOT',          sig: 'NOT(condition)',                     returns: 'boolean', desc: 'True when the condition is false' },
  // Record-state: compares with the value saved before this edit, so it is
  // only offered for validation rules (BRD 6.1).
  { name: 'ISCHANGED',    sig: 'ISCHANGED(field)',                   returns: 'boolean', desc: 'True only when editing a record and this field’s value changed', recordState: true },
  // Tenant-configurable thresholds (BRD 6.2): the tenant's own value, else the platform default.
  { name: 'CONFIG',       sig: 'CONFIG("setting.key")',              returns: 'any',     desc: 'A configuration setting for this company, e.g. CONFIG("deals.minimum_value")', recordState: true },
];

// Declared `formulaReturnType` → primitive kind. Mirrors DECLARED_TYPE_KINDS in
// backend/services/formulaParser.js — currency and percent are numbers that
// differ only in presentation.
const RETURN_TYPE_KINDS = {
  text: 'text',
  number: 'number',
  currency: 'number',
  percent: 'number',
  date: 'date',
  boolean: 'boolean',
};

const KIND_LABELS = {
  text: 'text',
  number: 'a number',
  date: 'a date',
  boolean: 'true/false',
};

// Placeholder per declared return type, so the hint shows the shape of formula
// the field actually wants.
const PLACEHOLDERS = {
  text:     'e.g. first_name + " " + last_name',
  number:   'e.g. quantity * unit_price',
  currency: 'e.g. quantity * unit_price - discount',
  percent:  'e.g. IF(amount > 0, ROUND(discount / amount * 100, 1), 0)',
  date:     'e.g. IF(ISBLANK(close_date), TODAY(), close_date)',
  boolean:  'e.g. amount > discount AND NOT ISBLANK(email)',
};

// Used when no return type is given — i.e. a validation rule, where the
// expression is the condition to reject rather than one to satisfy.
const DEFAULT_PLACEHOLDER = 'e.g. ISBLANK(client_number) OR amount <= 0';

const OPERATORS = [
  { op: '==',  desc: 'Equal' },
  { op: '!=',  desc: 'Not equal' },
  { op: '>',   desc: 'Greater than' },
  { op: '>=',  desc: 'Greater or equal' },
  { op: '<',   desc: 'Less than' },
  { op: '<=',  desc: 'Less or equal' },
  { op: 'AND', desc: 'Both must be true (same as &&)' },
  { op: 'OR',  desc: 'Either can be true (same as ||)' },
  { op: 'NOT', desc: 'Negates a condition (same as !)' },
  { op: '&&',  desc: 'AND' },
  { op: '||',  desc: 'OR' },
  { op: '!',   desc: 'NOT' },
];

// Examples grouped by the kind they evaluate to, so the panel only offers
// starting points that are valid for the declared return type.
const EXAMPLES_BY_KIND = {
  // A boolean formula field simply computes true or false, so these read as
  // "the value is true when…" — unlike a validation rule, nothing is rejected.
  boolean: [
    { expr: 'amount > discount',                             desc: 'True when amount exceeds discount' },
    { expr: 'NOT ISBLANK(email)',                            desc: 'True when email is filled in' },
    { expr: 'status == "won"',                                desc: 'True when the status is won' },
    { expr: 'close_date < TODAY()',                           desc: 'True once the close date has passed' },
    { expr: 'LENGTH(description) >= 10',                      desc: 'True when the description is long enough' },
    { expr: 'status == "Active" AND probability >= 50',       desc: 'Combining two conditions' },
    { expr: 'CONTAINS(email, "@")',                           desc: 'True when email contains @' },
    { expr: 'UPPER(status) == "WON"',                          desc: 'Case-insensitive comparison' },
  ],
  number: [
    { expr: 'quantity * unit_price',                          desc: 'Line total' },
    { expr: 'amount - discount',                              desc: 'Net amount' },
    { expr: 'ROUND(amount * 0.15, 2)',                        desc: 'Tax at 15%, to 2 decimals' },
    { expr: 'IF(quantity > 0, amount / quantity, 0)',         desc: 'Average, guarding divide-by-zero' },
    { expr: 'IF(amount > 0, ROUND(discount / amount * 100, 1), 0)', desc: 'Discount as a percentage' },
    { expr: 'ABS(target - actual)',                           desc: 'Variance, always positive' },
    { expr: 'DAYS_UNTIL(close_date)',                         desc: 'Days remaining — negative once past' },
    { expr: 'DAYS_BETWEEN(start_date, end_date)',             desc: 'Duration in whole days' },
    { expr: 'YEAR(close_date)',                               desc: 'Year part of a date' },
    { expr: 'LENGTH(description)',                            desc: 'Character count' },
  ],
  text: [
    { expr: 'first_name + " " + last_name',                   desc: 'Full name from two fields' },
    { expr: 'city + ", " + country',                          desc: 'Joined with a separator' },
    { expr: 'UPPER(status)',                                  desc: 'Value in uppercase' },
    { expr: 'TRIM(email)',                                    desc: 'Whitespace removed' },
    { expr: 'IF(ISBLANK(nickname), first_name, nickname)',    desc: 'Fall back when empty' },
    { expr: 'IF(amount > 10000, "High", "Standard")',         desc: 'Band a number into labels' },
    { expr: 'LOWER(email)',                                   desc: 'Normalised to lowercase' },
  ],
  date: [
    { expr: 'TODAY()',                                        desc: "Today's date" },
    { expr: 'NOW()',                                          desc: 'Current date and time' },
    { expr: 'IF(ISBLANK(close_date), TODAY(), close_date)',   desc: 'Fall back to today' },
    { expr: 'IF(is_renewal, renewal_date, start_date)',       desc: 'Pick one of two dates' },
    { expr: 'DATEVALUE(reference_date)',                       desc: 'Convert a text value to a date' },
  ],
};

// Validation rules pass no return type. Their expression describes the condition
// to REJECT — it blocks the save when true — so these are written as error
// conditions, the opposite polarity to the boolean set above. Getting this
// backwards is the easiest mistake to make when authoring a rule, so the
// descriptions state the intent and the expressions state the rejection.
const VALIDATION_EXAMPLES = [
  { expr: 'ISBLANK(client_number)',                        desc: 'Client number is required' },
  { expr: 'amount <= 0',                                    desc: 'Amount must be positive' },
  { expr: 'amount <= discount',                             desc: 'Amount must exceed the discount' },
  { expr: 'ISBLANK(phone) AND ISBLANK(email)',              desc: 'At least one contact method is required' },
  { expr: 'LENGTH(description) < 10',                       desc: 'Description must be at least 10 characters' },
  { expr: 'start_date >= end_date',                         desc: 'Start date must be before the end date' },
  { expr: 'close_date <= TODAY()',                          desc: 'Close date must be in the future' },
  { expr: 'NOT CONTAINS(email, "@")',                       desc: 'Email address must be valid' },
  { expr: 'NOT REGEX(email, "^[^@]+@company\\.com$")',      desc: 'Only company email addresses are allowed' },
  { expr: 'status == "Active" AND probability < 50',        desc: 'Active deals need a probability of 50 or more' },
  { expr: 'stage != "won" AND stage != "closed"',           desc: 'Stage must be won or closed' },
  { expr: 'ISBLANK(owner_id) OR ISBLANK(client_id)',        desc: 'Owner and client must both be set' },
  { expr: 'AND(amount > 10000, OR(ISBLANK(approver), NOT(approved)))', desc: 'Large amounts need an approver who has approved' },
  { expr: 'ISCHANGED(stage) AND stage == "closed_won" AND ISBLANK(close_date)', desc: 'Moving to Closed Won needs a close date' },
  { expr: 'ISCHANGED(owner_id) AND NOT(ISBLANK(locked_reason))', desc: 'The owner of a locked record can’t be changed' },
  { expr: 'amount < CONFIG("deals.minimum_value")',          desc: 'Amount must meet this company’s minimum deal value' },
  { expr: 'payment_method == "debit_order" AND ISBLANK(debit_order_day)', desc: 'Debit Order Day is required for debit orders' },
];

// ─── Local syntax pre-check ───────────────────────────────────────────────────
function quickCheck(expr) {
  if (!expr.trim()) return null;
  let depth = 0, inStr = false, strChar = '';
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (inStr) {
      if (c === strChar && expr[i - 1] !== '\\') inStr = false;
      continue;
    }
    if (c === '"' || c === "'") { inStr = true; strChar = c; continue; }
    if (c === '(') depth++;
    if (c === ')') { depth--; if (depth < 0) return 'Unexpected closing parenthesis'; }
  }
  if (inStr) return 'Unterminated string literal';
  if (depth > 0) return `Missing closing parenthesis (${depth} open)`;
  return null;
}

// ─── FormulaEditor ────────────────────────────────────────────────────────────
export default function FormulaEditor({
  objectApiName,
  expression = '',
  errorMessage = '',
  availableFields = [],
  onExpressionChange,
  onErrorMessageChange,
  hideErrorMessage = false,
  // Declared `formulaReturnType` of the formula field being edited. Omitted by
  // validation rules, which are boolean by definition and show the full
  // reference set.
  returnType = '',
  // API name of the field being edited, so the server excludes it from the
  // reference context — a formula can't reference itself.
  excludeFieldApiName = '',
  // Defaults match VALIDATION_RULE_LIMITS in backend/models/ObjectMeta.js.
  maxExpressionLength = 1000,
  maxErrorMessageLength = 255,
  // Where the condition is used. 'approval' = approval entry criteria: a
  // true/false condition like a validation rule that can read CONFIG() but has
  // no "before" value, so ISCHANGED isn't offered.
  entryContext = '',
}) {
  const [activePanel, setActivePanel] = useState(null); // 'fields' | 'functions' | 'examples' | null
  const [showAllFunctions, setShowAllFunctions] = useState(false);
  // null | 'checking' | { ok: true, inferred } | { error }
  const [serverStatus, setServerStatus] = useState(null);
  const textareaRef = useRef(null);
  const debounceRef = useRef(null);

  const localError = quickCheck(expression);
  const kind = RETURN_TYPE_KINDS[returnType] || null;
  // Validation rules pass no return type; formula fields always declare one.
  const isRule = !returnType;
  // ISCHANGED and other record-state functions only make sense in rules.
  const library = isRule
    ? FUNCTIONS.filter(fn => entryContext !== 'approval' || fn.name !== 'ISCHANGED')
    : FUNCTIONS.filter(fn => !fn.recordState);

  // With a return type declared, lead with the functions that can produce it —
  // IF included, since its kind comes from its branches. Without one (validation
  // rules) the whole set is shown flat, as before.
  const primaryFunctions = kind
    ? library.filter(fn => fn.returns === kind || fn.returns === 'any')
    : library;
  const otherFunctions = kind
    ? library.filter(fn => fn.returns !== kind && fn.returns !== 'any')
    : [];
  const examples = kind
    ? EXAMPLES_BY_KIND[kind] || VALIDATION_EXAMPLES
    : VALIDATION_EXAMPLES;

  // Debounced server-side check. The declared return type is part of the
  // request, so the server reports a type mismatch the same way it reports a
  // syntax error — and re-checks when the return type changes.
  const checkServer = useCallback(async (expr) => {
    if (!expr.trim() || !objectApiName) { setServerStatus(null); return; }
    setServerStatus('checking');
    try {
      const res = await api.post('/records/validate-formula', {
        objectApiName,
        expression: expr,
        returnType: returnType || undefined,
        excludeFieldApiName: excludeFieldApiName || undefined,
        // A rule must be true/false and may use ISCHANGED; a formula field may not.
        // Approval entry criteria are true/false too, but have no previous values.
        context: isRule ? (entryContext === 'approval' ? 'approval' : 'rule') : 'formula',
      });
      const { valid, error, returnType: inferred } = res.data.data;
      setServerStatus(valid ? { ok: true, inferred } : { error });
    } catch {
      setServerStatus(null);
    }
  }, [objectApiName, returnType, excludeFieldApiName, isRule, entryContext]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!expression.trim()) { setServerStatus(null); return; }
    debounceRef.current = setTimeout(() => checkServer(expression), 700);
    return () => clearTimeout(debounceRef.current);
  }, [expression, checkServer]);

  // Insert text at the textarea's current cursor position.
  // We read selectionStart before opening any panel (stored in lastCaret ref).
  const lastCaret = useRef(0);

  const saveCaretPos = () => {
    if (textareaRef.current) lastCaret.current = textareaRef.current.selectionStart ?? expression.length;
  };

  const insert = (text) => {
    const pos = lastCaret.current;
    const next = expression.slice(0, pos) + text + expression.slice(pos);
    onExpressionChange(next);
    // Restore focus and cursor after React re-render
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      const newPos = pos + text.length;
      el.setSelectionRange(newPos, newPos);
      lastCaret.current = newPos;
    });
  };

  const togglePanel = (name) => {
    saveCaretPos();
    setActivePanel(p => (p === name ? null : name));
  };

  const statusEl = () => {
    if (!expression.trim()) return null;
    if (localError) return (
      <span className={styles.statusErr}><XCircle size={13} />{localError}</span>
    );
    if (serverStatus === 'checking') return (
      <span className={styles.statusChecking}><Loader size={13} className={styles.spin} />Checking…</span>
    );
    if (serverStatus?.ok) return (
      <span className={styles.statusOk}>
        <CheckCircle size={13} />
        {/* The server reports 'unknown' when it can't pin the kind down — say
            nothing rather than showing "returns unknown". */}
        {serverStatus.inferred && serverStatus.inferred !== 'unknown'
          ? `Valid — returns ${KIND_LABELS[serverStatus.inferred] || serverStatus.inferred}`
          : 'Valid expression'}
      </span>
    );
    if (serverStatus?.error) return (
      <span className={styles.statusErr}><XCircle size={13} />{serverStatus.error}</span>
    );
    return null;
  };

  return (
    <div className={styles.editor}>

      {/* ── Expression textarea ─────────────────────────────────────────── */}
      <div className={styles.exprWrap}>
        <textarea
          ref={textareaRef}
          className={[styles.expr, (localError || serverStatus?.error) ? styles.exprErr : ''].filter(Boolean).join(' ')}
          value={expression}
          onChange={e => { saveCaretPos(); onExpressionChange(e.target.value); }}
          onKeyUp={saveCaretPos}
          onClick={saveCaretPos}
          placeholder={PLACEHOLDERS[returnType] || DEFAULT_PLACEHOLDER}
          rows={3}
          spellCheck={false}
          maxLength={maxExpressionLength}
        />
        <div className={styles.statusBar}>
          {statusEl()}
          <span className={styles.charCount}>
            {(expression || '').length}/{maxExpressionLength}
          </span>
        </div>
      </div>

      {/* ── Error message input ──────────────────────────────────────────── */}
      {!hideErrorMessage && (
        <div className={styles.errMsgWrap}>
          <label className={styles.errMsgLabel}>Error message shown when validation fails</label>
          <input
            type="text"
            className={styles.errMsgInput}
            value={errorMessage}
            onChange={e => onErrorMessageChange(e.target.value)}
            placeholder="e.g. Amount must be greater than discount"
            maxLength={maxErrorMessageLength}
          />
        </div>
      )}

      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div className={styles.toolbar}>
        <ToolBtn label="Fields" active={activePanel === 'fields'} count={availableFields.length}
          onClick={() => togglePanel('fields')} />
        <ToolBtn label="Functions" active={activePanel === 'functions'} count={primaryFunctions.length}
          onClick={() => togglePanel('functions')} />
        <ToolBtn label="Examples" active={activePanel === 'examples'}
          onClick={() => togglePanel('examples')} />
      </div>

      {/* ── Inline panels (no absolute positioning — safe inside modal) ─── */}
      {activePanel === 'fields' && (
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            Click a field to insert it into the formula
          </div>
          {availableFields.length === 0 && (
            <p className={styles.panelEmpty}>No fields available</p>
          )}
          <div className={styles.fieldGrid}>
            {availableFields.map(f => (
              <button
                key={f.apiName}
                type="button"
                className={styles.fieldChip}
                onClick={() => insert(f.apiName)}
                title={`${f.label} (${f.type})`}
              >
                <code className={styles.chipCode}>{f.apiName}</code>
                <span className={styles.chipSub}>{f.type}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {activePanel === 'functions' && (
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            {kind
              ? `Functions that return ${KIND_LABELS[kind] || kind} — click to insert`
              : 'Click a function to insert its template'}
          </div>
          <div className={styles.fnList}>
            {primaryFunctions.map(fn => (
              <button
                key={fn.name}
                type="button"
                className={styles.fnRow}
                onClick={() => insert(fn.sig)}
              >
                <code className={styles.fnName}>{fn.name}</code>
                <code className={styles.fnSig}>{fn.sig}</code>
                <span className={styles.fnDesc}>{fn.desc}</span>
              </button>
            ))}
          </div>

          {/* The remaining functions still have a place inside a formula of this
              return type — UPPER(status) == "WON" is a boolean formula built
              from a text function — so they are collapsed rather than removed. */}
          {otherFunctions.length > 0 && (
            <>
              <button
                type="button"
                className={styles.toolBtn}
                onClick={() => setShowAllFunctions(v => !v)}
              >
                {showAllFunctions ? 'Hide' : 'Show'} {otherFunctions.length} more for use inside expressions
                {showAllFunctions ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>
              {showAllFunctions && (
                <div className={styles.fnList}>
                  {otherFunctions.map(fn => (
                    <button
                      key={fn.name}
                      type="button"
                      className={styles.fnRow}
                      onClick={() => insert(fn.sig)}
                    >
                      <code className={styles.fnName}>{fn.name}</code>
                      <code className={styles.fnSig}>{fn.sig}</code>
                      <span className={styles.fnDesc}>{fn.desc}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          <div className={styles.panelSubHeader}>Operators — click to insert</div>
          <div className={styles.opGrid}>
            {OPERATORS.map(({ op, desc }) => (
              <button
                key={op}
                type="button"
                className={styles.opChip}
                title={desc}
                onClick={() => insert(` ${op} `)}
              >
                <code>{op}</code>
                <span>{desc}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {activePanel === 'examples' && (
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            {kind
              ? `Examples that return ${KIND_LABELS[kind] || kind} — click to use as a starting point`
              : 'Each expression below is the condition that blocks the save — click to use as a starting point'}
          </div>
          <div className={styles.exList}>
            {examples.map(({ expr, desc }) => (
              <button
                key={expr}
                type="button"
                className={styles.exRow}
                onClick={() => { onExpressionChange(expr); lastCaret.current = expr.length; setActivePanel(null); }}
              >
                <code className={styles.exCode}>{expr}</code>
                <span className={styles.exDesc}>{desc}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Small toolbar button ─────────────────────────────────────────────────────
function ToolBtn({ label, active, count, onClick }) {
  return (
    <button type="button" className={[styles.toolBtn, active ? styles.toolBtnActive : ''].filter(Boolean).join(' ')} onClick={onClick}>
      {label}
      {count != null && <span className={styles.toolCount}>{count}</span>}
      {active ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
    </button>
  );
}
