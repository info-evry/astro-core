/* eslint-disable sonarjs/no-hardcoded-ip -- fake IPs are test fixtures, not real hosts */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getClientIp,
  checkRateLimit,
  createRateLimiter,
  pathPrefix,
  pathPattern
} from '../src/lib/ratelimit.js';
import { Router, json } from '../src/lib/router.js';

/** Minimal in-memory fake KV namespace for testing */
function createFakeKv() {
  const store = new Map();
  return {
    store,
    puts: [],
    async get(key) {
      const entry = store.get(key);
      return entry ? entry.value : null;
    },
    async put(key, value, options = {}) {
      this.puts.push({ key, value, ttl: options.expirationTtl });
      store.set(key, { value, ttl: options.expirationTtl });
    }
  };
}

describe('getClientIp', () => {
  it('prefers CF-Connecting-IP', () => {
    const request = new Request('http://localhost/', {
      headers: {
        'CF-Connecting-IP': '1.1.1.1',
        'X-Forwarded-For': '2.2.2.2, 3.3.3.3'
      }
    });
    expect(getClientIp(request)).toBe('1.1.1.1');
  });

  it('falls back to first X-Forwarded-For entry', () => {
    const request = new Request('http://localhost/', {
      headers: { 'X-Forwarded-For': '2.2.2.2, 3.3.3.3' }
    });
    expect(getClientIp(request)).toBe('2.2.2.2');
  });

  it('returns unknown when no IP headers are present', () => {
    const request = new Request('http://localhost/');
    expect(getClientIp(request)).toBe('unknown');
  });
});

