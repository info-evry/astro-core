/**
 * Fixed-window rate limiting middleware backed by a Cloudflare KV namespace.
 *
 * Shared module from astro-core - used by astro-ndi and astro-join
 */

import { json } from './router.js';

/**
 * @typedef {object} RateLimitRule
 * @property {string} name - Unique rule name, used as part of the KV key
 * @property {string[]} [methods] - HTTP methods this rule applies to (any method if omitted)
 * @property {(path: string) => boolean} match - Predicate matching the (base-path-stripped) request path
 * @property {number} limit - Maximum number of requests allowed per window
 * @property {number} windowSec - Window size in seconds
 */

// Warn only once per isolate when the KV binding is missing.
let warnedMissingBinding = false;

/**
 * Extract the client IP from a request.
 * Prefers Cloudflare's CF-Connecting-IP header, then falls back to the
 * first entry of X-Forwarded-For, then 'unknown'.
 * @param {Request} request
 * @returns {string}
 */
export function getClientIp(request) {
  const cfIp = request.headers.get('CF-Connecting-IP');
  if (cfIp) return cfIp;
  const forwardedFor = request.headers.get('X-Forwarded-For');
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0].trim();
    if (first) return first;
  }
  return 'unknown';
}

/**
 * Check and increment a fixed-window rate limit counter stored in KV.
 * @param {{ get: Function, put: Function }} kv - KV namespace binding
 * @param {string} key - Base key (window suffix is appended internally by caller)
 * @param {number} limit - Maximum allowed count within the window
 * @param {number} windowSec - Window size in seconds
 * @param {number} now - Current time in ms (default: Date.now())
 * @returns {Promise<{ allowed: boolean, remaining: number, resetAt: number, count: number }>}
 */
export async function checkRateLimit(kv, key, limit, windowSec, now = Date.now()) {
  const windowIndex = Math.floor(now / 1000 / windowSec);
  const windowStartSec = windowIndex * windowSec;
  const resetAt = (windowStartSec + windowSec) * 1000;
  const windowKey = `${key}:${windowIndex}`;

  const raw = await kv.get(windowKey);
  const currentCount = raw ? Number.parseInt(raw, 10) || 0 : 0;

  if (currentCount >= limit) {
    return { allowed: false, remaining: 0, resetAt, count: currentCount };
  }

  const newCount = currentCount + 1;
  const ttl = Math.max(60, windowSec * 2);
  await kv.put(windowKey, String(newCount), { expirationTtl: ttl });

  return {
    allowed: true,
    remaining: Math.max(0, limit - newCount),
    resetAt,
    count: newCount
  };
}

/**
 * Path matcher helper: matches any path starting with the given prefix.
 * @param {string} prefix
 * @returns {(path: string) => boolean}
 */
export function pathPrefix(prefix) {
  return (path) => path.startsWith(prefix);
}

/**
 * Path matcher helper: matches any path against a regular expression.
 * @param {RegExp} regex
 * @returns {(path: string) => boolean}
 */
export function pathPattern(regex) {
  return (path) => regex.test(path);
}

/**
 * Create a Router-compatible middleware enforcing rate limit rules.
 * Only the first rule whose `match` (and optional `methods`) matches is
 * applied. If the configured KV binding is missing from `env`, or if the
 * KV read/write throws, the request is allowed through and a warning is
 * logged.
 * @param {object} options
 * @param {string} [options.binding] - Name of the KV binding on `env` (default: 'RATE_LIMIT')
 * @param {RateLimitRule[]} options.rules - Rate limit rules, evaluated in order
 * @param {string} [options.prefix] - Key prefix for KV entries (default: 'rl')
 * @returns {(request: Request, env: object, ctx: object, path: string) => Promise<Response|void>}
 */
export function createRateLimiter({ binding = 'RATE_LIMIT', rules, prefix = 'rl' }) {
  return async function rateLimitMiddleware(request, env, ctx, path) {
    const method = request.method.toUpperCase();
    const rule = rules.find((r) => {
      if (r.methods && !r.methods.includes(method)) return false;
      return r.match(path);
    });
    if (!rule) return;

    const kv = env && env[binding];
    if (!kv) {
      if (!warnedMissingBinding) {
        warnedMissingBinding = true;
        console.warn(`createRateLimiter: KV binding "${binding}" is missing on env; allowing requests`);
      }
      return;
    }

    const ip = getClientIp(request);
    const key = `${prefix}:${rule.name}:${ip}`;

    let result;
    try {
      result = await checkRateLimit(kv, key, rule.limit, rule.windowSec, Date.now());
    } catch (error) {
      console.warn('createRateLimiter: KV error, allowing request', error);
      return;
    }

    if (!result.allowed) {
      const retryAfter = Math.max(0, Math.ceil((result.resetAt - Date.now()) / 1000));
      return json(
        { error: 'Too many requests' },
        429,
        {
          'Retry-After': String(retryAfter),
          'X-RateLimit-Limit': String(rule.limit),
          'X-RateLimit-Remaining': String(result.remaining)
        }
      );
    }
  };
}
