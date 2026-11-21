import { describe, it, expect, vi } from 'vitest';
import { createApiRoute } from '../src/lib/api-route.js';
import { Router, json } from '../src/lib/router.js';

const ALLOWED = ['https://asso.info-evry.fr', 'http://localhost:4321'];

function setup(routerSetup = () => {}, options = {}) {
  const router = new Router('/site');
  routerSetup(router);
  const route = createApiRoute({ router, allowedOrigins: ALLOWED, ...options });
  return { router, route };
}

const call = (route, url, init, locals = {}) => route.ALL({ request: new Request(url, init), locals });
const acao = (response) => response.headers.get('Access-Control-Allow-Origin');

describe('createApiRoute: shape and configuration', () => {
  it('returns the same handler for every method', () => {
    const { route } = setup();
    expect(Object.keys(route).sort()).toEqual(['ALL', 'DELETE', 'GET', 'OPTIONS', 'POST', 'PUT']);
    for (const method of ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']) {
      expect(route[method]).toBe(route.ALL);
    }
  });

  it('rejects an invalid router or allowedOrigins', () => {
    expect(() => createApiRoute({ router: {}, allowedOrigins: ALLOWED })).toThrow(TypeError);
    expect(() => createApiRoute({ router: null, allowedOrigins: ALLOWED })).toThrow(TypeError);
    expect(() => createApiRoute({ router: new Router(), allowedOrigins: [] })).toThrow(TypeError);
    expect(() => createApiRoute({ router: new Router(), allowedOrigins: 'https://x' })).toThrow(TypeError);
    expect(() => createApiRoute({ router: new Router() })).toThrow(TypeError);
  });
});

describe('CORS origin selection', () => {
  const ok = (router) => router.get('/api/ping', () => json({ pong: true }));

  it('echoes an allowed Origin', async () => {
    const { route } = setup(ok);
    const response = await call(route, 'http://localhost:4321/site/api/ping', {
      headers: { Origin: 'http://localhost:4321' }
    });
    expect(acao(response)).toBe('http://localhost:4321');
  });

  it('uses the request origin when there is no Origin header (same-origin)', async () => {
    const { route } = setup(ok);
    const response = await call(route, 'https://elsewhere.test/site/api/ping');
    expect(acao(response)).toBe('https://elsewhere.test');
  });

  it('never reflects an unknown origin: falls back to the first allowed one', async () => {
    const { route } = setup(ok);
    for (const origin of [
      'https://evil.test',
      'null',
      'https://asso.info-evry.fr.evil.test',
      'HTTPS://ASSO.INFO-EVRY.FR'
    ]) {
      const response = await call(route, 'https://asso.info-evry.fr/site/api/ping', { headers: { Origin: origin } });
      expect(acao(response)).toBe(ALLOWED[0]);
    }
  });

  it('adds the full CORS header set and Vary: Origin to normal responses', async () => {
    const { route } = setup(ok);
    const response = await call(route, 'https://asso.info-evry.fr/site/api/ping');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ pong: true });
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, PUT, DELETE, OPTIONS');
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type, Authorization');
    expect(response.headers.get('Access-Control-Max-Age')).toBe('86400');
    expect(response.headers.get('Vary')).toBe('Origin');
    expect(response.headers.get('Content-Type')).toBe('application/json');
  });

  it('keeps an existing Vary header', async () => {
    const { route } = setup((router) => router.get('/api/v', () => json({}, 200, { Vary: 'Accept-Encoding' })));
    const response = await call(route, 'https://asso.info-evry.fr/site/api/v');
    expect(response.headers.get('Vary')).toBe('Accept-Encoding, Origin');
  });
});

describe('preflight', () => {
  it('answers OPTIONS with 204 and CORS headers without reaching the router', async () => {
    const handle = vi.fn();
    const route = createApiRoute({ router: { handle }, allowedOrigins: ALLOWED });
    const response = await call(route, 'https://asso.info-evry.fr/site/api/x', {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:4321' }
    });
    expect(response.status).toBe(204);
    expect(acao(response)).toBe('http://localhost:4321');
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('DELETE');
    expect(await response.text()).toBe('');
    expect(handle).not.toHaveBeenCalled();
  });

  it('answers the preflight of an unknown origin with the first allowed origin', async () => {
    const { route } = setup();
    const response = await call(route, 'https://x.test/site/api/x', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.test' }
    });
    expect(response.status).toBe(204);
    expect(acao(response)).toBe(ALLOWED[0]);
  });
});

