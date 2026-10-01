import { describe, it, expect, vi } from 'vitest';
import { Router, json } from '../src/lib/router.js';
import {
  timingSafeEqual, timingSafeEqualAsync, extractBearer, verifyAdminToken, adminOnly, createAdminGuard
} from '../src/lib/auth.js';

const req = (authorization, url = 'http://localhost/api/admin/members') =>
  new Request(url, { headers: authorization === undefined ? {} : { Authorization: authorization } });
const kvWith = (value) => ({ get: vi.fn(async () => value) });
const failingKv = () => ({ get: vi.fn(async () => { throw new Error('KV down'); }) });

describe.each([
  ['timingSafeEqual', async (a, b) => timingSafeEqual(a, b)],
  ['timingSafeEqualAsync', timingSafeEqualAsync]
])('%s', (_name, equal) => {
  it('is true for equal strings', async () => {
    expect(await equal('secret-token', 'secret-token')).toBe(true);
    expect(await equal('', '')).toBe(true);
    expect(await equal('Éloïse 🎓', 'Éloïse 🎓')).toBe(true);
  });

  it('is false for equal-length strings differing at the first, middle or last char', async () => {
    const base = 'abcdefghij';
    expect(await equal(base, 'Xbcdefghij')).toBe(false);
    expect(await equal(base, 'abcdeXghij')).toBe(false);
    expect(await equal(base, 'abcdefghiX')).toBe(false);
  });

  it('is false for different lengths, including prefixes and padding', async () => {
    expect(await equal('abc', 'abcd')).toBe(false);
    expect(await equal('abcd', 'abc')).toBe(false);
    expect(await equal('a', 'a\0')).toBe(false);
    expect(await equal('', 'a')).toBe(false);
    expect(await equal('x'.repeat(2000), 'x'.repeat(2001))).toBe(false);
    expect(await equal('x'.repeat(2000), 'x'.repeat(2000))).toBe(true);
  });

  it('does not conflate distinct lone surrogates or case', async () => {
    expect(await equal('a\ud800', 'a\ud801')).toBe(false);
    expect(await equal('Token', 'token')).toBe(false);
  });

  it('is false for non-strings', async () => {
    for (const bad of [null, undefined, 1, {}, [], ['a']]) {
      expect(await equal(bad, 'a')).toBe(false);
      expect(await equal('a', bad)).toBe(false);
      expect(await equal(bad, bad)).toBe(false);
    }
    expect(await equal({ toString: () => 'a' }, 'a')).toBe(false);
  });
});

describe('extractBearer', () => {
  it('extracts the token', () => {
    expect(extractBearer(req('Bearer abc.def'))).toBe('abc.def');
    expect(extractBearer(req('Bearer a b'))).toBe('a b');
  });

  it('is case-sensitive on the scheme', () => {
    expect(extractBearer(req('bearer abc'))).toBeNull();
    expect(extractBearer(req('BEARER abc'))).toBeNull();
  });

  it('rejects an empty token even when the header is not trimmed by the runtime', () => {
    expect(extractBearer({ headers: { get: () => 'Bearer ' } })).toBeNull();
  });

  it('rejects missing, empty and other schemes', () => {
    expect(extractBearer(req())).toBeNull();
    expect(extractBearer(req(''))).toBeNull();
    expect(extractBearer(req('Bearer '))).toBeNull();
    expect(extractBearer(req('Bearer'))).toBeNull();
    expect(extractBearer(req('Basic abc'))).toBeNull();
    expect(extractBearer(req('Bearerabc'))).toBeNull();
  });
});

describe('verifyAdminToken', () => {
  it('accepts the env token when KV is absent', async () => {
    expect(await verifyAdminToken(req('Bearer tok'), { ADMIN_TOKEN: 'tok' })).toBe(true);
    expect(await verifyAdminToken(req('Bearer nope'), { ADMIN_TOKEN: 'tok' })).toBe(false);
  });

  it('rejects when no token is presented', async () => {
    const kv = kvWith('tok');
    expect(await verifyAdminToken(req(), { ADMIN_TOKEN: 'tok', CONFIG: kv })).toBe(false);
    expect(kv.get).not.toHaveBeenCalled();
  });

  it('rejects when no token is configured (undefined, empty, non-string)', async () => {
    expect(await verifyAdminToken(req('Bearer tok'), {})).toBe(false);
    expect(await verifyAdminToken(req('Bearer tok'), { ADMIN_TOKEN: '' })).toBe(false);
    expect(await verifyAdminToken(req('Bearer tok'), { ADMIN_TOKEN: 123 })).toBe(false);
    expect(await verifyAdminToken(req('Bearer tok'), { CONFIG: kvWith(null) })).toBe(false);
    expect(await verifyAdminToken(req('Bearer tok'), undefined)).toBe(false);
    expect(await verifyAdminToken(req('Bearer tok'), null)).toBe(false);
  });

  it('lets a non-empty KV value override env.ADMIN_TOKEN', async () => {
    const env = { ADMIN_TOKEN: 'env-token', CONFIG: kvWith('kv-token') };
    expect(await verifyAdminToken(req('Bearer kv-token'), env)).toBe(true);
    expect(await verifyAdminToken(req('Bearer env-token'), env)).toBe(false);
    expect(env.CONFIG.get).toHaveBeenCalledWith('admin_token');
  });

  it('falls back to the env token when KV holds nothing (null or empty)', async () => {
    for (const stored of [null, '', undefined]) {
      const env = { ADMIN_TOKEN: 'env-token', CONFIG: kvWith(stored) };
      expect(await verifyAdminToken(req('Bearer env-token'), env)).toBe(true);
    }
  });

  it('fails closed on a KV failure, even when the env token would match', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = { ADMIN_TOKEN: 'env-token', CONFIG: failingKv() };
    expect(await verifyAdminToken(req('Bearer env-token'), env)).toBe(false);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('fails closed when the kv binding is not a KV namespace', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await verifyAdminToken(req('Bearer t'), { ADMIN_TOKEN: 't', CONFIG: {} })).toBe(false);
    spy.mockRestore();
  });

  it('honours custom kv and kvKey options', async () => {
    const kv = kvWith('custom');
    const env = { ADMIN_TOKEN: 'env', CONFIG: kvWith('ignored') };
    expect(await verifyAdminToken(req('Bearer custom'), env, { kv, kvKey: 'my_key' })).toBe(true);
    expect(kv.get).toHaveBeenCalledWith('my_key');
    expect(env.CONFIG.get).not.toHaveBeenCalled();
  });

  it('works with kv: null to skip KV even when env.CONFIG exists', async () => {
    const env = { ADMIN_TOKEN: 'env', CONFIG: kvWith('kv') };
    expect(await verifyAdminToken(req('Bearer env'), env, { kv: null })).toBe(true);
    expect(env.CONFIG.get).not.toHaveBeenCalled();
  });

  it('rejects tokens that are prefixes/extensions of the real one', async () => {
    const env = { ADMIN_TOKEN: 'secret' };
    expect(await verifyAdminToken(req('Bearer secre'), env)).toBe(false);
    expect(await verifyAdminToken(req('Bearer secret2'), env)).toBe(false);
  });
});

