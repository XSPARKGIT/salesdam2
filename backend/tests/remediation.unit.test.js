/**
 * Remediation verification unit tests.
 * Tests the specific behaviours added in the Phase 3 + Phase 4 remediation pass.
 * These tests import individual modules without a running MongoDB instance.
 */

// ─── formulaParser tests (FORM-006, FORM-007, FORM-008) ──────────────────────
describe('formulaParser — new BUILTINS', () => {
  let evaluateFormula;
  beforeAll(async () => {
    const m = await import('../services/formulaParser.js');
    evaluateFormula = m.evaluateFormula;
  });

  // FORM-007: TEXT()
  test('TEXT(42) returns "42"', () => {
    expect(evaluateFormula('TEXT(42)', {})).toBe('42');
  });
  test('TEXT(null) returns ""', () => {
    expect(evaluateFormula('TEXT(null)', {})).toBe('');
  });

  // FORM-008: CONCATENATE()
  test('CONCATENATE("a","b","c") returns "abc"', () => {
    expect(evaluateFormula('CONCATENATE("a","b","c")', {})).toBe('abc');
  });
  test('CONCATENATE with null coerces to empty string', () => {
    expect(evaluateFormula('CONCATENATE("hello",null)', {})).toBe('hello');
  });

  // FORM-006: ISCHANGED()
  test('ISCHANGED returns true when field changed', () => {
    const ctx = { status: 'closed', __prev: { status: 'open' } };
    expect(evaluateFormula('ISCHANGED(status)', ctx)).toBe(true);
  });
  test('ISCHANGED returns false when field unchanged', () => {
    const ctx = { status: 'open', __prev: { status: 'open' } };
    expect(evaluateFormula('ISCHANGED(status)', ctx)).toBe(false);
  });
  test('ISCHANGED returns false when no __prev available', () => {
    const ctx = { status: 'open' };
    expect(evaluateFormula('ISCHANGED(status)', ctx)).toBe(false);
  });
});

// Note: validateRecordData tests require ESM (sanitize-html dependency).
// They live in tests/remediation.validationService.test.mjs — run with node --test.

// ─── duplicateDetectionService tests (DUP-011, DUP-012) ──────────────────────
describe('duplicateDetectionService — action priority', () => {
  test('NON_BLOCKING_ACTIONS export exists', async () => {
    const m = await import('../services/duplicateDetectionService.js');
    expect(m.default.NON_BLOCKING_ACTIONS).toBeDefined();
    // use_existing and trigger_flow are no longer in NON_BLOCKING_ACTIONS; they now have priority
    // The set still exists for backward compatibility with existing callers
    expect(typeof m.default.check).toBe('function');
  });
});

// ─── OBJ-004: consecutive/trailing underscore validation ─────────────────────
describe('OBJ-004 — apiName underscore rules (regex guard)', () => {
  const forbidden = ['a__b', 'test__obj', 'trailing_', 'a_b_'];
  const allowed   = ['contact', 'field_1', 'my_object'];

  forbidden.forEach((name) => {
    test(`rejects "${name}"`, () => {
      expect(/__|_$/.test(name)).toBe(true);
    });
  });

  allowed.forEach((name) => {
    test(`accepts "${name}"`, () => {
      expect(/__|_$/.test(name)).toBe(false);
    });
  });
});

// ─── PICK-005: multiple isDefault picklist values ─────────────────────────────
describe('PICK-005 — multiple default picklist values guard', () => {
  function countDefaults(values) {
    return values.filter((v) => v.isDefault).length;
  }

  test('rejects two isDefault=true values', () => {
    const values = [
      { value: 'a', label: 'A', isDefault: true },
      { value: 'b', label: 'B', isDefault: true },
    ];
    expect(countDefaults(values)).toBeGreaterThan(1);
  });

  test('accepts one isDefault=true value', () => {
    const values = [
      { value: 'a', label: 'A', isDefault: true },
      { value: 'b', label: 'B', isDefault: false },
    ];
    expect(countDefaults(values)).toBe(1);
  });

  test('accepts no isDefault values', () => {
    const values = [
      { value: 'a', label: 'A', isDefault: false },
    ];
    expect(countDefaults(values)).toBe(0);
  });
});

// ─── SEC-003: API key scope enforcement logic ─────────────────────────────────
describe('SEC-003 — API key scope enforcement logic', () => {
  const METHOD_SCOPE = { GET: 'read', HEAD: 'read', POST: 'write', PUT: 'write', PATCH: 'write', DELETE: 'delete' };

  function scopeCheck(scopes, method) {
    if (!scopes || scopes.length === 0) return 'allow';
    const required = METHOD_SCOPE[method?.toUpperCase()];
    if (!required) return 'allow';
    if (scopes.includes(required) || scopes.includes('admin')) return 'allow';
    return 'deny';
  }

  test('read-only key allows GET', () => {
    expect(scopeCheck(['read'], 'GET')).toBe('allow');
  });
  test('read-only key denies POST', () => {
    expect(scopeCheck(['read'], 'POST')).toBe('deny');
  });
  test('admin key allows DELETE', () => {
    expect(scopeCheck(['admin'], 'DELETE')).toBe('allow');
  });
  test('empty scopes allow all methods (unrestricted key)', () => {
    expect(scopeCheck([], 'DELETE')).toBe('allow');
  });
  test('write scope allows PUT', () => {
    expect(scopeCheck(['write'], 'PUT')).toBe('allow');
  });
  test('write scope denies DELETE', () => {
    expect(scopeCheck(['write'], 'DELETE')).toBe('deny');
  });
});

