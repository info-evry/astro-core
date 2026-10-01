/**
 * Allowlist-based validation of settings payloads, plus common validators.
 *
 * A schema maps each accepted key to a validator `(value) => true | string | false`:
 * `true` accepts, a string rejects with that message, `false` rejects with the
 * generic message. The validators exported here return booleans, so a rejected
 * value reports the generic message unless you wrap them.
 */

const INVALID_VALUE_MESSAGE = 'Valeur invalide';

/**
 * @typedef {(value: unknown) => true|string|false} SettingValidator
 */

/**
 * Run a validator; null when it accepts, else the rejection message.
 * @param {SettingValidator} validator
 * @param {unknown} value
 * @returns {string|null}
 */
function rejectionMessage(validator, value) {
  let verdict;
  try {
    verdict = validator(value);
  } catch {
    verdict = false;
  }
  if (verdict === true) return null;
  return typeof verdict === 'string' && verdict ? verdict : INVALID_VALUE_MESSAGE;
}

/**
 * Validate a settings object (typically the parsed JSON body, see
 * `readJsonObject`) against a schema. Only own, enumerable keys of `body` are
 * considered and only own keys of `schema` are accepted, so `__proto__`,
 * `constructor`, `toString`... are reported as unknown. A validator that throws
 * counts as a rejection.
 *
 * - success: `{ ok: true, entries: [[key, value], ...] }` in body order
 *   (`entries` is empty for `{}`: callers decide whether that is an error);
 * - failure: `{ ok: false, unknown: string[], invalid: Array<{ [key]: message }> }`
 *   where `invalid` holds one single-key object per rejected key.
 *
 * @param {Record<string, unknown>} body
 * @param {Record<string, SettingValidator>} schema
 * @returns {{ ok: true, entries: Array<[string, unknown]> } | { ok: false, unknown: string[], invalid: Array<Record<string, string>> }}
 * @throws {TypeError} if `body` is not an object or a schema entry is not a function
 */
export function validateSettings(body, schema) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new TypeError('validateSettings: body must be a plain object');
  }
  if (schema === null || typeof schema !== 'object') {
    throw new TypeError('validateSettings: schema must be an object');
  }

  const unknown = [];
  const invalid = [];
  const entries = [];
  for (const [key, value] of Object.entries(body)) {
    if (!Object.hasOwn(schema, key)) {
      unknown.push(key);
      continue;
    }
    const validator = schema[key];
    if (typeof validator !== 'function') {
      throw new TypeError(`validateSettings: validator for "${key}" must be a function`);
    }
    const rejection = rejectionMessage(validator, value);
    if (rejection === null) {
      entries.push([key, value]);
    } else {
      invalid.push({ [key]: rejection });
    }
  }

  if (unknown.length > 0 || invalid.length > 0) return { ok: false, unknown, invalid };
  return { ok: true, entries };
}

/**
 * A real boolean, or the strings `'true'` / `'false'`.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isBooleanLike(value) {
  return typeof value === 'boolean' || value === 'true' || value === 'false';
}

/**
 * @param {unknown} min
 * @param {unknown} max
 */
function assertRange(min, max) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
    throw new RangeError('range bounds must be finite numbers with min <= max');
  }
}

/**
 * Validator factory: an integer (a number, not a numeric string) in [min, max].
 * @param {number} min
 * @param {number} max
 * @returns {(value: unknown) => boolean}
 */
export function isIntInRange(min, max) {
  assertRange(min, max);
  return (value) => Number.isSafeInteger(value) && value >= min && value <= max;
}

const TIME_HHMM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

/**
 * A 24-hour `HH:MM` string (`00:00` to `23:59`, zero-padded).
 * @param {unknown} value
 * @returns {boolean}
 */
export function isTimeHHMM(value) {
  return typeof value === 'string' && TIME_HHMM.test(value);
}

/**
 * Validator factory: an array of non-blank strings.
 * @param {{ minItems?: number, maxItems?: number, maxLength?: number }} [options]
 *   `minItems` defaults to 0 (empty allowed), `maxItems` to 100, `maxLength`
 *   (per string, untrimmed) to 256.
 * @returns {(value: unknown) => boolean}
 */
export function isStringArray({ minItems = 0, maxItems = 100, maxLength = 256 } = {}) {
  return (value) => {
    if (!Array.isArray(value) || value.length < minItems || value.length > maxItems) return false;
    // for...of (unlike every) visits holes of sparse arrays as `undefined`.
    for (const item of value) {
      if (typeof item !== 'string' || item.trim().length === 0 || item.length > maxLength) return false;
    }
    return true;
  };
}

const ACADEMIC_YEAR = /^(\d{4})-(\d{4})$/;

/**
 * An academic year `YYYY-YYYY` whose second year is the first plus one
 * (`2024-2025`).
 * @param {unknown} value
 * @returns {boolean}
 */
export function isAcademicYear(value) {
  if (typeof value !== 'string') return false;
  const match = ACADEMIC_YEAR.exec(value);
  return match !== null && Number(match[2]) === Number(match[1]) + 1;
}

/**
 * Validator factory: an amount in cents, a non-negative integer number
 * no greater than `max`.
 * @param {number} [max=Number.MAX_SAFE_INTEGER]
 * @returns {(value: unknown) => boolean}
 */
export function isMoneyCents(max = Number.MAX_SAFE_INTEGER) {
  assertRange(0, max);
  return (value) => Number.isSafeInteger(value) && value >= 0 && value <= max;
}
