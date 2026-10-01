import { describe, it, expect } from 'vitest';
import {
  readJsonObject, readJsonOrRespond, isUniqueConstraintError, isForeignKeyError
} from '../src/lib/request.js';

const post = (body, headers = {}) => new Request('http://localhost/x', { method: 'POST', body, headers });

describe('readJsonObject', () => {
  it('returns a plain object', async () => {
    expect(await readJsonObject(post('{"a":1,"b":{"c":[1,2]}}'))).toEqual({ a: 1, b: { c: [1, 2] } });
  });

  it('handles UTF-8 content and a leading BOM', async () => {
    expect(await readJsonObject(post('{"nom":"Éloïse 🎓"}'))).toEqual({ nom: 'Éloïse 🎓' });
    expect(await readJsonObject(post('﻿{"a":1}'))).toEqual({ a: 1 });
  });

  it.each([
    ['empty body', ''],
    ['whitespace', '   '],
    ['malformed', '{"a":'],
    ['not JSON', 'hello'],
    ['null', 'null'],
    ['array', '[1,2]'],
    ['number', '42'],
    ['string', '"x"'],
    ['boolean', 'true'],
    ['trailing garbage', '{"a":1}x']
  ])('returns null for %s', async (_name, body) => {
    expect(await readJsonObject(post(body))).toBeNull();
  });

  it('returns null when there is no body at all', async () => {
    expect(await readJsonObject(new Request('http://localhost/x'))).toBeNull();
  });

  it('returns null when the body was already consumed', async () => {
    const request = post('{"a":1}');
    await request.text();
    expect(await readJsonObject(request)).toBeNull();
  });

  it('keeps __proto__ as an inert own property', async () => {
    const body = await readJsonObject(post('{"__proto__":{"admin":true},"x":1}'));
    expect(Object.hasOwn(body, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(body)).toBe(Object.prototype);
    expect({}.admin).toBeUndefined();
  });

  it('accepts a body of exactly maxBytes and rejects one byte more', async () => {
    const json = '{"a":"xxxxxxxx"}';
    const size = new TextEncoder().encode(json).length;
    expect(await readJsonObject(post(json), { maxBytes: size })).toEqual({ a: 'xxxxxxxx' });
    expect(await readJsonObject(post(json), { maxBytes: size - 1 })).toBeNull();
  });

  it('measures bytes, not characters', async () => {
    const json = '{"a":"é€🎓"}'; // 3 multi-byte chars
    const bytes = new TextEncoder().encode(json).length;
    expect(json.length).toBeLessThan(bytes);
    expect(await readJsonObject(post(json), { maxBytes: json.length })).toBeNull();
    expect(await readJsonObject(post(json), { maxBytes: bytes })).not.toBeNull();
  });

  it('enforces the 1 MiB default on the actual body even with a lying Content-Length', async () => {
    const big = JSON.stringify({ a: 'x'.repeat(1_048_576) });
    expect(await readJsonObject(post(big, { 'Content-Length': '10' }))).toBeNull();
    const ok = JSON.stringify({ a: 'x'.repeat(1000) });
    expect(await readJsonObject(post(ok, { 'Content-Length': '10' }))).toEqual({ a: 'x'.repeat(1000) });
  });

  it('rejects early on a declared Content-Length above the limit', async () => {
    expect(await readJsonObject(post('{}', { 'Content-Length': '5000' }), { maxBytes: 100 })).toBeNull();
  });

  it('ignores an unparsable Content-Length', async () => {
    expect(await readJsonObject(post('{"a":1}', { 'Content-Length': 'abc' }))).toEqual({ a: 1 });
  });

  it('reads a multi-chunk streamed body', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('{"a":'));
        controller.enqueue(encoder.encode('"b'));
        controller.enqueue(encoder.encode('c"}'));
        controller.close();
      }
    });
    const request = new Request('http://localhost/x', { method: 'POST', body: stream, duplex: 'half' });
    expect(await readJsonObject(request)).toEqual({ a: 'bc' });
  });

  it('stops reading an endless stream once over the limit', async () => {
    let pulled = 0;
    let cancelled = false;
    const stream = new ReadableStream({
      pull(controller) {
        pulled++;
        controller.enqueue(new Uint8Array(1024).fill(97));
      },
      cancel() {
        cancelled = true;
      }
    });
    const request = new Request('http://localhost/x', { method: 'POST', body: stream, duplex: 'half' });
    expect(await readJsonObject(request, { maxBytes: 4096 })).toBeNull();
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThan(20);
  });

  it('copes with a stream whose cancel() rejects', async () => {
    const stream = new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(100)); },
      cancel() { throw new Error('nope'); }
    });
    const request = new Request('http://localhost/x', { method: 'POST', body: stream, duplex: 'half' });
    expect(await readJsonObject(request, { maxBytes: 150 })).toBeNull();
  });

  it.each([NaN, -1, Infinity, '10', null])('throws on an invalid maxBytes (%s)', async (maxBytes) => {
    await expect(readJsonObject(post('{}'), { maxBytes })).rejects.toThrow(TypeError);
  });

  it('maxBytes: 0 only accepts nothing parseable', async () => {
    expect(await readJsonObject(post('{}'), { maxBytes: 0 })).toBeNull();
  });
});

