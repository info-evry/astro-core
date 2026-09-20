# Astro Core

Shared JavaScript utilities for the Info Evry Astro ecosystem.

## Features

- **Router** - Lightweight request router for Cloudflare Workers with type checking and error handling
- **Response Helpers** - Standardized JSON responses, CORS handling, and error formatting

## Installation

This package is included as a git submodule in astro-ndi and astro-join projects.

```bash
# From parent project
git submodule add https://github.com/info-evry/astro-core.git core
```

## Usage

### Router

```javascript
import { Router, json, error } from './core/src/lib/router.js';

const router = new Router();

// Add routes with type-safe parameters
router.get('/api/items', async ({ request, env }) => {
  const items = await env.DB.prepare('SELECT * FROM items').all();
  return json(items.results);
});

router.get('/api/items/:id', async ({ request, env, params }) => {
  const { id } = params;
  const item = await env.DB.prepare('SELECT * FROM items WHERE id = ?')
    .bind(id)
    .first();

  if (!item) {
    return error('Item not found', 404);
  }
  return json(item);
});

router.post('/api/items', async ({ request, env }) => {
  const body = await request.json();
  // ... create item
  return json({ id: newId }, 201);
});

// Handle requests
export async function handleRequest(request, env) {
  return router.handle(request, env);
}
```

### Response Helpers

```javascript
import { json, error, success, corsHeaders, handleCors } from './core/src/lib/router.js';

// JSON response with custom status
json({ data: 'value' }, 201);

// Error response
error('Something went wrong', 500);

// Success message
success('Operation completed');

// CORS headers for allowed origin
corsHeaders('https://example.com');

// Handle preflight requests
handleCors(request, 'https://example.com');
```

### Router Middleware

Register middleware with `router.use(fn)`. Middlewares run in registration
order, after the base path has been stripped from the request path, and
before route matching. A middleware can short-circuit the request by
returning a `Response`; returning `undefined`/`null` passes control to the
next middleware (or the matched route).

```javascript
import { Router, json } from './core/src/lib/router.js';

const router = new Router();

router.use(async (request, env, ctx, path) => {
  console.log(`${request.method} ${path}`);
  // return a Response here to short-circuit the request
});

router.get('/api/items', () => json({ items: [] }));
```

### Rate Limiting

`astro-core/ratelimit` provides a fixed-window rate limiter backed by a
Cloudflare KV namespace, wired in as router middleware.

```javascript
import { Router } from './core/src/lib/router.js';
import { createRateLimiter, pathPrefix } from './core/src/lib/ratelimit.js';

const router = new Router();

router.use(createRateLimiter({
  binding: 'RATE_LIMIT', // env.RATE_LIMIT KV namespace
  rules: [
    { name: 'login', methods: ['POST'], match: pathPrefix('/api/login'), limit: 5, windowSec: 60 },
    { name: 'api', match: pathPrefix('/api'), limit: 100, windowSec: 60 }
  ]
}));
```

Only the first matching rule (checked in order, with an optional `methods`
filter) applies. Exceeding the limit returns a `429` JSON response with
`Retry-After`, `X-RateLimit-Limit`, and `X-RateLimit-Remaining` headers. If
the KV binding is missing or KV access fails, requests are allowed through
and a warning is logged.

### Router Features

- **Type Checking**: Validates route patterns and parameter types
- **Error Handling**: Automatic try-catch wrapper with 500 error responses
- **Method Matching**: Supports GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD
- **URL Parameters**: Extract named parameters from route patterns (`:id`, `:slug`)
- **Query Parameters**: Access URL search params via `request.url`

## API Reference

### Router Class

| Method | Description |
|--------|-------------|
| `get(pattern, handler)` | Register GET route |
| `post(pattern, handler)` | Register POST route |
| `put(pattern, handler)` | Register PUT route |
| `delete(pattern, handler)` | Register DELETE route |
| `patch(pattern, handler)` | Register PATCH route |
| `options(pattern, handler)` | Register OPTIONS route |
| `head(pattern, handler)` | Register HEAD route |
| `all(pattern, handler)` | Register route for all methods |
| `use(fn)` | Register a middleware run before route matching |
| `handle(request, env)` | Route request to matching handler |

### Handler Context

Handlers receive a context object with:

```javascript
{
  request,  // Original Request object
  env,      // Cloudflare Worker environment bindings
  params    // Extracted URL parameters
}
```

### Response Helpers

| Function | Description |
|----------|-------------|
| `json(data, status?)` | JSON response (default 200) |
| `error(message, status?)` | Error JSON response (default 500) |
| `success(message, status?)` | Success JSON response (default 200) |
| `corsHeaders(origin)` | Generate CORS headers object |
| `handleCors(request, origin)` | Handle OPTIONS preflight |

## Testing

```bash
bun test
```

## License

AGPL-3.0-only
