/**
 * formulaParser.js
 *
 * Safe, eval-free formula parser and evaluator for validation expressions.
 * Implements a recursive-descent parser producing an AST, then a tree-walking
 * interpreter. No dynamic code execution — every operation is handled
 * explicitly by the evaluator switch.
 *
 * Grammar (simplified EBNF):
 *   Expression := OrExpr
 *   OrExpr     := AndExpr  ( '||' AndExpr  )*
 *   AndExpr    := NotExpr  ( '&&' NotExpr  )*
 *   NotExpr    := '!' NotExpr | CompareExpr
 *   CompareExpr:= AddExpr  ( ('=='|'!='|'>'|'>='|'<'|'<=') AddExpr )?
 *   AddExpr    := MulExpr  ( ('+'|'-') MulExpr )*
 *   MulExpr    := UnaryExpr( ('*'|'/') UnaryExpr)*
 *   UnaryExpr  := '-' UnaryExpr | Primary
 *   Primary    := Number | String | Bool | null
 *              | IDENT '(' ArgList ')' (function call)
 *              | IDENT '.' IDENT '(' ArgList ')' (method call — whitelist only)
 *              | IDENT (field reference)
 *              | '(' Expression ')'
 */

// ─── Token types ─────────────────────────────────────────────────────────────
const TT = Object.freeze({
  NUMBER: 'NUMBER', STRING: 'STRING', IDENT: 'IDENT',
  TRUE: 'TRUE', FALSE: 'FALSE', NULL: 'NULL',
  LPAREN: 'LPAREN', RPAREN: 'RPAREN', COMMA: 'COMMA', DOT: 'DOT',
  EQ: 'EQ', NEQ: 'NEQ', GT: 'GT', GTE: 'GTE', LT: 'LT', LTE: 'LTE',
  AND: 'AND', OR: 'OR', NOT: 'NOT',
  PLUS: 'PLUS', MINUS: 'MINUS', STAR: 'STAR', SLASH: 'SLASH',
  EOF: 'EOF',
});

// ─── Lexer ────────────────────────────────────────────────────────────────────
class Lexer {
  constructor(source) {
    this.src = source;
    this.pos = 0;
  }

  peek() { return this.src[this.pos]; }
  eof()  { return this.pos >= this.src.length; }
  next() { return this.src[this.pos++]; }

  skipWS() {
    while (!this.eof() && /\s/.test(this.peek())) this.next();
  }

  readString(q) {
    this.next(); // opening quote
    let s = '';
    while (!this.eof() && this.peek() !== q) {
      const c = this.next();
      if (c === '\\') {
        const e = this.next();
        s += (e === 'n' ? '\n' : e === 't' ? '\t' : e);
      } else {
        s += c;
      }
    }
    if (this.eof()) throw new Error('Unterminated string literal');
    this.next(); // closing quote
    return s;
  }

  readNumber() {
    let n = '';
    while (!this.eof() && /[\d.]/.test(this.peek())) n += this.next();
    const v = parseFloat(n);
    if (isNaN(v)) throw new Error(`Invalid number: ${n}`);
    return v;
  }

  readIdent() {
    let id = '';
    while (!this.eof() && /[a-zA-Z0-9_]/.test(this.peek())) id += this.next();
    return id;
  }