describe('readJsonOrRespond', () => {
  it('returns { data, response: null } on success', async () => {
    expect(await readJsonOrRespond(post('{"a":1}'))).toEqual({ data: { a: 1 }, response: null });
  });

  it('answers 400 invalid_body for a bad body', async () => {
    for (const body of ['', '{', '[]', 'null', '1']) {
      const { data, response } = await readJsonOrRespond(post(body));
      expect(data).toBeNull();
      expect(response.status).toBe(400);
      expect((await response.json()).code).toBe('invalid_body');
    }
  });

  it('answers 413 for an oversize body (declared or actual)', async () => {
    for (const request of [
      post('{"a":"xxxxxxxxxxxx"}', { 'Content-Length': '99999' }),
      post('{"a":"xxxxxxxxxxxx"}', { 'Content-Length': '1' })
    ]) {
      const { data, response } = await readJsonOrRespond(request, { maxBytes: 10 });
      expect(data).toBeNull();
      expect(response.status).toBe(413);
      expect((await response.json()).code).toBe('payload_too_large');
    }
  });
});

describe('isUniqueConstraintError / isForeignKeyError', () => {
  it('detects SQLite and D1 messages', () => {
    expect(isUniqueConstraintError(new Error('UNIQUE constraint failed: members.email'))).toBe(true);
    expect(isUniqueConstraintError(new Error('D1_ERROR: UNIQUE constraint failed: t.c: SQLITE_CONSTRAINT'))).toBe(true);
    expect(isUniqueConstraintError(new Error('unique constraint failed'))).toBe(true);
    expect(isUniqueConstraintError(new Error('SQLITE_CONSTRAINT_PRIMARYKEY'))).toBe(true);
    expect(isForeignKeyError(new Error('FOREIGN KEY constraint failed'))).toBe(true);
    expect(isForeignKeyError(new Error('D1_ERROR: SQLITE_CONSTRAINT_FOREIGNKEY'))).toBe(true);
  });

  it('does not confuse the two kinds', () => {
    expect(isUniqueConstraintError(new Error('FOREIGN KEY constraint failed'))).toBe(false);
    expect(isForeignKeyError(new Error('UNIQUE constraint failed: a.b'))).toBe(false);
    expect(isUniqueConstraintError(new Error('NOT NULL constraint failed'))).toBe(false);
  });

  it('looks into the cause chain', () => {
    const wrapped = new Error('D1_ERROR: query failed', { cause: new Error('UNIQUE constraint failed: a.b') });
    expect(isUniqueConstraintError(wrapped)).toBe(true);
    expect(isForeignKeyError(wrapped)).toBe(false);
    const deep = new Error('a', { cause: new Error('b', { cause: new Error('FOREIGN KEY constraint failed') }) });
    expect(isForeignKeyError(deep)).toBe(true);
  });

  it('survives cause cycles', () => {
    const a = new Error('a');
    const b = new Error('b', { cause: a });
    a.cause = b;
    expect(isUniqueConstraintError(a)).toBe(false);
  });

  it('works on error-like objects, not only Error instances (cross-realm)', () => {
    expect(isUniqueConstraintError({ message: 'UNIQUE constraint failed: x.y' })).toBe(true);
  });

  it.each([null, undefined, 'UNIQUE constraint failed', 42, {}, { message: 42 }, [], true])(
    'returns false for non-error input %j',
    (value) => {
      expect(isUniqueConstraintError(value)).toBe(false);
      expect(isForeignKeyError(value)).toBe(false);
    }
  );
});
