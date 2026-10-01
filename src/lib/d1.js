/**
 * Cloudflare D1 helpers.
 */

/** D1 allows at most 100 bound parameters per statement. */
export const D1_MAX_VARIABLES = 100;

/**
 * Ids per statement, leaving room for a few leading parameters (timestamp,
 * status, ...) below `D1_MAX_VARIABLES`.
 */
export const SAFE_IDS_PER_STATEMENT = 90;

/**
 * Split an array into consecutive chunks of at most `size` items.
 * @template T
 * @param {T[]} array
 * @param {number} size - Positive integer
 * @returns {T[][]}
 */
export function chunk(array, size) {
  if (!Number.isInteger(size) || size < 1) {
    throw new RangeError('chunk: size must be a positive integer');
  }
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Placeholders for an `IN (...)` clause: `inClause(3)` is `'?,?,?'`.
 * @param {number} count - Non-negative integer
 * @returns {string}
 */
export function inClause(count) {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError('inClause: count must be a non-negative integer');
  }
  return Array.from({ length: count }, () => '?').join(',');
}

/**
 * Run a statement over a list of ids, split so that no statement exceeds D1's
 * bound-parameter limit. One prepared statement is built per chunk, and all of
 * them run in ONE atomic `db.batch`.
 *
 * @example
 * await runByIds(db, ids, (ph) => `UPDATE members SET status = ? WHERE id IN (${ph})`,
 *   { leadingParams: ['active'] });
 *
 * @param {{ prepare: Function, batch: Function }} db - D1 database
 * @param {number[]} ids
 * @param {(placeholders: string) => string} buildSql - Returns SQL containing `IN (${placeholders})`
 * @param {{ leadingParams?: unknown[], size?: number }} [options]
 *   `leadingParams` are bound before the ids in every statement; `size` is the
 *   ids per statement (default `SAFE_IDS_PER_STATEMENT`).
 * @returns {Promise<number>} total `meta.changes` across all statements (0 for an empty list, without touching D1)
 * @throws {RangeError} if `leadingParams.length + size` exceeds `D1_MAX_VARIABLES`
 */
export async function runByIds(db, ids, buildSql, { leadingParams = [], size = SAFE_IDS_PER_STATEMENT } = {}) {
  if (leadingParams.length + size > D1_MAX_VARIABLES) {
    throw new RangeError(
      `runByIds: ${leadingParams.length} leading params + ${size} ids exceed D1's ${D1_MAX_VARIABLES} variable limit`
    );
  }
  if (ids.length === 0) return 0;

  const statements = chunk(ids, size).map((part) =>
    db.prepare(buildSql(inClause(part.length))).bind(...leadingParams, ...part)
  );
  const results = await db.batch(statements);
  return results.reduce((total, result) => total + (Number(result?.meta?.changes) || 0), 0);
}
