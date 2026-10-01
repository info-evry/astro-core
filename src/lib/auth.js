/**
 * Admin bearer-token authentication.
 *
 * Web APIs only (Cloudflare Workers compatible).
 */

import { unauthorized } from './http.js';
import { pathPrefix } from './ratelimit.js';

const BEARER_PREFIX = 'Bearer ';

/**
 * The synchronous comparison always walks at least this many UTF-16 code
 * units, so secrets/tokens shorter than this do not leak their length through
 * timing. Admin tokens are far shorter.
 */
const MIN_COMPARE_LENGTH = 512;

/**
 * Constant-time string equality, synchronous (pure JS, no crypto.subtle).
 *
 * Compares UTF-16 code units (so lone surrogates are never conflated). The
 * loop always covers `max(a.length, b.length, 512)` positions and folds the
 * length difference into the result, so for inputs up to 512 code units the
 * running time does not depend on either length nor on where the strings
 * differ. Beyond that only the (attacker-chosen) longer length shows.
 * Non-string input is never equal.
 *
 * Prefer `timingSafeEqualAsync` when you can `await`: it hides length
 * completely by comparing fixed-size SHA-256 digests.
 *
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length, MIN_COMPARE_LENGTH);
  for (let i = 0; i < length; i++) {
    const ca = i < a.length ? a.charCodeAt(i) : 0;
    const cb = i < b.length ? b.charCodeAt(i) : 0;
    diff |= ca ^ cb;
  }
  return diff === 0;
}

/**
 * UTF-16 code units as little-endian bytes (lossless, unlike UTF-8 encoding
 * which maps every lone surrogate to U+FFFD).
 * @param {string} str
 * @returns {Uint8Array}
 */
function utf16Bytes(str) {
  const bytes = new Uint8Array(str.length * 2);
  for (let i = 0; i < str.length; i++) {
    const unit = str.charCodeAt(i);
    bytes[i * 2] = unit & 0xff;
    bytes[i * 2 + 1] = unit >> 8;
  }
  return bytes;
}

/**
 * Constant-time string equality via SHA-256 digests: both sides are hashed to
 * 32 bytes and the digests are XOR-compared, so neither length nor content
 * position leaks. Non-string input is never equal.
 * @param {unknown} a
 * @param {unknown} b
 * @returns {Promise<boolean>}
 */
export async function timingSafeEqualAsync(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const [digestA, digestB] = await Promise.all([
    crypto.subtle.digest('SHA-256', utf16Bytes(a)),
    crypto.subtle.digest('SHA-256', utf16Bytes(b))
  ]);
  const bytesA = new Uint8Array(digestA);
  const bytesB = new Uint8Array(digestB);
  let diff = 0;
  for (const [i, byte] of bytesA.entries()) diff |= byte ^ bytesB[i];
  return diff === 0;
}

/**
 * Extract the token from an `Authorization: Bearer <token>` header. The scheme
 * is matched case-sensitively; a missing header, another scheme or an empty
 * token yields `null`.
 * @param {Request} request
 * @returns {string|null}
 */
export function extractBearer(request) {
  const header = request.headers.get('Authorization');
  if (!header?.startsWith(BEARER_PREFIX)) return null;
  const token = header.slice(BEARER_PREFIX.length);
  return token || null;
}

/**
 * @typedef {object} AdminAuthOptions
 * @property {{ get: (key: string) => Promise<string|null> }} [kv] - KV namespace holding the token (default `env.CONFIG`)
 * @property {string} [kvKey] - KV key (default `'admin_token'`)
 */

/**
 * Verify the admin bearer token.
 *
 * - A non-empty value in KV overrides `env.ADMIN_TOKEN` (so the token can be
 *   rotated without a redeploy).
 * - A KV read failure fails CLOSED (returns false, never falls back to the
 *   possibly stale env token).
 * - No token configured anywhere returns false.
 * - The comparison is constant-time (`timingSafeEqualAsync`).
 *
 * @param {Request} request
 * @param {{ ADMIN_TOKEN?: string, CONFIG?: object }} env
 * @param {AdminAuthOptions} [options]
 * @returns {Promise<boolean>}
 */
export async function verifyAdminToken(request, env, { kv = env?.CONFIG, kvKey = 'admin_token' } = {}) {
  const token = extractBearer(request);
  if (!token) return false;

  let expected = env?.ADMIN_TOKEN;
  if (kv) {
    try {
      const stored = await kv.get(kvKey);
      if (typeof stored === 'string' && stored) expected = stored;
    } catch (error_) {
      console.error('verifyAdminToken: failed to read the admin token from KV', error_);
      return false;
    }
  }
  if (typeof expected !== 'string' || !expected) return false;

  return timingSafeEqualAsync(token, expected);
}

/**
 * Wrap a Router handler so it only runs for an authenticated admin;
 * otherwise answers `unauthorized()` (401).
 * @template {(request: Request, env: any, ctx: any, params: any) => any} H
 * @param {H} handler
 * @param {AdminAuthOptions} [options]
 * @returns {(request: Request, env: any, ctx: any, params: any) => Promise<Response>}
 */
export function adminOnly(handler, options) {
  return async (request, env, ctx, params) => {
    if (!(await verifyAdminToken(request, env, options))) return unauthorized();
    return handler(request, env, ctx, params);
  };
}

/**
 * Router middleware (`router.use(...)`) rejecting with `unauthorized()` every
 * request at or under `prefix` that lacks a valid admin token. Opt-in: it is
 * not installed by default, and per-handler `adminOnly` checks keep working
 * next to it.
 *
 * The prefix is matched on a path-segment boundary against the path the router
 * passes to middlewares, i.e. AFTER the router base path has been stripped.
 * Trailing slashes in `prefix` are ignored, so the default guards both
 * `/api/admin` and `/api/admin/...` (but not `/api/administrator`).
 *
 * @param {string} [prefix='/api/admin/']
 * @param {AdminAuthOptions} [options]
 * @returns {(request: Request, env: any, ctx: any, path: string) => Promise<Response|undefined>}
 */
export function createAdminGuard(prefix = '/api/admin/', options) {
  let end = prefix.length;
  while (end > 0 && prefix[end - 1] === '/') end--;
  const matches = pathPrefix(prefix.slice(0, end));
  return async (request, env, ctx, path) => {
    if (!matches(path)) return;
    if (await verifyAdminToken(request, env, options)) return;
    return unauthorized();
  };
}
