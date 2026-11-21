import { describe, it, expect } from 'vitest';
import { parsePositiveId, parseIdList } from '../src/lib/ids.js';

describe('parsePositiveId', () => {
  it('accepts positive safe integers and digit-only strings', () => {
    expect(parsePositiveId(1)).toBe(1);
    expect(parsePositiveId(42)).toBe(42);
    expect(parsePositiveId('42')).toBe(42);
    expect(parsePositiveId('007')).toBe(7);
    expect(parsePositiveId(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    expect(parsePositiveId(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
  });

  it.each(['12abc', '3.5', '0', '-1', '', ' ', ' 7', '7 ', '1e3', '+5', '0x10', '1_000', '٣', '１２', '12\n'])(
    'rejects the string %j',
    (value) => {
      expect(parsePositiveId(value)).toBeNull();
    }
  );

  it.each([
    [0],
    [-0],
    [-1],
    [3.5],
    [Number.NaN],
    [Infinity],
    [-Infinity],
    [1e21],
    [Number.MAX_SAFE_INTEGER + 1],
    [2 ** 53]
  ])('rejects the number %s', (value) => {
    expect(parsePositiveId(value)).toBeNull();
  });

  it('rejects huge digit strings that exceed the safe range', () => {
    expect(parsePositiveId('9007199254740993')).toBeNull();
    expect(parsePositiveId('9'.repeat(5000))).toBeNull();
  });

  it('rejects non-number, non-string types', () => {
    const toStringBomb = { toString: () => '5', valueOf: () => 5 };
    for (const value of [
      null,
      undefined,
      true,
      false,
      [],
      [5],
      ['5'],
      {},
      toStringBomb,
      5n,
      Symbol('x'),
      () => 5,
      // eslint-disable-next-line sonarjs/no-primitive-wrappers, unicorn/new-for-builtins -- a boxed Number is one of the inputs under test
      new Number(5)
    ]) {
      expect(parsePositiveId(value)).toBeNull();
    }
  });

  it('is not fooled by prototype-ish strings', () => {
    expect(parsePositiveId('__proto__')).toBeNull();
    expect(parsePositiveId('constructor')).toBeNull();
  });
});

describe('parseIdList', () => {
  it('returns ids, de-duplicated, in first-seen order', () => {
    expect(parseIdList([3, 1, 3, 2, 1])).toEqual({ ids: [3, 1, 2] });
  });

  it('normalises digit strings and de-duplicates across representations', () => {
    expect(parseIdList(['5', 5, '06', 6])).toEqual({ ids: [5, 6] });
  });

  it('rejects non-arrays', () => {
    for (const value of [undefined, null, 5, '1,2', { 0: 1, length: 1 }, new Set([1])]) {
      expect(parseIdList(value)).toEqual({ error: 'not_array' });
    }
  });

  it('rejects an empty array', () => {
    expect(parseIdList([])).toEqual({ error: 'empty' });
  });

  it('enforces max on the raw length (default 1000)', () => {
    expect(parseIdList(Array.from({ length: 1000 }, (_, i) => i + 1)).ids).toHaveLength(1000);
    expect(parseIdList(Array.from({ length: 1001 }, (_, i) => i + 1))).toEqual({ error: 'too_many' });
    expect(parseIdList([1, 1, 1, 1], { max: 3 })).toEqual({ error: 'too_many' });
    expect(parseIdList([1, 2, 3], { max: 3 })).toEqual({ ids: [1, 2, 3] });
  });

  it('rejects the whole list when any id is invalid', () => {
    for (const bad of [0, -1, 1.5, '12abc', null, undefined, Number.NaN, 1e21, [], {}, true]) {
      expect(parseIdList([1, bad, 3])).toEqual({ error: 'invalid_id' });
    }
  });

  it('rejects holes in sparse arrays', () => {
    // eslint-disable-next-line no-sparse-arrays
    expect(parseIdList([1, , 3])).toEqual({ error: 'invalid_id' });
  });

  it('reports errors in the documented precedence', () => {
    expect(
      parseIdList(
        Array.from({ length: 5 }, () => 'x'),
        { max: 2 }
      )
    ).toEqual({ error: 'too_many' });
  });
});
