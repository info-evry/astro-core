/**
 * Strict identifier parsing for path params and request bodies.
 */

const DIGITS_ONLY = /^\d+$/;

/**
 * Parse a database id. Accepts positive safe integers and strings made only
 * of ASCII digits; everything else yields `null` ('12abc', '3.5', '1e3',
 * ' 7', '0', '-1', '', null, NaN, Infinity, 1e21, arrays, objects, booleans,
 * bigint).
 * @param {unknown} value
 * @returns {number|null}
 */
export function parsePositiveId(value) {
  let id;
  if (typeof value === 'number') {
    id = value;
  } else if (typeof value === 'string' && DIGITS_ONLY.test(value)) {
    id = Number(value);
  } else {
    return null;
  }
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * Parse a list of ids (each as in `parsePositiveId`). Duplicates are removed
 * and the first-seen order is preserved. The size limit applies to the raw
 * list, before de-duplication.
 *
 * Error precedence: `not_array`, `empty`, `too_many`, `invalid_id`.
 *
 * @param {unknown} value
 * @param {{ max?: number }} [options] - `max` defaults to 1000
 * @returns {{ ids: number[] } | { error: 'not_array'|'empty'|'too_many'|'invalid_id' }}
 */
export function parseIdList(value, { max = 1000 } = {}) {
  if (!Array.isArray(value)) return { error: 'not_array' };
  if (value.length === 0) return { error: 'empty' };
  if (value.length > max) return { error: 'too_many' };

  const seen = new Set();
  // for...of (unlike forEach/every) visits holes of sparse arrays as
  // `undefined`, which parsePositiveId rejects.
  for (const item of value) {
    const id = parsePositiveId(item);
    if (id === null) return { error: 'invalid_id' };
    seen.add(id);
  }
  return { ids: [...seen] };
}