describe('CORS on router-generated and error responses', () => {
  it('adds CORS headers to the router 404', async () => {
    const { route } = setup();
    const response = await call(route, 'http://localhost:4321/site/api/missing', {
      headers: { Origin: 'http://localhost:4321' }
    });
    expect(response.status).toBe(404);
    expect(acao(response)).toBe('http://localhost:4321');
    expect(await response.json()).toEqual({ error: 'Ressource introuvable', code: 'not_found' });
  });

  it('adds CORS headers to the router 413', async () => {
    const router = new Router('/site', { maxBodySize: 10 });
    const route = createApiRoute({ router, allowedOrigins: ALLOWED });
    const response = await call(route, 'https://asso.info-evry.fr/site/api/x', {
      method: 'POST',
      body: 'x'.repeat(50),
      headers: { 'Content-Length': '50' }
    });
    expect(response.status).toBe(413);
    expect(acao(response)).toBe('https://asso.info-evry.fr');
  });

  it('adds CORS headers to the router 500 without leaking the message', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { route } = setup((router) =>
      router.get('/api/boom', () => {
        throw new Error('db password leaked');
      })
    );
    const response = await call(route, 'https://asso.info-evry.fr/site/api/boom');
    spy.mockRestore();
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(acao(response)).toBe('https://asso.info-evry.fr');
    expect(JSON.parse(text)).toEqual({ error: 'Erreur interne', code: 'internal_error' });
    expect(text).not.toContain('password');
  });

  it('preserves status, status text and body of the router response, including 204', async () => {
    const { route } = setup((router) => {
      router.get('/api/created', () => json({ id: 7 }, 201));
      router.delete('/api/gone', () => new Response(null, { status: 204 }));
    });
    const created = await call(route, 'https://asso.info-evry.fr/site/api/created');
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ id: 7 });
    const gone = await call(route, 'https://asso.info-evry.fr/site/api/gone', { method: 'DELETE' });
    expect(gone.status).toBe(204);
    expect(acao(gone)).toBe('https://asso.info-evry.fr');
  });

  it('copes with immutable response headers (e.g. a fetch() response)', async () => {
    const route = createApiRoute({
      router: { handle: async () => Response.redirect('https://asso.info-evry.fr/x', 302) },
      allowedOrigins: ALLOWED
    });
    const response = await call(route, 'https://asso.info-evry.fr/api');
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('https://asso.info-evry.fr/x');
    expect(acao(response)).toBe('https://asso.info-evry.fr');
  });

  it('answers 404 with CORS when the router returns nothing', async () => {
    const route = createApiRoute({ router: { handle: async () => undefined }, allowedOrigins: ALLOWED });
    const response = await call(route, 'https://asso.info-evry.fr/api');
    expect(response.status).toBe(404);
    expect(acao(response)).toBe('https://asso.info-evry.fr');
    expect((await response.json()).code).toBe('not_found');
  });
});

describe('never throws', () => {
  it.each([
    [
      'router.handle throws',
      {
        router: {
          handle: async () => {
            throw new Error('secret');
          }
        }
      }
    ],
    [
      'router.handle throws synchronously',
      {
        router: {
          handle: () => {
            throw new Error('secret');
          }
        }
      }
    ],
    ['router returns a non-Response', { router: { handle: async () => 42 } }],
    [
      'getEnv throws',
      {
        getEnv: () => {
          throw new Error('secret');
        }
      }
    ],
    [
      'getCtx throws',
      {
        getCtx: () => {
          throw new Error('secret');
        }
      }
    ]
  ])('turns "%s" into a CORS-enabled generic 500', async (_name, overrides) => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const route = createApiRoute({ router: new Router(), allowedOrigins: ALLOWED, ...overrides });
    const response = await call(route, 'http://localhost:4321/api/x', { headers: { Origin: 'http://localhost:4321' } });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    expect(response.status).toBe(500);
    expect(acao(response)).toBe('http://localhost:4321');
    const body = await response.json();
    expect(body).toEqual({ error: 'Erreur interne', code: 'internal_error' });
  });

  it('still answers when the request itself is unusable', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const route = createApiRoute({ router: new Router(), allowedOrigins: ALLOWED });
    const response = await route.ALL({ request: null, locals: {} });
    spy.mockRestore();
    expect(response.status).toBe(500);
    expect(acao(response)).toBe(ALLOWED[0]);
  });
});

describe('getEnv / getCtx', () => {
  const probe = (router) => router.get('/api/env', (_req, env, ctx) => json({ env, ctx }));

  it('default to locals.runtime.env and locals.cfContext', async () => {
    const { route } = setup(probe);
    const response = await call(route, 'https://asso.info-evry.fr/site/api/env', undefined, {
      runtime: { env: { A: 1 } },
      cfContext: { waitUntil: 'x' }
    });
    expect(await response.json()).toEqual({ env: { A: 1 }, ctx: { waitUntil: 'x' } });
  });

  it('default to undefined when locals carry nothing', async () => {
    const { route } = setup(probe);
    for (const locals of [{}, { runtime: {} }, undefined]) {
      const response = await call(route, 'https://asso.info-evry.fr/site/api/env', undefined, locals);
      expect(await response.json()).toEqual({});
    }
  });

  it('use the supplied getters (e.g. () => env from cloudflare:workers)', async () => {
    const globalEnv = { DB: 'db' };
    const seen = [];
    const { route } = setup(probe, {
      getEnv: (locals) => {
        seen.push(locals);
        return globalEnv;
      },
      getCtx: () => ({ ctx: true })
    });
    const locals = { marker: 1 };
    const response = await call(route, 'https://asso.info-evry.fr/site/api/env', undefined, locals);
    expect(await response.json()).toEqual({ env: globalEnv, ctx: { ctx: true } });
    expect(seen).toEqual([locals]);
  });
});