  tokenize() {
    const tokens = [];
    while (true) {
      this.skipWS();
      if (this.eof()) { tokens.push({ t: TT.EOF }); break; }

      const ch = this.peek();

      if (ch === '"' || ch === "'") {
        tokens.push({ t: TT.STRING, v: this.readString(ch) });
        continue;
      }
      if (/\d/.test(ch)) {
        tokens.push({ t: TT.NUMBER, v: this.readNumber() });
        continue;
      }
      if (/[a-zA-Z_]/.test(ch)) {
        const id = this.readIdent();
        // Word forms of the boolean operators, so rules can be written as
        // `amount > 0 AND stage == "won"` as well as with && / || / !.
        // Field API names are always lowercase (^[a-z][a-z0-9_]*$), and these
        // three words are reserved, so there is no ambiguity with a field name.
        const word = id.toUpperCase();
        if      (id === 'true')  tokens.push({ t: TT.TRUE,  v: true  });
        else if (id === 'false') tokens.push({ t: TT.FALSE, v: false });
        else if (id === 'null')  tokens.push({ t: TT.NULL,  v: null  });
        else if (word === 'AND') tokens.push({ t: TT.AND });
        else if (word === 'OR')  tokens.push({ t: TT.OR  });
        else if (word === 'NOT') tokens.push({ t: TT.NOT });
        else                     tokens.push({ t: TT.IDENT, v: id    });
        continue;
      }

      this.next(); // consume
      switch (ch) {
        case '(': tokens.push({ t: TT.LPAREN }); break;
        case ')': tokens.push({ t: TT.RPAREN }); break;
        case ',': tokens.push({ t: TT.COMMA  }); break;
        case '.': tokens.push({ t: TT.DOT    }); break;
        case '+': tokens.push({ t: TT.PLUS   }); break;
        case '-': tokens.push({ t: TT.MINUS  }); break;
        case '*': tokens.push({ t: TT.STAR   }); break;
        case '/': tokens.push({ t: TT.SLASH  }); break;
        case '!':
          if (this.peek() === '=') { this.next(); tokens.push({ t: TT.NEQ }); }
          else tokens.push({ t: TT.NOT });
          break;
        case '=':
          if (this.peek() === '=') { this.next(); tokens.push({ t: TT.EQ }); }
          else throw new Error("Unexpected '='. Did you mean '=='?");
          break;
        case '>':
          if (this.peek() === '=') { this.next(); tokens.push({ t: TT.GTE }); }
          else tokens.push({ t: TT.GT });
          break;
        case '<':
          if (this.peek() === '=') { this.next(); tokens.push({ t: TT.LTE }); }
          else tokens.push({ t: TT.LT });
          break;
        case '&':
          if (this.next() === '&') tokens.push({ t: TT.AND });
          else throw new Error("Unexpected '&'. Did you mean '&&'?");
          break;
        case '|':
          if (this.next() === '|') tokens.push({ t: TT.OR });
          else throw new Error("Unexpected '|'. Did you mean '||'?");
          break;
        default:
          throw new Error(`Unexpected character: '${ch}'`);
      }
    }
    return tokens;
  }
}

// ─── Parser ───────────────────────────────────────────────────────────────────
const MAX_DEPTH = 24;

class Parser {
  constructor(tokens) {
    this.tok = tokens;
    this.pos = 0;
    this.depth = 0;
  }

  cur()  { return this.tok[this.pos]; }
  eat()  { return this.tok[this.pos++]; }
  peek() { return this.tok[this.pos]?.t; }

  expect(type) {
    const t = this.eat();
    if (t.t !== type) throw new Error(`Expected ${type}, got '${t.v ?? t.t}'`);
    return t;
  }

  enterDepth() {
    if (++this.depth > MAX_DEPTH) throw new Error('Expression too deeply nested');
  }
  leaveDepth() { this.depth--; }

  parse() {
    const node = this.parseOr();
    if (this.peek() !== TT.EOF) throw new Error(`Unexpected token: '${this.cur().v ?? this.cur().t}'`);
    return node;
  }

  parseOr() {
    this.enterDepth();
    let l = this.parseAnd();
    while (this.peek() === TT.OR) {
      this.eat();
      l = { k: '||', l, r: this.parseAnd() };
    }
    this.leaveDepth();
    return l;
  }

  parseAnd() {
    this.enterDepth();
    let l = this.parseNot();
    while (this.peek() === TT.AND) {
      this.eat();
      l = { k: '&&', l, r: this.parseNot() };
    }
    this.leaveDepth();
    return l;
  }

  parseNot() {
    if (this.peek() === TT.NOT) {
      this.eat();
      this.enterDepth();
      const e = this.parseNot();
      this.leaveDepth();
      return { k: '!', e };
    }
    return this.parseCmp();
  }

  parseCmp() {
    this.enterDepth();
    let l = this.parseAdd();
    const CMP = new Set([TT.EQ, TT.NEQ, TT.GT, TT.GTE, TT.LT, TT.LTE]);
    if (CMP.has(this.peek())) {
      const op = this.eat().t;
      l = { k: op, l, r: this.parseAdd() };
    }
    this.leaveDepth();
    return l;
  }

  parseAdd() {
    this.enterDepth();
    let l = this.parseMul();
    while (this.peek() === TT.PLUS || this.peek() === TT.MINUS) {
      const op = this.eat().t;
      l = { k: op, l, r: this.parseMul() };
    }
    this.leaveDepth();
    return l;
  }