describe('checkRateLimit', () => {
  it('allows requests up to the limit', async () => {
    const kv = createFakeKv();
    const now = Date.now();
    for (let i = 1; i <= 3; i++) {
      const result = await checkRateLimit(kv, 'rl:test:ip', 3, 60, now);
      expect(result.allowed).toBe(true);
      expect(result.count).toBe(i);
    }
  });

  it('rejects the request after the limit is reached', async () => {
    const kv = createFakeKv();
    const now = Date.now();
    await checkRateLimit(kv, 'rl:test:ip', 2, 60, now);
    await checkRateLimit(kv, 'rl:test:ip', 2, 60, now);
    const result = await checkRateLimit(kv, 'rl:test:ip', 2, 60, now);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('resets the counter on window rollover', async () => {
    const kv = createFakeKv();
    const windowStart = 1_000_000 * 1000; // arbitrary ms timestamp aligned to seconds
    await checkRateLimit(kv, 'rl:test:ip', 1, 60, windowStart);
    const blocked = await checkRateLimit(kv, 'rl:test:ip', 1, 60, windowStart);
    expect(blocked.allowed).toBe(false);

    const nextWindow = windowStart + 61 * 1000;
    const allowed = await checkRateLimit(kv, 'rl:test:ip', 1, 60, nextWindow);
    expect(allowed.allowed).toBe(true);
    expect(allowed.count).toBe(1);
  });

  it('writes with an expirationTtl of at least 60 seconds', async () => {
    const kv = createFakeKv();
    await checkRateLimit(kv, 'rl:test:ip', 5, 10, Date.now());
    expect(kv.puts[0].ttl).toBeGreaterThanOrEqual(60);
  });

  it('sets expirationTtl to twice the window when that is larger than 60', async () => {
    const kv = createFakeKv();
    await checkRateLimit(kv, 'rl:test:ip', 5, 120, Date.now());
    expect(kv.puts[0].ttl).toBe(240);
  });
});

describe('pathPrefix / pathPattern', () => {
  it('pathPrefix matches paths starting with the prefix', () => {
    const matcher = pathPrefix('/api/');
    expect(matcher('/api/users')).toBe(true);
    expect(matcher('/other')).toBe(false);
  });

  it('pathPattern matches paths against a regex', () => {
    const matcher = pathPattern(/^\/users\/\d+$/);
    expect(matcher('/users/123')).toBe(true);
    expect(matcher('/users/abc')).toBe(false);
  });
});

describe('createRateLimiter', () => {
  const rules = [
    {
      name: 'login',
      methods: ['POST'],
      match: pathPrefix('/login'),
      limit: 2,
      windowSec: 60
    },
    {
      name: 'catchall',
      match: () => true,
      limit: 5,
      windowSec: 60
    }
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('allows requests below the limit and returns undefined', async () => {
    const kv = createFakeKv();
    const middleware = createRateLimiter({ binding: 'RATE_LIMIT', rules });
    const request = new Request('http://localhost/login', { method: 'POST' });
    const result = await middleware(request, { RATE_LIMIT: kv }, {}, '/login');
    expect(result).toBeUndefined();
  });

  it('returns a 429 response once the limit is exceeded', async () => {
    const kv = createFakeKv();
    const middleware = createRateLimiter({ binding: 'RATE_LIMIT', rules });
    const request = new Request('http://localhost/login', {
      method: 'POST',
      headers: { 'CF-Connecting-IP': '9.9.9.9' }
    });
    const env = { RATE_LIMIT: kv };

    await middleware(request, env, {}, '/login');
    await middleware(request, env, {}, '/login');
    const response = await middleware(request, env, {}, '/login');

    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body.error).toBe('Too many requests');
    expect(response.headers.get('Retry-After')).toBeTruthy();
    expect(response.headers.get('X-RateLimit-Limit')).toBe('2');
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('0');
  });

  it('applies the methods filter (rule does not apply to non-matching methods)', async () => {
    const kv = createFakeKv();
    const middleware = createRateLimiter({ binding: 'RATE_LIMIT', rules });
    const env = { RATE_LIMIT: kv };
    // GET /login exhausts the catchall rule (limit 5) instead of login (limit 2, POST only)
    const request = new Request('http://localhost/login', { method: 'GET' });
    for (let i = 0; i < 5; i++) {
      const result = await middleware(request, env, {}, '/login');
      expect(result).toBeUndefined();
    }
    const blocked = await middleware(request, env, {}, '/login');
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('X-RateLimit-Limit')).toBe('5');
  });

  it('only applies the first matching rule', async () => {
    const kv = createFakeKv();
    const middleware = createRateLimiter({ binding: 'RATE_LIMIT', rules });
    const env = { RATE_LIMIT: kv };
    const request = new Request('http://localhost/login', { method: 'POST' });

    await middleware(request, env, {}, '/login');
    await middleware(request, env, {}, '/login');
    const blocked = await middleware(request, env, {}, '/login');

    expect(blocked.headers.get('X-RateLimit-Limit')).toBe('2');
  });

  it('allows requests and warns when the KV binding is missing', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const middleware = createRateLimiter({ binding: 'MISSING_BINDING', rules });
    const request = new Request('http://localhost/login', { method: 'POST' });
    const result = await middleware(request, {}, {}, '/login');
    expect(result).toBeUndefined();
    warnSpy.mockRestore();
  });

  it('allows requests and warns when KV throws', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const kv = {
      get: vi.fn().mockRejectedValue(new Error('KV down')),
      put: vi.fn()
    };
    const middleware = createRateLimiter({ binding: 'RATE_LIMIT', rules });
    const request = new Request('http://localhost/login', { method: 'POST' });
    const result = await middleware(request, { RATE_LIMIT: kv }, {}, '/login');
    expect(result).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('does not apply any rule for unmatched paths', async () => {
    const kv = createFakeKv();
    const onlyLoginRule = [
      { name: 'login', methods: ['POST'], match: pathPrefix('/login'), limit: 1, windowSec: 60 }
    ];
    const middleware = createRateLimiter({ binding: 'RATE_LIMIT', rules: onlyLoginRule });
    const request = new Request('http://localhost/other', { method: 'POST' });
    const result = await middleware(request, { RATE_LIMIT: kv }, {}, '/other');
    expect(result).toBeUndefined();
  });
});

describe('createRateLimiter integration with Router', () => {
  it('is wired via Router.use() and blocks matching requests', async () => {
    const kv = createFakeKv();
    const router = new Router();
    router.use(createRateLimiter({
      binding: 'RATE_LIMIT',
      rules: [{ name: 'api', match: pathPrefix('/api'), limit: 1, windowSec: 60 }]
    }));
    router.get('/api/items', () => json({ items: [] }));

    const env = { RATE_LIMIT: kv };
    const makeRequest = () => new Request('http://localhost/api/items', {
      headers: { 'CF-Connecting-IP': '5.5.5.5' }
    });

    const first = await router.handle(makeRequest(), env, {});
    expect(first.status).toBe(200);

    const second = await router.handle(makeRequest(), env, {});
    expect(second.status).toBe(429);
  });
});
