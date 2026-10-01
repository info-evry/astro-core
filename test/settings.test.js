import { describe, it, expect } from 'vitest';
import {
  validateSettings, isBooleanLike, isIntInRange, isTimeHHMM, isStringArray, isAcademicYear, isMoneyCents
} from '../src/lib/settings.js';

const schema = {
  membership_open: isBooleanLike,
  current_year: isAcademicYear,
  limit: isIntInRange(1, 10),
  custom: (v) => (v === 'ok' ? true : 'doit valoir ok'),
  generic: (v) => v === 'ok'
};

describe('validateSettings', () => {
  it('accepts valid settings and returns entries in body order, values untouched', () => {
    const result = validateSettings({ limit: 3, membership_open: 'true', current_year: '2024-2025' }, schema);
    expect(result).toEqual({
      ok: true,
      entries: [['limit', 3], ['membership_open', 'true'], ['current_year', '2024-2025']]
    });
  });

  it('accepts an empty object', () => {
    expect(validateSettings({}, schema)).toEqual({ ok: true, entries: [] });
  });

  it('reports unknown keys', () => {
    expect(validateSettings({ limit: 3, nope: 1, other: 2 }, schema)).toEqual({
      ok: false, unknown: ['nope', 'other'], invalid: []
    });
  });

  it('reports invalid keys with the validator message, or a generic one for false', () => {
    expect(validateSettings({ custom: 'x', generic: 'x', limit: 99 }, schema)).toEqual({
      ok: false,
      unknown: [],
      invalid: [{ custom: 'doit valoir ok' }, { generic: 'Valeur invalide' }, { limit: 'Valeur invalide' }]
    });
  });

  it('treats an empty-string verdict as generic and a truthy non-true verdict as invalid', () => {
    const result = validateSettings({ a: 1, b: 1 }, { a: () => '', b: () => 1 });
    expect(result.invalid).toEqual([{ a: 'Valeur invalide' }, { b: 'Valeur invalide' }]);
  });

  it('reports unknown and invalid together and never returns entries on failure', () => {
    const result = validateSettings({ limit: 0, nope: 1, custom: 'ok' }, schema);
    expect(result).toEqual({ ok: false, unknown: ['nope'], invalid: [{ limit: 'Valeur invalide' }] });
    expect(result).not.toHaveProperty('entries');
  });

  it('is prototype-safe: inherited names and __proto__ are unknown keys', () => {
    const body = JSON.parse('{"__proto__":{"x":1},"constructor":1,"toString":2,"hasOwnProperty":3,"valueOf":4}');
    const result = validateSettings(body, schema);
    expect(result.ok).toBe(false);
    expect(result.unknown.sort()).toEqual(['__proto__', 'constructor', 'hasOwnProperty', 'toString', 'valueOf']);
    expect({}.x).toBeUndefined();
  });

  it('ignores inherited properties of the body', () => {
    const body = Object.create({ limit: 3 });
    expect(validateSettings(body, schema)).toEqual({ ok: true, entries: [] });
  });

  it('does not let a schema inherit validators', () => {
    expect(validateSettings({ toString: 'x' }, {}).unknown).toEqual(['toString']);
  });

  it('treats a throwing validator as a rejection', () => {
    const result = validateSettings({ a: 1 }, { a: () => { throw new Error('boom'); } });
    expect(result).toEqual({ ok: false, unknown: [], invalid: [{ a: 'Valeur invalide' }] });
  });

  it('rejects misconfiguration and non-object bodies loudly', () => {
    for (const body of [null, undefined, [], 'x', 5]) {
      expect(() => validateSettings(body, schema)).toThrow(TypeError);
    }
    expect(() => validateSettings({}, null)).toThrow(TypeError);
    expect(() => validateSettings({ a: 1 }, { a: 'not a function' })).toThrow(TypeError);
  });
});

describe('isBooleanLike', () => {
  it('accepts booleans and the strings true/false only', () => {
    for (const ok of [true, false, 'true', 'false']) expect(isBooleanLike(ok)).toBe(true);
    for (const bad of ['True', 'yes', '1', 1, 0, null, undefined, [], {}, ' true']) expect(isBooleanLike(bad)).toBe(false);
  });
});

