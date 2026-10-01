/**
 * Astro catch-all API route factory: CORS + router dispatch + safe errors.
 *
 * ```ts
 * // src/pages/api/[...slug].ts
 * import { env } from 'cloudflare:workers';
 * import { createApiRoute } from 'astro-core/api-route';
 * export const { ALL, GET, POST, PUT, DELETE, OPTIONS } = createApiRoute({
 *   router: createRouter(),
 *   allowedOrigins: ['https://asso.info-evry.fr', 'http://localhost:4321'],
 *   getEnv: () => env,
 *   getCtx: (locals) => locals.cfContext
 * });
 * ```
 */

import { corsHeaders, handleCors } from './router.js';
import { notFound, serverError } from './http.js';

/**
 * @typedef {object} ApiRouteOptions
 * @property {{ handle: (request: Request, env: any, ctx: any) => Promise<Response> }} router
 * @property {string[]} allowedOrigins - CORS allowlist (non-empty; the first entry is the fallback)
 * @property {(locals: any) => any} [getEnv] - default `locals.runtime?.env`
 * @property {(locals: any) => any} [getCtx] - default `locals.cfContext`
 */

/**
 * Pick the CORS origin: the request's Origin if allowlisted; the request's own
 * origin when there is no Origin header (same-origin); otherwise the first
 * allowed origin, so an arbitrary origin is never reflected.
 * @param {Request} request
 * @param {string[]} allowedOrigins
 * @returns {string}
 */
function getCorsOrigin(request, allowedOrigins) {
  const origin = request.headers.get('Origin');
  if (origin && allowedOrigins.includes(origin)) return origin;
  if (!origin) return new URL(request.url).origin;
  return allowedOrigins[0];
}

/**
 * Copy a response with CORS headers added (the original may have immutable headers).
 * @param {Response} response
 * @param {string} origin
 * @returns {Response}
 */
function withCors(response, origin) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(corsHeaders(origin))) headers.set(name, value);
  headers.append('Vary', 'Origin');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

/**
 * Create the Astro `APIRoute` handlers for a catch-all API route.
 *
 * - OPTIONS answers the CORS preflight (204) without reaching the router;
 * - every other request goes to `router.handle(request, getEnv(locals), getCtx(locals))`;
 * - CORS headers are added to EVERY response, including the router's own
 *   404/413/500 and the 500 produced here;
 * - the handlers never throw: any failure becomes a CORS-enabled `serverError`
 *   (500, generic message; details only go to `console.error`).
 *
 * `ALL`, `GET`, `POST`, `PUT`, `DELETE` and `OPTIONS` are the same function.
 *
 * @param {ApiRouteOptions} options
 * @returns {{ ALL: Function, GET: Function, POST: Function, PUT: Function, DELETE: Function, OPTIONS: Function }}
 */
export function createApiRoute({
  router,
  allowedOrigins,
  getEnv = (locals) => locals?.runtime?.env,
  getCtx = (locals) => locals?.cfContext
}) {
  if (typeof router?.handle !== 'function') {
    throw new TypeError('createApiRoute: "router" must have a handle() method');
  }
  if (!Array.isArray(allowedOrigins) || allowedOrigins.length === 0) {
    throw new TypeError('createApiRoute: "allowedOrigins" must be a non-empty array');
  }

  /**
   * @param {{ request: Request, locals?: any }} context
   * @returns {Promise<Response>}
   */
  async function handler({ request, locals }) {
    let origin = allowedOrigins[0];
    try {
      origin = getCorsOrigin(request, allowedOrigins);
      if (request.method === 'OPTIONS') return handleCors(origin);
      const response = await router.handle(request, getEnv(locals), getCtx(locals));
      if (!response) return withCors(notFound(), origin);
      if (!(response instanceof Response)) throw new TypeError('router.handle() did not return a Response');
      return withCors(response, origin);
    } catch (error_) {
      return withCors(serverError('API error:', error_), origin);
    }
  }

  return { ALL: handler, GET: handler, POST: handler, PUT: handler, DELETE: handler, OPTIONS: handler };
}
