/**
 * Standard HTTP error/success responses.
 *
 * Every error body is `{ error: string, code: string }`:
 * - `error` is a human-readable message, French by default (override it with
 *   the optional `message` argument);
 * - `code` is the stable machine-readable identifier clients should switch on.
 *
 * | helper              | status | code               |
 * |---------------------|--------|--------------------|
 * | badRequest          | 400    | bad_request (or custom) |
 * | invalidBody         | 400    | invalid_body       |
 * | invalidId           | 400    | invalid_id         |
 * | unauthorized        | 401    | unauthorized       |
 * | forbidden           | 403    | forbidden          |
 * | notFound            | 404    | not_found          |
 * | conflict            | 409    | conflict           |
 * | tooLarge            | 413    | payload_too_large  |
 * | tooManyRequests     | 429    | too_many_requests  |
 * | serverError         | 500    | internal_error     |
 */

import { json, error } from './router.js';
import { ERRORS } from './errors.js';

/**
 * @param {import('./errors.js').ErrorCode} code
 * @param {string} [message]
 * @returns {Response}
 */
function fail(code, message) {
  return error(typeof message === 'string' && message ? message : ERRORS[code].message, ERRORS[code].status, code);
}

/**
 * 400 response.
 * @param {string} [message] - Overrides the default message
 * @param {string} [code='bad_request'] - Machine-readable code
 * @returns {Response}
 */
export function badRequest(message, code = 'bad_request') {
  return error(typeof message === 'string' && message ? message : ERRORS.bad_request.message, 400, code);
}

/**
 * 400 `invalid_body`: the JSON body is missing, malformed or not an object.
 * @param {string} [message]
 * @returns {Response}
 */
export function invalidBody(message) {
  return fail('invalid_body', message);
}

/**
 * 400 `invalid_id`: an id in the path or body is not a positive integer.
 * @param {string} [message]
 * @returns {Response}
 */
export function invalidId(message) {
  return fail('invalid_id', message);
}

/**
 * 401 `unauthorized`.
 * @param {string} [message]
 * @returns {Response}
 */
export function unauthorized(message) {
  return fail('unauthorized', message);
}

/**
 * 403 `forbidden`.
 * @param {string} [message]
 * @returns {Response}
 */
export function forbidden(message) {
  return fail('forbidden', message);
}

/**
 * 404 `not_found`.
 * @param {string} [message]
 * @returns {Response}
 */
export function notFound(message) {
  return fail('not_found', message);
}

/**
 * 409 `conflict`: the record already exists.
 * @param {string} [message]
 * @returns {Response}
 */
export function conflict(message) {
  return fail('conflict', message);
}

/**
 * 413 `payload_too_large`.
 * @param {string} [message]
 * @returns {Response}
 */
export function tooLarge(message) {
  return fail('payload_too_large', message);
}

/**
 * 429 `too_many_requests`.
 * @param {string} [message]
 * @returns {Response}
 */
export function tooManyRequests(message) {
  return fail('too_many_requests', message);
}

/**
 * Log an unexpected error and answer 500 WITHOUT leaking `err.message` (or
 * anything else about the error) to the client.
 * @param {string} label - Log label, e.g. 'Batch update error:'
 * @param {unknown} err - The caught error (logged only)
 * @param {string} [message] - Static replacement for the generic message. Never
 *   pass anything derived from `err` here.
 * @returns {Response}
 */
export function serverError(label, err, message) {
  console.error(label, err);
  return fail('internal_error', message);
}

/**
 * 200 JSON response.
 * @param {unknown} data
 * @returns {Response}
 */
export function okJson(data) {
  return json(data, 200);
}
