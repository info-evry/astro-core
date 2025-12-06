# Claude Code Guidelines for Astro Core

## Overview

Astro Core is a shared JavaScript utilities library for Cloudflare Workers, used by astro-ndi and astro-join.

## Project Structure

```
astro-core/
├── src/
│   └── lib/
│       └── router.js    # Main router implementation
├── test/
│   └── router.test.js   # Comprehensive tests
├── package.json
└── vitest.config.js
```

## Testing

```bash
# Run tests
bun test

# Watch mode
bun run test:watch
```

## Exports

The package exports via package.json exports field:

```javascript
// Import router and helpers
import { Router, json, error, success, corsHeaders, handleCors } from 'astro-core/router';
```

## Router Usage

```javascript
import { Router, json, error } from 'astro-core/router';

const router = new Router('/api');

router.get('/users', (request, env, ctx, params) => {
  return json({ users: [] });
});

router.get('/users/:id', (request, env, ctx, params) => {
  return json({ id: params.id });
});

// In your worker
export default {
  async fetch(request, env, ctx) {
    return router.handle(request, env, ctx);
  }
};
```

## Making Changes

1. Make changes to `src/lib/router.js`
2. Update tests in `test/router.test.js`
3. Run tests: `bun test`
4. Commit and push

## Integration with Other Projects

This module is used as a git submodule in:
- astro-ndi (as `core/`)
- astro-join (as `core/`)
- astro-maestro (as `projects/astro-core`)

When updating, remember to update the submodule references in consuming projects.
