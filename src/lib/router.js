/**
 * Minimal router for Cloudflare Workers
 * No dependencies - uses native Web APIs
 *
 * Shared module from astro-core - used by astro-ndi and astro-join
 */

// Maximum request body size (1MB default)
const MAX_BODY_SIZE = 1 * 1024 * 1024;

export class Router {
  constructor(basePath = '', options = {}) {
    this.routes = [];
    // Normalize base path (remove trailing slash)
    this.basePath = basePath.replace(/\/$/, '');
    this.maxBodySize = options.maxBodySize || MAX_BODY_SIZE;
  }

  /**
   * Add a route handler
   * @param {string} method - HTTP method (GET, POST, PUT, DELETE, ALL)
   * @param {string} path - URL path pattern with :params (e.g., '/users/:id')
   * @param {Function} handler - Route handler function(request, env, ctx, params)
   */
  add(method, path, handler) {
    if (typeof method !== 'string') {
      throw new TypeError('Router.add: "method" must be a string');
    }
    if (typeof path !== 'string') {
      throw new TypeError('Router.add: "path" must be a string');
    }
    if (typeof handler !== 'function') {
      throw new TypeError('Router.add: "handler" must be a function');
    }
    // Convert path pattern to regex via helper for clarity
    const pattern = this.pathToRegex(path);
    this.routes.push({
      method: method.toUpperCase(),
      pattern: new RegExp(`^${pattern}$`),
      handler
    });
    return this;
  }

  /**
   * Convert path pattern to regex
   * Handles :param syntax for URL parameters
   */
  pathToRegex(path) {
    // Escape backslashes first, then forward slashes, then convert :params
    return path
      .replaceAll('\\', '\\\\')
      .replaceAll('/', String.raw`\/`)
      .replaceAll(/:(\w+)/g, '(?<$1>[^/]+)');
  }

  get(path, handler) { return this.add('GET', path, handler); }
  post(path, handler) { return this.add('POST', path, handler); }
  put(path, handler) { return this.add('PUT', path, handler); }
  delete(path, handler) { return this.add('DELETE', path, handler); }
  all(path, handler) { return this.add('ALL', path, handler); }

  /**
   * Handle an incoming request
   * @param {Request} request - Incoming request
   * @param {object} env - Cloudflare Workers environment
   * @param {object} ctx - Execution context
   * @returns {Promise<Response>}
   */
  async handle(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const method = request.method.toUpperCase();
      let path = url.pathname;

      // Check request body size for POST/PUT requests
      if (method === 'POST' || method === 'PUT') {
        const contentLength = request.headers.get('Content-Length');
        if (contentLength && Number.parseInt(contentLength, 10) > this.maxBodySize) {
          return error(`Request body too large. Maximum size is ${Math.round(this.maxBodySize / 1024)}KB`, 413);
        }
      }

      // Strip base path if present
      if (this.basePath && path.startsWith(this.basePath)) {
        path = path.slice(this.basePath.length) || '/';
      }

      for (const route of this.routes) {
        if (route.method !== method && route.method !== 'ALL') continue;
        const match = path.match(route.pattern);
        if (match) {
          const params = match.groups || {};
          return await route.handler(request, env, ctx, params);
        }
      }
      return error('Not Found', 404); // No route matched
    } catch (error_) {
      console.error('Router error:', error_);
      return error('Internal Server Error', 500);
    }
  }
}

/**
 * JSON response helper
 * @param {any} data - Data to serialize as JSON
 * @param {number} status - HTTP status code (default: 200)
 * @param {object} headers - Additional headers to include
 */
export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  });
}

/**
 * Error response helper
 * @param {string} message - Error message
 * @param {number} status - HTTP status code (default: 400)
 */
export function error(message, status = 400) {
  return json({ error: message }, status);
}

/**
 * Success response helper
 * @param {string} message - Success message
 * @param {object} data - Additional data to include
 */
export function success(message, data = {}) {
  return json({ success: true, message, ...data });
}

/**
 * CORS headers for cross-origin requests
 * @param {string} origin - Origin to allow (must be explicitly specified for security)
 * @throws {Error} if origin is not provided
 */
export function corsHeaders(origin) {
  if (!origin) {
    throw new Error("corsHeaders: origin must be explicitly specified for security");
  }
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400'
  };
}

/**
 * Handle CORS preflight OPTIONS request
 * @param {string} origin - Origin to allow
 */
export function handleCors(origin) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(origin)
  });
}
