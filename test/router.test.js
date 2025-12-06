import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  Router,
  json,
  error,
  success,
  corsHeaders,
  handleCors
} from '../src/lib/router.js';

describe('Router', () => {
  let router;

  beforeEach(() => {
    router = new Router();
  });

  describe('constructor', () => {
    it('should initialize with empty routes', () => {
      expect(router.routes).toEqual([]);
    });

    it('should normalize base path by removing trailing slash', () => {
      const r = new Router('/api/');
      expect(r.basePath).toBe('/api');
    });

    it('should accept custom maxBodySize option', () => {
      const r = new Router('', { maxBodySize: 2 * 1024 * 1024 });
      expect(r.maxBodySize).toBe(2 * 1024 * 1024);
    });
  });

  describe('add', () => {
    it('should add a route', () => {
      const handler = () => {};
      router.add('GET', '/test', handler);
      expect(router.routes.length).toBe(1);
      expect(router.routes[0].method).toBe('GET');
    });

    it('should throw if method is not a string', () => {
      expect(() => router.add(123, '/test', () => {})).toThrow(TypeError);
    });

    it('should throw if path is not a string', () => {
      expect(() => router.add('GET', 123, () => {})).toThrow(TypeError);
    });

    it('should throw if handler is not a function', () => {
      expect(() => router.add('GET', '/test', 'not a function')).toThrow(TypeError);
    });

    it('should return router for chaining', () => {
      const result = router.add('GET', '/test', () => {});
      expect(result).toBe(router);
    });
  });

  describe('HTTP method shortcuts', () => {
    it('should register GET route', () => {
      router.get('/test', () => {});
      expect(router.routes[0].method).toBe('GET');
    });

    it('should register POST route', () => {
      router.post('/test', () => {});
      expect(router.routes[0].method).toBe('POST');
    });

    it('should register PUT route', () => {
      router.put('/test', () => {});
      expect(router.routes[0].method).toBe('PUT');
    });

    it('should register DELETE route', () => {
      router.delete('/test', () => {});
      expect(router.routes[0].method).toBe('DELETE');
    });

    it('should register ALL route', () => {
      router.all('/test', () => {});
      expect(router.routes[0].method).toBe('ALL');
    });
  });

  describe('pathToRegex', () => {
    it('should convert simple path', () => {
      const pattern = router.pathToRegex('/test');
      expect('/test').toMatch(new RegExp(`^${pattern}$`));
    });

    it('should convert path with parameter', () => {
      const pattern = router.pathToRegex('/users/:id');
      const match = '/users/123'.match(new RegExp(`^${pattern}$`));
      expect(match).toBeTruthy();
      expect(match.groups.id).toBe('123');
    });

    it('should convert path with multiple parameters', () => {
      const pattern = router.pathToRegex('/users/:userId/posts/:postId');
      const match = '/users/1/posts/2'.match(new RegExp(`^${pattern}$`));
      expect(match.groups.userId).toBe('1');
      expect(match.groups.postId).toBe('2');
    });
  });

  describe('handle', () => {
    it('should match and call route handler', async () => {
      const handler = vi.fn(() => json({ ok: true }));
      router.get('/test', handler);

      const request = new Request('http://localhost/test');
      const response = await router.handle(request, {}, {});

      expect(handler).toHaveBeenCalled();
      expect(response.status).toBe(200);
    });

    it('should extract URL parameters', async () => {
      let capturedParams;
      router.get('/users/:id', (req, env, ctx, params) => {
        capturedParams = params;
        return json({ id: params.id });
      });

      const request = new Request('http://localhost/users/123');
      await router.handle(request, {}, {});

      expect(capturedParams.id).toBe('123');
    });

    it('should return 404 for unmatched routes', async () => {
      router.get('/exists', () => json({ ok: true }));

      const request = new Request('http://localhost/not-found');
      const response = await router.handle(request, {}, {});

      expect(response.status).toBe(404);
    });

    it('should strip base path', async () => {
      const r = new Router('/api');
      let capturedPath;
      r.get('/test', (req) => {
        capturedPath = new URL(req.url).pathname;
        return json({ ok: true });
      });

      const request = new Request('http://localhost/api/test');
      await r.handle(request, {}, {});

      // Handler receives original URL, but routing matched after stripping
      expect(capturedPath).toBe('/api/test');
    });

    it('should reject oversized POST requests', async () => {
      const r = new Router('', { maxBodySize: 100 });
      r.post('/upload', () => json({ ok: true }));

      const request = new Request('http://localhost/upload', {
        method: 'POST',
        headers: { 'Content-Length': '1000' }
      });
      const response = await r.handle(request, {}, {});

      expect(response.status).toBe(413);
    });

    it('should catch handler errors and return 500', async () => {
      router.get('/error', () => {
        throw new Error('Test error');
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const request = new Request('http://localhost/error');
      const response = await router.handle(request, {}, {});

      expect(response.status).toBe(500);
      consoleSpy.mockRestore();
    });

    it('should match ALL method for any HTTP method', async () => {
      const handler = vi.fn(() => json({ ok: true }));
      router.all('/any', handler);

      const getRequest = new Request('http://localhost/any');
      await router.handle(getRequest, {}, {});
      expect(handler).toHaveBeenCalledTimes(1);

      const postRequest = new Request('http://localhost/any', { method: 'POST' });
      await router.handle(postRequest, {}, {});
      expect(handler).toHaveBeenCalledTimes(2);
    });
  });
});

describe('Response helpers', () => {
  describe('json', () => {
    it('should create JSON response with default status 200', async () => {
      const response = json({ message: 'hello' });
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('application/json');
      const body = await response.json();
      expect(body.message).toBe('hello');
    });

    it('should accept custom status code', () => {
      const response = json({ error: 'bad' }, 400);
      expect(response.status).toBe(400);
    });

    it('should merge custom headers', () => {
      const response = json({}, 200, { 'X-Custom': 'value' });
      expect(response.headers.get('X-Custom')).toBe('value');
    });
  });

  describe('error', () => {
    it('should create error response with default status 400', async () => {
      const response = error('Something went wrong');
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('Something went wrong');
    });

    it('should accept custom status code', () => {
      const response = error('Not found', 404);
      expect(response.status).toBe(404);
    });
  });

  describe('success', () => {
    it('should create success response', async () => {
      const response = success('Operation completed');
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.message).toBe('Operation completed');
    });

    it('should merge additional data', async () => {
      const response = success('Created', { id: 123 });
      const body = await response.json();
      expect(body.id).toBe(123);
    });
  });
});

describe('CORS helpers', () => {
  describe('corsHeaders', () => {
    it('should return CORS headers for specified origin', () => {
      const headers = corsHeaders('https://example.com');
      expect(headers['Access-Control-Allow-Origin']).toBe('https://example.com');
      expect(headers['Access-Control-Allow-Methods']).toContain('GET');
      expect(headers['Access-Control-Allow-Headers']).toContain('Content-Type');
    });

    it('should throw if origin is not provided', () => {
      expect(() => corsHeaders()).toThrow();
      expect(() => corsHeaders('')).toThrow();
      expect(() => corsHeaders(null)).toThrow();
    });
  });

  describe('handleCors', () => {
    it('should return 204 response with CORS headers', () => {
      const response = handleCors('https://example.com');
      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com');
    });
  });
});
