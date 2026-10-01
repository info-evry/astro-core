# Astro Core

Shared JavaScript utilities for the Info Evry Astro ecosystem.

## Features

- **Router** - Lightweight request router for Cloudflare Workers with type checking and error handling
- **Response Helpers** - Standardized JSON responses, CORS handling, and error formatting
- **Server layer** - `http`, `request`, `ids`, `d1`, `auth`, `csv`, `settings`, `api-route`: the code the
  sites used to copy between each other (see [Shared server layer](#shared-server-layer))

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

## Shared server layer

Plain ESM + JSDoc, Web APIs only (no `node:*`, no DOM), usable on Cloudflare Workers. Every module is
exported through `package.json`: `astro-core/{router,ratelimit,validation,formatting,http,request,ids,d1,auth,csv,settings,api-route}`.

### Error contract

Every error body is `{ error: string, code: string }`. `error` is a human message (French by default,
overridable per call), `code` is the stable identifier clients should switch on. 500 responses never
contain `error.message`; the cause is logged with `console.error`.

| Helper (`astro-core/http`) | Status | `code` | Default message |
|---|---|---|---|
| `badRequest(message?, code = 'bad_request')` | 400 | `bad_request` | Requête invalide |
| `invalidBody(message?)` | 400 | `invalid_body` | Corps de requête invalide |
| `invalidId(message?)` | 400 | `invalid_id` | Identifiant invalide |
| `unauthorized(message?)` | 401 | `unauthorized` | Non autorisé |
| `forbidden(message?)` | 403 | `forbidden` | Accès interdit |
| `notFound(message?)` | 404 | `not_found` | Ressource introuvable |
| `conflict(message?)` | 409 | `conflict` | Cette ressource existe déjà |
| `tooLarge(message?)` | 413 | `payload_too_large` | Requête trop volumineuse |
| `tooManyRequests(message?)` | 429 | `too_many_requests` | Trop de requêtes... |
| `serverError(label, err, message?)` | 500 | `internal_error` | Erreur interne |
| `okJson(data)` | 200 | | |

`serverError` calls `console.error(label, err)` and answers the generic body; the optional `message`
must be static text, never derived from `err`. `Router.handle` produces the same bodies for its own
404 / 413 / 500. The rate limiter's 429 body also carries `code: 'too_many_requests'` (its message is still
English, see `ratelimit.js`).

```javascript
import { readJsonOrRespond, isUniqueConstraintError } from 'astro-core/request';
import { parsePositiveId } from 'astro-core/ids';
import { invalidId, conflict, serverError, okJson } from 'astro-core/http';

router.put('/api/admin/members/:id', adminOnly(async (request, env, ctx, params) => {
  const id = parsePositiveId(params.id);
  if (id === null) return invalidId();
  const { data, response } = await readJsonOrRespond(request);
  if (response) return response; // 400 invalid_body or 413 payload_too_large
  try {
    await env.DB.prepare('UPDATE members SET email = ? WHERE id = ?').bind(data.email, id).run();
    return okJson({ ok: true });
  } catch (err) {
    if (isUniqueConstraintError(err)) return conflict('Cet email est déjà utilisé');
    return serverError('Update member error:', err);
  }
}));
```

### `astro-core/request`

| Function | Description |
|---|---|
| `readJsonObject(request, { maxBytes = 1_048_576 })` | Plain object, or `null` for an empty/malformed body, a non-object (`null`, array, primitive) or a body over `maxBytes`. The size is counted on the bytes actually read (streamed, aborted early), a missing or lying `Content-Length` does not bypass it. Throws `TypeError` for an invalid `maxBytes`. |
| `readJsonOrRespond(request, opts)` | `{ data, response: null }` or `{ data: null, response }` where `response` is `invalidBody()` (400) or `tooLarge()` (413). |
| `isUniqueConstraintError(err)` / `isForeignKeyError(err)` | Classify D1/SQLite errors (also looks through `err.cause`). Map them to `conflict()` / a 409 or 400. |

### `astro-core/ids`

| Function | Description |
|---|---|
| `parsePositiveId(value)` | Positive safe integer or `null`. Accepts numbers and ASCII-digit strings (`'42'`, `'007'`); rejects `'12abc'`, `'3.5'`, `'0'`, `'-1'`, `''`, `null`, `NaN`, `1e21`, arrays, objects. Path params that fail map to `invalidId()`. |
| `parseIdList(value, { max = 1000 })` | `{ ids }` (de-duplicated, order preserved) or `{ error: 'not_array' \| 'empty' \| 'too_many' \| 'invalid_id' }`. `max` applies to the raw length. |

### `astro-core/d1`

`D1_MAX_VARIABLES = 100`, `SAFE_IDS_PER_STATEMENT = 90`, `chunk(array, size)`, `inClause(count)` (`'?,?,?'`) and:

```javascript
import { runByIds } from 'astro-core/d1';

const changed = await runByIds(
  env.DB, ids,
  (placeholders) => `UPDATE members SET status = ? WHERE id IN (${placeholders})`,
  { leadingParams: ['active'] }          // bound before the ids; size defaults to 90
);
```

One prepared statement per chunk, all run in ONE atomic `db.batch`; returns the total `meta.changes`
(0 without touching D1 for an empty list). Throws `RangeError` if `leadingParams.length + size > 100`.

### `astro-core/auth`

| Function | Description |
|---|---|
| `timingSafeEqual(a, b)` | Synchronous, pure JS. Walks `max(len a, len b, 512)` UTF-16 code units, so inputs up to 512 do not leak length or the first differing position. Non-strings are never equal. |
| `timingSafeEqualAsync(a, b)` | Compares SHA-256 digests (`crypto.subtle`): no length leak at all. Used by `verifyAdminToken`. |
| `extractBearer(request)` | Token of `Authorization: Bearer <token>` (scheme case-sensitive), else `null`. |
| `verifyAdminToken(request, env, { kv = env.CONFIG, kvKey = 'admin_token' })` | A non-empty KV value overrides `env.ADMIN_TOKEN`; a KV read failure fails closed (`false`); no configured token is `false`. Pass `kv: null` to ignore KV. |
| `adminOnly(handler, options?)` | Router-handler wrapper: `unauthorized()` (401) unless the token verifies. |
| `createAdminGuard(prefix = '/api/admin/', options?)` | Opt-in `router.use()` middleware answering 401 for any request at/under the prefix without a valid token. Matches on a path-segment boundary against the path the router hands to middlewares (after the router base path is stripped); trailing slashes of `prefix` are ignored, so `/api/admin` itself is guarded. Per-handler `adminOnly` keeps working next to it. |

### `astro-core/csv`

| Function | Description |
|---|---|
| `escapeCsvCell(value, { delimiter = ',', quoteAll = false })` | RFC 4180 quoting plus formula-injection neutralisation (see below). `null`/`undefined` become empty, `Date` becomes ISO. |
| `unescapeCsvCell(value)` | Exact inverse of the guard, for re-importing our own exports. |
| `generateCsv(rows, { columns, delimiter = ',', bom = false, quoteAll = false, eol = '\r\n' })` | `rows` are arrays or objects. `columns` is `string \| { header, key?, value?(row) }[]`; without it, object rows get a header from the first row's keys and array rows are written as-is. No trailing line break. |
| `parseCsv(text)` | `{ headers, rows, delimiter }`: BOM, LF/CRLF/CR, quoted multi-line cells, `""` escapes, `,` `;` TAB auto-detected from the header line (the header line decides: a header containing as many `,` as `;` falls back to `,`), blank rows ignored. Cells are trimmed, quoted ones included. |
| `mapCsvHeaders(headers, aliases)` | `{ field: columnIndex }` from an alias table (`{ firstName: ['prénom', 'firstname'] }`), case/space-insensitive. |
| `csvResponse(content, filename, headers?)` | `text/csv; charset=utf-8` attachment. The filename is sanitised (CR/LF, control and bidi characters, quotes, `/`, `\`, `;`, leading dots removed); non-ASCII names get an ASCII fallback plus RFC 5987 `filename*`. |

Formula injection: a cell starting with `= + - @ TAB CR |` is prefixed with `'`. Plain numbers (`-5`)
and phone numbers (`+33612345678`, `06 12 34 56 78`, `(01) 23.45`: digits, spaces, `( ) . -`, optional
leading `+`, at least one digit) are NOT prefixed: they cannot form a formula and the prefix would corrupt
the data. TAB and CR are deliberately not treated as phone whitespace. Because `+33...` is unprefixed,
`unescapeCsvCell` strips one leading `'` only from a run of `'` followed by a dangerous character;
`escapeCsvCell` doubles such a run in user data, so `unescapeCsvCell(escapeCsvCell(s)) === s` for every string.

### `astro-core/settings`

```javascript
import { validateSettings, isBooleanLike, isAcademicYear, isStringArray } from 'astro-core/settings';

const SCHEMA = {
  membership_open: isBooleanLike,
  current_year: isAcademicYear,
  enrollment_tracks: isStringArray({ minItems: 1, maxItems: 20, maxLength: 60 }),
  motto: (v) => (typeof v === 'string' && v.length <= 80) || 'Devise trop longue'
};

const result = validateSettings(body, SCHEMA);
if (!result.ok) {
  // result.unknown: string[]; result.invalid: [{ motto: 'Devise trop longue' }, ...]
  return badRequest('Paramètres invalides', 'invalid_settings');
}
for (const [key, value] of result.entries) { /* persist */ }
```

A validator returns `true` (accept), a string (reject with that message) or `false` (reject, message
`Valeur invalide`); a throwing validator counts as a rejection. Keys are checked with `Object.hasOwn` on both
sides, so `__proto__`, `constructor`, `toString`... are reported as unknown. `body` must be a plain object
(use `readJsonObject` first): anything else throws `TypeError`.

Validators (all return booleans): `isBooleanLike` (boolean, `'true'`, `'false'`), `isIntInRange(min, max)`,
`isTimeHHMM` (`00:00`-`23:59`), `isStringArray({ minItems = 0, maxItems = 100, maxLength = 256 })` (non-blank
strings), `isAcademicYear` (`YYYY-YYYY`, second = first + 1), `isMoneyCents(max)` (non-negative safe integer).

### `astro-core/api-route`

```ts
// src/pages/api/[...slug].ts
import { env } from 'cloudflare:workers';
import { createApiRoute } from 'astro-core/api-route';
import { createRouter } from '../../routes.js';

export const { ALL, GET, POST, PUT, DELETE, OPTIONS } = createApiRoute({
  router: createRouter(),
  allowedOrigins: ['https://asso.info-evry.fr', 'http://localhost:4321'], // first = fallback
  getEnv: () => env,                                  // default: locals.runtime?.env
  getCtx: (locals) => locals.cfContext                // default: locals.cfContext
});
```

CORS origin: the request `Origin` if allowlisted; the request's own origin when there is no `Origin` header;
otherwise the first allowed origin (an unknown origin is never reflected). `OPTIONS` answers a 204 preflight.
CORS headers (plus `Vary: Origin`) are added to EVERY response, including the router's own 404/413/500. The
handlers never throw: any failure (router, `getEnv`, `getCtx`, a non-`Response` result) becomes a generic
`serverError` 500 with CORS headers. `ALL`, `GET`, `POST`, `PUT`, `DELETE` and `OPTIONS` are one function.

### `astro-core/ratelimit` additions

`ADMIN_RATE_LIMIT` (`{ name: 'admin', match: pathPrefix('/api/admin/'), limit: 60, windowSec: 60 }`) is the
standard admin rule. `pathPrefix` now matches on a path-segment boundary: `pathPrefix('/api/register')` matches
`/api/register` and `/api/register/x` but not `/api/registerX`; a prefix ending in `/` matches only below it.

### `astro-core/validation` and `astro-core/formatting` additions

`LIMITS` (`name 100`, `email 254`, `phone 30`, `handle 64`, `studentId 32`, `teamName 128`, `description 256`,
`teamPassword 64`, `text 1000`) and `isTooLong(value, max)` (true only for strings longer than `max`).
`escapeHtml` escapes `& < > " '` (apostrophe as `&#39;`) and `formatCurrency` returns `'0,00 €'` for NaN,
infinite and non-numeric input. These are the canonical implementations: astro-design and the sites
re-export them instead of keeping copies.

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
| `error(message, status?, code?)` | Error JSON response (default 400); body is `{ error, code }` when `code` is given |
| `success(message, data?)` | `{ success: true, message, ...data }` (200) |
| `csv(content, filename, headers?)` | CSV download, delegates to `csvResponse` (filename sanitised) |
| `corsHeaders(origin)` | Generate CORS headers object |
| `handleCors(request, origin)` | Handle OPTIONS preflight |

## Testing

```bash
bun test
```

## License

AGPL-3.0-only
