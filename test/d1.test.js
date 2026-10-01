import { describe, it, expect } from 'vitest';
import { D1_MAX_VARIABLES, SAFE_IDS_PER_STATEMENT, chunk, inClause, runByIds } from '../src/lib/d1.js';

/** Fake D1 recording every prepared statement and every batch call. */
function createFakeDb({ changesPerStatement = (statement) => statement.params.length } = {}) {
  const db = {
    batches: [],
    prepared: [],
    prepare(sql) {
      const statement = { sql, params: [], bind(...params) { statement.params = params; return statement; } };
      db.prepared.push(statement);
      return statement;
    },
    async batch(statements) {
      db.batches.push(statements);
      return statements.map((statement) => ({ meta: { changes: changesPerStatement(statement) } }));
    }
  };
  return db;
}

const ids = (n) => Array.from({ length: n }, (_, i) => i + 1);
const build = (placeholders) => `UPDATE members SET status = ? WHERE id IN (${placeholders})`;

describe('constants', () => {
  it('match D1 limits', () => {
    expect(D1_MAX_VARIABLES).toBe(100);
    expect(SAFE_IDS_PER_STATEMENT).toBe(90);
  });
});

describe('chunk', () => {
  it('splits into consecutive chunks', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]]);
    expect(chunk([1], 5)).toEqual([[1]]);
    expect(chunk([], 3)).toEqual([]);
  });

  it('does not mutate its input', () => {
    const input = [1, 2, 3];
    chunk(input, 2);
    expect(input).toEqual([1, 2, 3]);
  });

  it.each([0, -1, 1.5, NaN, Infinity, '2', null, undefined])('rejects size %s', (size) => {
    expect(() => chunk([1, 2], size)).toThrow(RangeError);
  });
});

describe('inClause', () => {
  it('builds comma-separated placeholders', () => {
    expect(inClause(1)).toBe('?');
    expect(inClause(3)).toBe('?,?,?');
    expect(inClause(0)).toBe('');
    expect(inClause(90).split(',')).toHaveLength(90);
  });

  it.each([-1, 1.5, NaN, Infinity, '3', null])('rejects count %s', (count) => {
    expect(() => inClause(count)).toThrow(RangeError);
  });
});

describe('runByIds', () => {
  it.each([
    [1, [1]],
    [89, [89]],
    [90, [90]],
    [91, [90, 1]],
    [180, [90, 90]],
    [181, [90, 90, 1]]
  ])('%i ids make statements of sizes %j in ONE batch', async (count, sizes) => {
    const db = createFakeDb();
    const total = await runByIds(db, ids(count), build, { leadingParams: ['active'] });

    expect(db.batches).toHaveLength(1);
    expect(db.batches[0]).toHaveLength(sizes.length);
    expect(db.batches[0].map((s) => s.params.length - 1)).toEqual(sizes);
    expect(total).toBe(count + sizes.length); // fake reports one change per bound param
  });

  it('binds leading params first, then the ids of the chunk, and builds the SQL per chunk', async () => {
    const db = createFakeDb();
    await runByIds(db, ids(92), build, { leadingParams: ['active', 'x'] });
    const [first, second] = db.batches[0];
    expect(first.params.slice(0, 2)).toEqual(['active', 'x']);
    expect(first.params.slice(2)).toEqual(ids(90));
    expect(first.sql).toBe(build(inClause(90)));
    expect(second.params).toEqual(['active', 'x', 91, 92]);
    expect(second.sql).toBe(build('?,?'));
  });

  it('never exceeds D1_MAX_VARIABLES in any statement', async () => {
    const db = createFakeDb();
    await runByIds(db, ids(1000), build, { leadingParams: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'] });
    for (const statement of db.batches[0]) {
      expect(statement.params.length).toBeLessThanOrEqual(D1_MAX_VARIABLES);
    }
  });

  it('works without leading params and with a custom size', async () => {
    const db = createFakeDb();
    const total = await runByIds(db, ids(5), (ph) => `DELETE FROM t WHERE id IN (${ph})`, { size: 2 });
    expect(db.batches[0].map((s) => s.params)).toEqual([[1, 2], [3, 4], [5]]);
    expect(total).toBe(5);
  });

  it('returns 0 without touching D1 for an empty list', async () => {
    const db = createFakeDb();
    expect(await runByIds(db, [], build)).toBe(0);
    expect(db.prepared).toHaveLength(0);
    expect(db.batches).toHaveLength(0);
  });

  it('sums meta.changes and tolerates missing meta', async () => {
    const db = createFakeDb();
    db.batch = async () => [{ meta: { changes: 5 } }, { meta: {} }, {}, { meta: { changes: 'x' } }, { meta: { changes: 2 } }];
    expect(await runByIds(db, ids(450), build)).toBe(7);
  });

  it('rejects a configuration that cannot fit in D1 limits, before any call', async () => {
    const db = createFakeDb();
    await expect(runByIds(db, ids(3), build, { size: 101 })).rejects.toThrow(RangeError);
    await expect(runByIds(db, ids(3), build, { size: 90, leadingParams: new Array(11).fill(0) })).rejects.toThrow(/variable limit/);
    expect(db.prepared).toHaveLength(0);
    expect(db.batches).toHaveLength(0);
  });

  it('propagates batch failures (atomic batch is all-or-nothing)', async () => {
    const db = createFakeDb();
    db.batch = async () => { throw new Error('D1 down'); };
    await expect(runByIds(db, ids(200), build)).rejects.toThrow('D1 down');
  });
});