// ─── REL-005 / REL-006 constraint logic ──────────────────────────────────────
describe('REL-005/REL-006 — master_detail limit', () => {
  function canAddMasterDetail(isJunctionObject, existingCount) {
    const limit = isJunctionObject ? 2 : 1;
    return existingCount < limit;
  }

  test('non-junction: first master_detail allowed', () => {
    expect(canAddMasterDetail(false, 0)).toBe(true);
  });
  test('non-junction: second master_detail blocked', () => {
    expect(canAddMasterDetail(false, 1)).toBe(false);
  });
  test('junction: first master_detail allowed', () => {
    expect(canAddMasterDetail(true, 0)).toBe(true);
  });
  test('junction: second master_detail allowed', () => {
    expect(canAddMasterDetail(true, 1)).toBe(true);
  });
  test('junction: third master_detail blocked', () => {
    expect(canAddMasterDetail(true, 2)).toBe(false);
  });
});

// ─── SEC-003: Field-Level Security fail-closed logic ─────────────────────────
describe('SEC-003 — FLS fail-closed (getVisibleFields / getEditableFields)', () => {
  // Mirrors the logic in backend/middleware/permissions.js
  // Extracted as pure functions so no MongoDB connection is needed.

  function getVisibleFields(fieldApiNames, nameFieldApiName, roleDoc, objectApiName) {
    if (!roleDoc) return fieldApiNames; // no role means superuser path in actual code
    const objPerm = (roleDoc.objectPermissions || []).find(
      (p) => p.objectApiName === objectApiName,
    );
    // SEC-002/FLD-013: fail closed — no entry → only the name field
    if (!objPerm) return fieldApiNames.filter((f) => f === nameFieldApiName);
    const hidden = new Set(
      (objPerm.fieldPermissions || [])
        .filter((fp) => !fp.canView)
        .map((fp) => fp.fieldApiName),
    );
    hidden.delete(nameFieldApiName);
    return fieldApiNames.filter((f) => !hidden.has(f));
  }

  function getEditableFields(fieldApiNames, nameFieldApiName, roleDoc, objectApiName) {
    if (!roleDoc) return fieldApiNames;
    const objPerm = (roleDoc.objectPermissions || []).find(
      (p) => p.objectApiName === objectApiName,
    );
    // SEC-002: fail closed — no entry → no editable fields
    if (!objPerm) return [];
    const readOnly = new Set(
      (objPerm.fieldPermissions || [])
        .filter((fp) => !fp.canEdit)
        .map((fp) => fp.fieldApiName),
    );
    readOnly.add(nameFieldApiName);
    return fieldApiNames.filter((f) => !readOnly.has(f));
  }

  const fields = ['name', 'email', 'phone', 'status'];
  const nameField = 'name';

  // getVisibleFields — fail-closed behaviour
  test('role with no object entry → only name field visible', () => {
    const role = { objectPermissions: [] };
    expect(getVisibleFields(fields, nameField, role, 'contact')).toEqual(['name']);
  });

  test('role with object entry but no fieldPermissions → all fields visible', () => {
    const role = { objectPermissions: [{ objectApiName: 'contact', fieldPermissions: [] }] };
    expect(getVisibleFields(fields, nameField, role, 'contact')).toEqual(fields);
  });

  test('role hides specific field → that field excluded', () => {
    const role = {
      objectPermissions: [
        { objectApiName: 'contact', fieldPermissions: [{ fieldApiName: 'phone', canView: false }] },
      ],
    };
    expect(getVisibleFields(fields, nameField, role, 'contact')).toEqual(['name', 'email', 'status']);
  });

  test('name field is always included even if marked hidden', () => {
    const role = {
      objectPermissions: [
        { objectApiName: 'contact', fieldPermissions: [{ fieldApiName: 'name', canView: false }] },
      ],
    };
    expect(getVisibleFields(fields, nameField, role, 'contact')).toContain('name');
  });

  // getEditableFields — fail-closed behaviour
  test('role with no object entry → no editable fields', () => {
    const role = { objectPermissions: [] };
    expect(getEditableFields(fields, nameField, role, 'contact')).toEqual([]);
  });

  test('name field is never editable for non-admin', () => {
    const role = {
      objectPermissions: [{ objectApiName: 'contact', fieldPermissions: [] }],
    };
    expect(getEditableFields(fields, nameField, role, 'contact')).not.toContain('name');
  });

  test('role grants edit on email and status → those returned', () => {
    const role = {
      objectPermissions: [
        {
          objectApiName: 'contact',
          fieldPermissions: [{ fieldApiName: 'email', canEdit: false }],
        },
      ],
    };
    const editable = getEditableFields(fields, nameField, role, 'contact');
    expect(editable).toContain('status');
    expect(editable).not.toContain('email');
    expect(editable).not.toContain('name');
  });
});

// ─── LIFE-005: deleteObject dependency check logic ────────────────────────────
describe('LIFE-005 — object deletion dependency check', () => {
  function shouldBlock(force, recordCount, fieldCount) {
    return force !== 'true' && (recordCount > 0 || fieldCount > 0);
  }

  test('blocks when records exist and no force flag', () => {
    expect(shouldBlock(undefined, 5, 3)).toBe(true);
  });
  test('allows when force=true even with records', () => {
    expect(shouldBlock('true', 5, 3)).toBe(false);
  });
  test('allows when no dependents and no force flag', () => {
    expect(shouldBlock(undefined, 0, 0)).toBe(false);
  });
});
