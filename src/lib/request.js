/**
 * Request body parsing and database error classification.
 */

import { invalidBody, tooLarge } from './http.js';

/** Default maximum body size: 1 MiB. */
const DEFAULT_MAX_BYTES = 1_048_576;

/**
 * Read the body as bytes, refusing to buffer more than `maxBytes`.
 * The limit is enforced on the bytes actually received, so a missing or lying
 * Content-Length cannot bypass it.
 * @param {Request} request
 * @param {number} maxBytes
 * @returns {Promise<Uint8Array|null>} the bytes, or null when over the limit
 */
async function readBodyBytes(request, maxBytes) {
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!request.body) return new Uint8Array(0);

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * @param {Request} request
 * @param {number} maxBytes
 * @returns {Promise<{ data: Record<string, unknown>|null, tooLarge: boolean }>}
 */
async function parseBody(request, maxBytes) {
  if (!Number.isFinite(maxBytes) || maxBytes < 0) {
    throw new TypeError('maxBytes must be a non-negative finite number');
  }
  try {
    const bytes = await readBodyBytes(request, maxBytes);
    if (bytes === null) return { data: null, tooLarge: true };
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { data: null, tooLarge: false };
    }
    return { data: parsed, tooLarge: false };
  } catch {
    // Empty body, malformed JSON, or a body stream that was already consumed.
    return { data: null, tooLarge: false };
  }
}

/**
 * Parse the request body as a JSON object.
 *
 * Resolves to `null` for an empty body, malformed JSON, JSON that is not a
 * plain object (`null`, arrays, strings, numbers, booleans) or a body larger
 * than `maxBytes` (counted on the bytes actually read). A `__proto__` key in
 * the JSON becomes an ordinary own property, it never touches the prototype.
 *
 * @param {Request} request
 * @param {{ maxBytes?: number }} [options] - `maxBytes` defaults to 1 MiB
 * @returns {Promise<Record<string, unknown>|null>}
 */
export async function readJsonObject(request, { maxBytes = DEFAULT_MAX_BYTES } = {}) {
  return (await parseBody(request, maxBytes)).data;
}

/**
 * Like `readJsonObject`, but pre-builds the error response: `invalidBody()`
 * (400) for a bad body, `tooLarge()` (413) for an oversize one.
 *
 * @param {Request} request
 * @param {{ maxBytes?: number }} [options]
 * @returns {Promise<{ data: Record<string, unknown>, response: null } | { data: null, response: Response }>}
 */
export async function readJsonOrRespond(request, { maxBytes = DEFAULT_MAX_BYTES } = {}) {
  const result = await parseBody(request, maxBytes);
  if (result.data) return { data: result.data, response: null };
  return { data: null, response: result.tooLarge ? tooLarge() : invalidBody() };
}

/**
 * Collect the messages of an error and of its `cause` chain (D1 wraps the
 * SQLite error in a `D1_ERROR`), bounded to avoid cycles.
 * @param {unknown} err
 * @returns {string}
 */
function errorText(err) {
  const parts = [];
  let current = err;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth++) {
    if (typeof current.message === 'string') parts.push(current.message);
    current = current.cause;
  }
  return parts.join(' | ');
}

/**
 * True if a database error is a UNIQUE (or PRIMARY KEY) constraint violation.
 * @param {unknown} err
 * @returns {boolean}
 */
export function isUniqueConstraintError(err) {
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT_(?:UNIQUE|PRIMARYKEY)/i.test(errorText(err));
}

/**
 * True if a database error is a FOREIGN KEY constraint violation.
 * @param {unknown} err
 * @returns {boolean}
 */
export function isForeignKeyError(err) {
  return /FOREIGN KEY constraint failed|SQLITE_CONSTRAINT_FOREIGNKEY/i.test(errorText(err));
}