describe('isIntInRange', () => {
  const inRange = isIntInRange(0, 10);

  it('accepts integers within bounds, inclusive', () => {
    for (const ok of [0, 5, 10, -0]) expect(inRange(ok)).toBe(true);
  });

  it('rejects out of range, non-integers and non-numbers', () => {
    for (const bad of [-1, 11, 5.5, NaN, Infinity, '5', null, undefined, [5], {}, true, 1e21]) {
      expect(inRange(bad)).toBe(false);
    }
  });

  it('supports negative ranges and rejects an invalid configuration', () => {
    expect(isIntInRange(-5, -1)(-3)).toBe(true);
    expect(() => isIntInRange(5, 1)).toThrow(RangeError);
    expect(() => isIntInRange(NaN, 1)).toThrow(RangeError);
    expect(() => isIntInRange(0, Infinity)).toThrow(RangeError);
    expect(() => isIntInRange('1', 2)).toThrow(RangeError);
  });
});

describe('isTimeHHMM', () => {
  it('accepts 00:00 to 23:59', () => {
    for (const ok of ['00:00', '09:05', '12:30', '23:59']) expect(isTimeHHMM(ok)).toBe(true);
  });

  it('rejects everything else', () => {
    for (const bad of ['24:00', '23:60', '9:05', '09:5', '0905', '09:05:00', ' 09:05', '09:05\n', 'ab:cd', '', null, 905, [], '٠٩:٠٥']) {
      expect(isTimeHHMM(bad)).toBe(false);
    }
  });
});

describe('isStringArray', () => {
  it('accepts arrays of non-blank strings within limits (defaults: 0..100 items, 256 chars)', () => {
    const valid = isStringArray();
    expect(valid(['a', 'b'])).toBe(true);
    expect(valid([])).toBe(true);
    expect(valid(['x'.repeat(256)])).toBe(true);
    expect(valid(['x'.repeat(257)])).toBe(false);
    expect(valid(new Array(100).fill('a'))).toBe(true);
    expect(valid(new Array(101).fill('a'))).toBe(false);
  });

  it('honours maxItems, maxLength and minItems', () => {
    const valid = isStringArray({ minItems: 1, maxItems: 2, maxLength: 3 });
    expect(valid([])).toBe(false);
    expect(valid(['abc'])).toBe(true);
    expect(valid(['abc', 'def'])).toBe(true);
    expect(valid(['a', 'b', 'c'])).toBe(false);
    expect(valid(['abcd'])).toBe(false);
  });

  it('rejects blank strings, non-strings, holes and non-arrays', () => {
    const valid = isStringArray();
    for (const bad of [[''], ['  '], ['a', 1], ['a', null], [['a']], [{}], 'a', null, undefined, { length: 1, 0: 'a' }, new Set(['a'])]) {
      expect(valid(bad)).toBe(false);
    }
    // eslint-disable-next-line no-sparse-arrays
    expect(valid(['a', , 'b'])).toBe(false);
  });
});

describe('isAcademicYear', () => {
  it('accepts consecutive years', () => {
    for (const ok of ['2024-2025', '1999-2000', '2025-2026']) expect(isAcademicYear(ok)).toBe(true);
  });

  it('rejects non-consecutive, malformed and non-string values', () => {
    for (const bad of ['2024-2026', '2024-2024', '2025-2024', '24-25', '2024/2025', '2024-2025 ', ' 2024-2025', '20244-2025', '', null, 2024, [], '2024–2025']) {
      expect(isAcademicYear(bad)).toBe(false);
    }
  });
});

describe('isMoneyCents', () => {
  const valid = isMoneyCents(10_000);

  it('accepts non-negative integers up to max', () => {
    for (const ok of [0, 1, 1999, 10_000]) expect(valid(ok)).toBe(true);
  });

  it('rejects negatives, fractions, too large, strings and specials', () => {
    for (const bad of [-1, 10.5, 10_001, '100', null, undefined, NaN, Infinity, 1e21, [100], {}, true]) {
      expect(valid(bad)).toBe(false);
    }
  });

  it('defaults max to MAX_SAFE_INTEGER and validates its configuration', () => {
    expect(isMoneyCents()(Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(isMoneyCents()(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
    expect(() => isMoneyCents(-1)).toThrow(RangeError);
    expect(() => isMoneyCents(NaN)).toThrow(RangeError);
  });
});
