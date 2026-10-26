/**
 * validateRecordData ESM unit tests (TYPE-003, TYPE-017, TYPE-020, TYPE-021, FLD-011).
 * Run with:  node --test tests/remediation.validationService.test.mjs
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateRecordData } from '../services/validationService.js';

function field(overrides) {
  return { apiName: 'f', label: 'F', type: 'text', isRequired: false, ...overrides };
}

describe('TYPE-003 richtext XSS sanitisation', () => {
  test('strips <script> tags', async () => {
    const fields = [field({ type: 'richtext' })];
    const { data } = await validateRecordData(
      { f: '<b>hello</b><script>alert(1)</script>' },
      fields, 't1', null,
    );
    assert.ok(!data.f.includes('<script>'), 'script tag should be stripped');
    assert.ok(data.f.includes('<b>hello</b>'), 'bold tag should be kept');
  });

  test('strips onclick attributes', async () => {
    const fields = [field({ type: 'richtext' })];
    const { data } = await validateRecordData(
      { f: '<p onclick="evil()">text</p>' },
      fields, 't1', null,
    );
    assert.ok(!data.f.includes('onclick'), 'onclick should be stripped');
  });
});

describe('TYPE-017 phone format validation', () => {
  test('rejects obviously invalid string', async () => {
    const fields = [field({ type: 'phone' })];
    const { errors } = await validateRecordData({ f: 'not!!phone@@' }, fields, 't1', null);
    assert.ok(errors.length > 0, 'should produce validation error');
  });

  test('accepts +27 format', async () => {
    const fields = [field({ type: 'phone' })];
    const { errors } = await validateRecordData({ f: '+27 82 123 4567' }, fields, 't1', null);
    assert.equal(errors.length, 0);
  });

  test('accepts (021) 555-1234', async () => {
    const fields = [field({ type: 'phone' })];
    const { errors } = await validateRecordData({ f: '(021) 555-1234' }, fields, 't1', null);
    assert.equal(errors.length, 0);
  });
});

describe('TYPE-021 time format validation', () => {
  test('rejects 99:99:99', async () => {
    const fields = [field({ type: 'time' })];
    const { errors } = await validateRecordData({ f: '99:99:99' }, fields, 't1', null);
    assert.ok(errors.length > 0);
  });

  test('accepts 14:30', async () => {
    const fields = [field({ type: 'time' })];
    const { errors } = await validateRecordData({ f: '14:30' }, fields, 't1', null);
    assert.equal(errors.length, 0);
  });

  test('accepts 09:05:00', async () => {
    const fields = [field({ type: 'time' })];
    const { errors } = await validateRecordData({ f: '09:05:00' }, fields, 't1', null);
    assert.equal(errors.length, 0);
  });

  test('accepts empty string (non-required field)', async () => {
    const fields = [field({ type: 'time' })];
    const { errors } = await validateRecordData({ f: '' }, fields, 't1', null);
    assert.equal(errors.length, 0);
  });
});

describe('TYPE-020 address structured coercion', () => {
  test('coerces plain string to string', async () => {
    const fields = [field({ type: 'address' })];
    const { data } = await validateRecordData({ f: '123 Main St' }, fields, 't1', null);
    assert.equal(typeof data.f, 'string');
  });

  test('coerces structured object', async () => {
    const fields = [field({ type: 'address' })];
    const addr = { street: '123 Main St', city: 'Joburg', country: 'ZA', postalCode: '2000' };
    const { data } = await validateRecordData({ f: addr }, fields, 't1', null);
    assert.equal(data.f.street, '123 Main St');
    assert.equal(data.f.city, 'Joburg');
  });
});

describe('FLD-011 TODAY()/NOW() default values', () => {
  test('TODAY() default evaluates to a Date on today', async () => {
    const fields = [field({ type: 'date', defaultValue: 'TODAY()' })];
    const { data } = await validateRecordData({}, fields, 't1', null);
    assert.ok(data.f instanceof Date, 'should be a Date');
    assert.equal(data.f.getUTCFullYear(), new Date().getUTCFullYear());
  });

  test('NOW() default evaluates to current timestamp', async () => {
    const fields = [field({ type: 'datetime', defaultValue: 'NOW()' })];
    const { data } = await validateRecordData({}, fields, 't1', null);
    assert.ok(data.f instanceof Date);
    assert.ok(Math.abs(Date.now() - data.f.getTime()) < 5000);
  });
});