  parseMul() {
    this.enterDepth();
    let l = this.parseUnary();
    while (this.peek() === TT.STAR || this.peek() === TT.SLASH) {
      const op = this.eat().t;
      l = { k: op, l, r: this.parseUnary() };
    }
    this.leaveDepth();
    return l;
  }

  parseUnary() {
    if (this.peek() === TT.MINUS) {
      this.eat();
      return { k: 'neg', e: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  parsePrimary() {
    const t = this.cur();
    if (t.t === TT.NUMBER) { this.eat(); return { k: 'lit', v: t.v }; }
    if (t.t === TT.STRING) { this.eat(); return { k: 'lit', v: t.v }; }
    if (t.t === TT.TRUE)   { this.eat(); return { k: 'lit', v: true  }; }
    if (t.t === TT.FALSE)  { this.eat(); return { k: 'lit', v: false }; }
    if (t.t === TT.NULL)   { this.eat(); return { k: 'lit', v: null  }; }

    if (t.t === TT.LPAREN) {
      this.eat();
      this.enterDepth();
      const e = this.parseOr();
      this.leaveDepth();
      this.expect(TT.RPAREN);
      return e;
    }

    if (t.t === TT.IDENT) {
      const name = this.eat().v;

      // Function call: FUNC(...)
      if (this.peek() === TT.LPAREN) {
        this.eat();
        const args = [];
        if (this.peek() !== TT.RPAREN) {
          args.push(this.parseOr());
          while (this.peek() === TT.COMMA) { this.eat(); args.push(this.parseOr()); }
        }
        this.expect(TT.RPAREN);
        return { k: 'fn', name: name.toUpperCase(), args };
      }

      // Member access: field.method(...)
      if (this.peek() === TT.DOT) {
        this.eat();
        const prop = this.expect(TT.IDENT).v;
        if (this.peek() === TT.LPAREN) {
          this.eat();
          const args = [];
          if (this.peek() !== TT.RPAREN) {
            args.push(this.parseOr());
            while (this.peek() === TT.COMMA) { this.eat(); args.push(this.parseOr()); }
          }
          this.expect(TT.RPAREN);
          return { k: 'method', obj: name, method: prop, args };
        }
        return { k: 'member', obj: name, prop };
      }

      return { k: 'ref', name };
    }

    throw new Error(`Unexpected token: '${t.v ?? t.t}'`);
  }
}

// ─── Built-in functions ───────────────────────────────────────────────────────
const BUILTINS = {
  LENGTH([a], ctx)   { const v = run(a, ctx); return v == null ? 0 : String(v).length; },
  ISBLANK([a], ctx)  { const v = run(a, ctx); return v == null || v === ''; },
  ISNULL([a], ctx)   { const v = run(a, ctx); return v == null; },
  REGEX([a, b], ctx) {
    const val = String(run(a, ctx) ?? '');
    const pat = String(run(b, ctx) ?? '');
    // Security: reject patterns with dangerous flags or catastrophic backtracking signals
    if (pat.length > 200) throw new Error('Regex pattern too long');
    try { return new RegExp(pat).test(val); } catch { return false; }
  },
  TODAY()    { const d = new Date(); d.setHours(0,0,0,0); return d; },
  NOW()      { return new Date(); },
  UPPER([a], ctx)  { const v = run(a, ctx); return v == null ? '' : String(v).toUpperCase(); },
  LOWER([a], ctx)  { const v = run(a, ctx); return v == null ? '' : String(v).toLowerCase(); },
  TRIM([a], ctx)   { const v = run(a, ctx); return v == null ? '' : String(v).trim(); },
  CONTAINS([a, b], ctx) {
    return String(run(a, ctx) ?? '').includes(String(run(b, ctx) ?? ''));
  },
  ABS([a], ctx)    { return Math.abs(Number(run(a, ctx))); },
  ROUND([a, b], ctx) {
    const n = Number(run(a, ctx));
    const p = b ? Number(run(b, ctx)) : 0;
    return Math.round(n * Math.pow(10, p)) / Math.pow(10, p);
  },
  DATEVALUE([a], ctx) { const v = run(a, ctx); return v ? new Date(v) : null; },
  YEAR([a], ctx)   { const d = run(a, ctx); return d ? new Date(d).getFullYear() : null; },
  MONTH([a], ctx)  { const d = run(a, ctx); return d ? new Date(d).getMonth() + 1 : null; },
  DAY([a], ctx)    { const d = run(a, ctx); return d ? new Date(d).getDate() : null; },

  // Conditional. Only the taken branch is evaluated, so IF can guard against
  // nulls and division by zero in the untaken branch.
  IF([cond, a, b], ctx) {
    if (cond === undefined) throw new Error('IF requires a condition');
    const test = run(cond, ctx);
    const branch = test ? a : b;
    return branch === undefined ? null : run(branch, ctx);
  },

  // Whole days from `a` to `b`. Returns null when either date is missing.
  DAYS_BETWEEN([a, b], ctx) {
    const from = utcMidnight(run(a, ctx));
    const to = utcMidnight(run(b, ctx));
    if (from === null || to === null) return null;
    return Math.round((to - from) / 86400000);
  },

  // Whole days from today until `date`. Negative once the date has passed,
  // null when there is no date — the shape a "countdown" column wants.
  DAYS_UNTIL([a], ctx) {
    const target = utcMidnight(run(a, ctx));
    if (target === null) return null;
    return Math.round((target - utcMidnight(new Date())) / 86400000);
  },

  // FORM-007: Convert any value to its string representation.
  TEXT([a], ctx)   { const v = run(a, ctx); return v == null ? '' : String(v); },

  // FORM-008: Concatenate any number of arguments into a single string.
  CONCATENATE(args, ctx) {
    return args.map((a) => { const v = run(a, ctx); return v == null ? '' : String(v); }).join('');
  },

  // FORM-006: ISCHANGED(fieldName) — true when the field's current value differs
  // from its previous value. Previous state is injected into ctx as __prev.
  // Returns false when no previous state is available (create operations).
  ISCHANGED([a], ctx) {
    if (!a || a.k !== 'ref') return false;
    if (!ctx?.__prev) return false;
    const fieldName = a.name;
    const prev = ctx.__prev[fieldName];
    const curr = ctx[fieldName];
    return prev !== curr;
  },
};

// Whitelist of allowed string methods
const ALLOWED_METHODS = new Set(['includes', 'startsWith', 'endsWith', 'toLowerCase', 'toUpperCase', 'trim']);

function toNum(v) { return v instanceof Date ? v.getTime() : Number(v); }

/**
 * Normalises a date to UTC midnight and returns its epoch ms, or null if the
 * value isn't a usable date.
 *
 * Date fields are stored as UTC midnight, and date-only strings ("2026-08-23")
 * also parse as UTC midnight — so day counts must be taken in UTC. Normalising
 * with local getHours/setHours instead would shift the calendar date by one for
 * any user west of UTC.
 */
function utcMidnight(value) {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return null;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

// ─── Interpreter ──────────────────────────────────────────────────────────────
function run(node, ctx, calls = { n: 0 }) {
  if (++calls.n > 10_000) throw new Error('Evaluation limit exceeded');

  switch (node.k) {
    case 'lit': return node.v;

    case 'ref': {
      const v = ctx[node.name];
      if (v == null) return null;
      // Auto-coerce ISO date strings
      if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return new Date(v);
      return v;
    }

    case '!':   return !run(node.e, ctx, calls);
    case 'neg': return -Number(run(node.e, ctx, calls));

    case '||': return run(node.l, ctx, calls) || run(node.r, ctx, calls);
    case '&&': return run(node.l, ctx, calls) && run(node.r, ctx, calls);

    case TT.EQ:  { const [l, r] = [run(node.l, ctx, calls), run(node.r, ctx, calls)]; return l == r; }  // loose equality intentional for null checks
    case TT.NEQ: { const [l, r] = [run(node.l, ctx, calls), run(node.r, ctx, calls)]; return l != r; }
    case TT.GT:  return toNum(run(node.l, ctx, calls)) >  toNum(run(node.r, ctx, calls));
    case TT.GTE: return toNum(run(node.l, ctx, calls)) >= toNum(run(node.r, ctx, calls));
    case TT.LT:  return toNum(run(node.l, ctx, calls)) <  toNum(run(node.r, ctx, calls));
    case TT.LTE: return toNum(run(node.l, ctx, calls)) <= toNum(run(node.r, ctx, calls));

    case TT.PLUS: {
      const [l, r] = [run(node.l, ctx, calls), run(node.r, ctx, calls)];
      return (typeof l === 'string' || typeof r === 'string')
        ? String(l ?? '') + String(r ?? '')
        : Number(l) + Number(r);
    }
    case TT.MINUS: return Number(run(node.l, ctx, calls)) - Number(run(node.r, ctx, calls));
    case TT.STAR:  return Number(run(node.l, ctx, calls)) * Number(run(node.r, ctx, calls));
    case TT.SLASH: {
      const d = Number(run(node.r, ctx, calls));
      if (d === 0) throw new Error('Division by zero');
      return Number(run(node.l, ctx, calls)) / d;
    }

    case 'fn': {
      const fn = BUILTINS[node.name];
      if (!fn) throw new Error(`Unknown function: ${node.name}`);
      return fn(node.args, ctx, calls);
    }

    case 'method': {
      const base = ctx[node.obj];
      if (base == null) return null;
      if (!ALLOWED_METHODS.has(node.method))
        throw new Error(`Method not allowed: ${node.method}`);
      const str = String(base);
      const fn = str[node.method];
      if (typeof fn !== 'function') return null;
      return fn.apply(str, node.args.map(a => run(a, ctx, calls)));
    }

    case 'member': {
      // FORM-002: support lookup.fieldName by checking for a pre-flattened key
      // in the context (formulaService injects these as "lookupApiName.fieldName").
      const flatKey = `${node.obj}.${node.prop}`;
      if (flatKey in ctx) return ctx[flatKey] ?? null;
      const base = ctx[node.obj];
      if (base == null) return null;
      if (node.prop === 'length') return String(base).length;
      return null;
    }

    default:
      throw new Error(`Unknown AST node: ${node.k}`);
  }
}

// ─── Return-type inference ────────────────────────────────────────────────────
/**
 * Formula fields declare a return type (FieldMeta.formulaReturnType) so the
 * platform knows how to store and render the computed value. These tables map
 * everything the evaluator can produce onto four primitive kinds, which is the
 * granularity inference can actually reason about — `currency` and `percent` are
 * numbers that differ only in presentation.
 */
const KINDS = Object.freeze({
  TEXT: 'text', NUMBER: 'number', BOOLEAN: 'boolean', DATE: 'date',
  // Used when a kind genuinely can't be pinned down. Never treated as a
  // mismatch — see validateFormula.
  UNKNOWN: 'unknown',
});

/** Declared `formulaReturnType` → primitive kind. */
const DECLARED_TYPE_KINDS = Object.freeze({
  text: KINDS.TEXT,
  number: KINDS.NUMBER,
  currency: KINDS.NUMBER,
  percent: KINDS.NUMBER,
  date: KINDS.DATE,
  boolean: KINDS.BOOLEAN,
});

/** FieldMeta.type → primitive kind, for inferring a bare field reference. */
const FIELD_TYPE_KINDS = Object.freeze({
  text: KINDS.TEXT, textarea: KINDS.TEXT, email: KINDS.TEXT, phone: KINDS.TEXT,
  url: KINDS.TEXT, picklist: KINDS.TEXT, multipicklist: KINDS.TEXT,
  address: KINDS.TEXT, auto_number: KINDS.TEXT,
  // Relationship fields hold the referenced record's id.
  lookup: KINDS.TEXT, master_detail: KINDS.TEXT,
  number: KINDS.NUMBER, currency: KINDS.NUMBER, percent: KINDS.NUMBER,
  date: KINDS.DATE, datetime: KINDS.DATE,
  boolean: KINDS.BOOLEAN,
});

/** Built-in function → kind of its result. `IF` is resolved from its branches. */
const FN_RETURN_KINDS = Object.freeze({
  LENGTH: KINDS.NUMBER, ABS: KINDS.NUMBER, ROUND: KINDS.NUMBER,
  YEAR: KINDS.NUMBER, MONTH: KINDS.NUMBER, DAY: KINDS.NUMBER,
  DAYS_BETWEEN: KINDS.NUMBER, DAYS_UNTIL: KINDS.NUMBER,
  ISBLANK: KINDS.BOOLEAN, ISNULL: KINDS.BOOLEAN,
  REGEX: KINDS.BOOLEAN, CONTAINS: KINDS.BOOLEAN,
  UPPER: KINDS.TEXT, LOWER: KINDS.TEXT, TRIM: KINDS.TEXT,
  TODAY: KINDS.DATE, NOW: KINDS.DATE, DATEVALUE: KINDS.DATE,
  IF: 'branch',
});

const METHOD_RETURN_KINDS = Object.freeze({
  includes: KINDS.BOOLEAN, startsWith: KINDS.BOOLEAN, endsWith: KINDS.BOOLEAN,
  toLowerCase: KINDS.TEXT, toUpperCase: KINDS.TEXT, trim: KINDS.TEXT,
});

/**
 * Two positions only pin down a kind when they agree. A `null` literal carries
 * no kind, so it yields to the other side rather than poisoning the result —
 * that keeps `IF(ISBLANK(x), null, amount)` inferring as a number.
 */
function unify(a, b) {
  if (a === b) return a;
  if (a === KINDS.UNKNOWN) return b;
  if (b === KINDS.UNKNOWN) return a;
  return KINDS.UNKNOWN;
}

function inferNode(node, kinds) {
  switch (node.k) {
    case 'lit':
      if (typeof node.v === 'number')  return KINDS.NUMBER;
      if (typeof node.v === 'boolean') return KINDS.BOOLEAN;
      if (typeof node.v === 'string')  return KINDS.TEXT;
      return KINDS.UNKNOWN; // null

    case 'ref': return kinds[node.name] || KINDS.UNKNOWN;

    case '!':   return KINDS.BOOLEAN;
    case 'neg': return KINDS.NUMBER;

    // `&&` / `||` return the operand itself rather than a boolean, so
    // `nickname || first_name` is a text coalesce. Only claim a kind when both
    // sides agree; mixed operands fall back to unknown.
    case '||':
    case '&&': return unify(inferNode(node.l, kinds), inferNode(node.r, kinds));

    case TT.EQ: case TT.NEQ:
    case TT.GT: case TT.GTE: case TT.LT: case TT.LTE:
      return KINDS.BOOLEAN;

    // `+` is overloaded: the evaluator concatenates when either side is a
    // string and adds otherwise. Mirror that exactly.
    case TT.PLUS: {
      const l = inferNode(node.l, kinds);
      const r = inferNode(node.r, kinds);
      if (l === KINDS.TEXT || r === KINDS.TEXT) return KINDS.TEXT;
      if (l === KINDS.NUMBER && r === KINDS.NUMBER) return KINDS.NUMBER;
      return KINDS.UNKNOWN;
    }
    case TT.MINUS: case TT.STAR: case TT.SLASH: return KINDS.NUMBER;

    case 'fn': {
      const kind = FN_RETURN_KINDS[node.name];
      if (kind !== 'branch') return kind || KINDS.UNKNOWN;
      const [, whenTrue, whenFalse] = node.args;
      if (whenTrue === undefined) return KINDS.UNKNOWN;
      // A one-armed IF falls through to null, which carries no kind.
      if (whenFalse === undefined) return inferNode(whenTrue, kinds);
      return unify(inferNode(whenTrue, kinds), inferNode(whenFalse, kinds));
    }

    case 'method': return METHOD_RETURN_KINDS[node.method] || KINDS.UNKNOWN;
    case 'member': return node.prop === 'length' ? KINDS.NUMBER : KINDS.UNKNOWN;

    default: return KINDS.UNKNOWN;
  }
}

/**
 * Infer the primitive kind an expression evaluates to.
 * @param  {string} expression
 * @param  {object} [fieldKinds] - { fieldApiName: 'text'|'number'|'boolean'|'date' }
 * @returns {'text'|'number'|'boolean'|'date'|'unknown'} — 'unknown' when the
 *          expression can't be pinned down (unparseable, or a reference to a
 *          field that isn't in `fieldKinds`).
 */
function inferReturnType(expression, fieldKinds = {}) {
  try {
    return inferNode(parseFormula(String(expression).trim()), fieldKinds);
  } catch {
    return KINDS.UNKNOWN;
  }
}

/** The declared return types that are compatible with an inferred kind. */
function declaredTypesForKind(kind) {
  return Object.keys(DECLARED_TYPE_KINDS).filter(
    (t) => DECLARED_TYPE_KINDS[t] === kind,
  );
}

/**
 * Coerce an evaluated result to the field's declared return type, so a formula
 * field's stored value has the type it advertises — list-view filters, sorting
 * and aggregation all read the stored value and would otherwise see whatever
 * JavaScript type the expression happened to produce.
 *
 * A field with no declared return type is left untouched, which keeps formula
 * fields created before return types existed behaving exactly as before.
 */
function coerceToReturnType(value, returnType) {
  const kind = DECLARED_TYPE_KINDS[returnType];
  if (!kind) return value;

  switch (kind) {
    case KINDS.NUMBER: {
      if (value === null || value === undefined || value === '') return null;
      const n = value instanceof Date ? value.getTime() : Number(value);
      return Number.isFinite(n) ? n : null;
    }
    case KINDS.TEXT:
      if (value === null || value === undefined) return null;
      return value instanceof Date ? value.toISOString() : String(value);
    // A false-y result is a legitimate `false`, not a missing value, so this
    // never yields null — a checkbox formula is always one or the other.
    case KINDS.BOOLEAN:
      return Boolean(value);
    case KINDS.DATE: {
      if (value === null || value === undefined || value === '') return null;
      const d = value instanceof Date ? value : new Date(value);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    default:
      return value;
  }
}

// ─── AST cache (LRU-lite) ─────────────────────────────────────────────────────
const AST_CACHE = new Map();
const CACHE_MAX = 300;

function parseFormula(expr) {
  if (AST_CACHE.has(expr)) return AST_CACHE.get(expr);
  const ast = new Parser(new Lexer(expr).tokenize()).parse();
  if (AST_CACHE.size >= CACHE_MAX) AST_CACHE.delete(AST_CACHE.keys().next().value);
  AST_CACHE.set(expr, ast);
  return ast;
}

/**
 * Evaluate an expression string against a record context.
 * @param  {string} expression  - Formula string
 * @param  {object} context     - Field values: { fieldApiName: value }
 * @returns {*}                 - Evaluated result (boolean for most uses)
 */
function evaluateFormula(expression, context) {
  return run(parseFormula(expression.trim()), context);
}

/**
 * Check if an expression is syntactically + semantically valid, and optionally
 * that it returns the type the field declares.
 *
 * @param  {string} expression
 * @param  {object} [sampleContext]     - Optional sample values for dry-run
 * @param  {object} [options]
 * @param  {string} [options.expectedType] - Declared `formulaReturnType`. When
 *         given, a definite kind mismatch makes the formula invalid.
 * @param  {object} [options.fieldKinds]   - { fieldApiName: kind }, for inference
 * @returns {{ valid: boolean, error?: string, returnType?: string }}
 */
function validateFormula(expression, sampleContext = {}, options = {}) {
  const { expectedType, fieldKinds = {} } = options;
  try {
    const ast = parseFormula(expression.trim());
    run(ast, sampleContext); // dry-run with sample (may be null refs, that's fine)

    const returnType = inferNode(ast, fieldKinds);

    if (expectedType) {
      const want = DECLARED_TYPE_KINDS[expectedType];
      if (!want) {
        return {
          valid: false,
          error: `Unknown return type "${expectedType}".`,
          returnType,
        };
      }
      // `unknown` means inference couldn't pin the kind down — an unrecognised
      // field reference, or IF branches of differing kinds. Rejecting on a guess
      // would block legitimate formulas, so only a definite mismatch fails.
      if (returnType !== KINDS.UNKNOWN && returnType !== want) {
        const alternatives = declaredTypesForKind(returnType);
        const list =
          alternatives.length > 1
            ? `${alternatives.slice(0, -1).join(', ')} or ${alternatives.at(-1)}`
            : alternatives[0];
        return {
          valid: false,
          error:
            `This formula returns ${returnType}, but the field's return type is ` +
            `${expectedType}. Either change the return type to ${list}, or ` +
            `adjust the formula to return ${expectedType}.`,
          returnType,
        };
      }
    }

    return { valid: true, returnType };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

/** Clear the AST cache (useful in tests). */
function clearCache() { AST_CACHE.clear(); }

export {
  parseFormula,
  evaluateFormula,
  validateFormula,
  inferReturnType,
  coerceToReturnType,
  declaredTypesForKind,
  DECLARED_TYPE_KINDS,
  FIELD_TYPE_KINDS,
  clearCache,
};