describe('adminOnly', () => {
  const handler = vi.fn(async (_request, _env, _ctx, params) => json({ ok: true, params }));

  it('runs the handler with the router arguments for a valid token', async () => {
    const env = { ADMIN_TOKEN: 'tok' };
    const ctx = {};
    const wrapped = adminOnly(handler);
    const response = await wrapped(req('Bearer tok'), env, ctx, { id: '5' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, params: { id: '5' } });
    expect(handler).toHaveBeenLastCalledWith(expect.any(Request), env, ctx, { id: '5' });
  });

  it('answers 401 unauthorized without calling the handler otherwise', async () => {
    const inner = vi.fn();
    const wrapped = adminOnly(inner);
    for (const header of [undefined, 'Bearer wrong', 'Basic tok']) {
      const response = await wrapped(req(header), { ADMIN_TOKEN: 'tok' }, {}, {});
      expect(response.status).toBe(401);
      expect((await response.json()).code).toBe('unauthorized');
    }
    expect(inner).not.toHaveBeenCalled();
  });

  it('passes options through to verifyAdminToken', async () => {
    const wrapped = adminOnly(handler, { kv: kvWith('from-kv'), kvKey: 'k' });
    expect((await wrapped(req('Bearer from-kv'), {}, {}, {})).status).toBe(200);
  });
});

describe('createAdminGuard', () => {
  const env = { ADMIN_TOKEN: 'tok' };
  const run = (guard, request, path) => guard(request, env, {}, path);

  it('lets requests outside the prefix through (returns undefined)', async () => {
    const guard = createAdminGuard();
    for (const path of ['/api/register', '/api/administrator', '/api', '/', '/api/adminX/members']) {
      expect(await run(guard, req(), path)).toBeUndefined();
    }
  });

  it('answers 401 for any request under the prefix without a valid token', async () => {
    const guard = createAdminGuard();
    for (const path of ['/api/admin/members', '/api/admin/', '/api/admin', '/api/admin/a/b/c']) {
      for (const header of [undefined, 'Bearer wrong', 'bearer tok']) {
        const response = await run(guard, req(header), path);
        expect(response.status).toBe(401);
        expect((await response.json()).code).toBe('unauthorized');
      }
    }
  });

  it('lets a valid token through', async () => {
    expect(await run(createAdminGuard(), req('Bearer tok'), '/api/admin/members')).toBeUndefined();
  });

  it('supports a custom prefix with or without trailing slash', async () => {
    for (const prefix of ['/internal', '/internal/']) {
      const guard = createAdminGuard(prefix);
      expect((await run(guard, req(), '/internal/x')).status).toBe(401);
      expect((await run(guard, req(), '/internal')).status).toBe(401);
      expect(await run(guard, req(), '/internalx')).toBeUndefined();
      expect(await run(guard, req(), '/api/admin/x')).toBeUndefined();
    }
  });

  it('guards everything for prefix "/"', async () => {
    const guard = createAdminGuard('/');
    expect((await run(guard, req(), '/anything')).status).toBe(401);
  });

  it('forwards options (fail closed on KV errors)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const guard = createAdminGuard('/api/admin/', { kv: failingKv() });
    expect((await run(guard, req('Bearer tok'), '/api/admin/x')).status).toBe(401);
    spy.mockRestore();
  });

  it('works as router middleware, behind a base path', async () => {
    const router = new Router('/site');
    router.use(createAdminGuard());
    router.get('/api/admin/secret', () => json({ secret: 1 }));
    router.get('/api/public', () => json({ public: 1 }));

    const call = (path, header) => router.handle(req(header, `http://localhost/site${path}`), env, {});
    expect((await call('/api/admin/secret')).status).toBe(401);
    expect((await call('/api/admin/secret', 'Bearer tok')).status).toBe(200);
    expect((await call('/api/admin/missing')).status).toBe(401);
    expect((await call('/api/public')).status).toBe(200);
  });
});
