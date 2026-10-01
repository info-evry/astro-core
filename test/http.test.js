import { describe, it, expect, vi } from 'vitest';
import {
  badRequest, invalidBody, invalidId, unauthorized, forbidden, notFound,
  conflict, tooLarge, tooManyRequests, serverError, okJson
} from '../src/lib/http.js';

async function parts(response) {
  return { status: response.status, body: await response.json(), type: response.headers.get('Content-Type') };
}

describe('error helpers', () => {
  it.each([
    ['badRequest', badRequest, 400, 'bad_request', 'Requête invalide'],
    ['invalidBody', invalidBody, 400, 'invalid_body', 'Corps de requête invalide'],
    ['invalidId', invalidId, 400, 'invalid_id', 'Identifiant invalide'],
    ['unauthorized', unauthorized, 401, 'unauthorized', 'Non autorisé'],
    ['forbidden', forbidden, 403, 'forbidden', 'Accès interdit'],
    ['notFound', notFound, 404, 'not_found', 'Ressource introuvable'],
    ['conflict', conflict, 409, 'conflict', 'Cette ressource existe déjà'],
    ['tooLarge', tooLarge, 413, 'payload_too_large', 'Requête trop volumineuse'],
    ['tooManyRequests', tooManyRequests, 429, 'too_many_requests', 'Trop de requêtes, veuillez réessayer plus tard']
  ])('%s answers %i with { error, code } in JSON', async (_name, helper, status, code, message) => {
    const result = await parts(helper());
    expect(result).toEqual({ status, body: { error: message, code }, type: 'application/json' });
  });

  it.each([
    badRequest, invalidBody, invalidId, unauthorized, forbidden, notFound, conflict, tooLarge, tooManyRequests
  ])('%o accepts an override message and keeps the code', async (helper) => {
    const plain = await parts(helper());
    const custom = await parts(helper('Message perso'));
    expect(custom.body).toEqual({ error: 'Message perso', code: plain.body.code });
    expect(custom.status).toBe(plain.status);
  });

  it('ignores an empty or non-string override and uses the default', async () => {
    expect((await parts(notFound(''))).body.error).toBe('Ressource introuvable');
    expect((await parts(notFound(42))).body.error).toBe('Ressource introuvable');
    expect((await parts(notFound({ toString: () => 'x' }))).body.error).toBe('Ressource introuvable');
    expect((await parts(badRequest(undefined, 'custom'))).body).toEqual({ error: 'Requête invalide', code: 'custom' });
  });

  it('badRequest takes a custom code', async () => {
    const { body } = await parts(badRequest('Email manquant', 'missing_email'));
    expect(body).toEqual({ error: 'Email manquant', code: 'missing_email' });
  });
});

describe('serverError', () => {
  it('logs label and error, answers a generic 500 without leaking the message', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new Error('SQLITE_ERROR: no such table: secrets');
    const response = serverError('Batch update error:', err);
    expect(spy).toHaveBeenCalledWith('Batch update error:', err);
    spy.mockRestore();

    const text = await response.text();
    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ error: 'Erreur interne', code: 'internal_error' });
    expect(text).not.toContain('SQLITE');
    expect(text).not.toContain('secrets');
  });

  it('copes with non-Error throwables and allows a static message override', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = serverError('x', 'a string', 'Impossible de mettre à jour');
    spy.mockRestore();
    expect(await response.json()).toEqual({ error: 'Impossible de mettre à jour', code: 'internal_error' });
  });
});

describe('okJson', () => {
  it('answers 200 JSON with the data as-is', async () => {
    expect(await parts(okJson({ a: 1, list: [1, 2] }))).toEqual({
      status: 200, body: { a: 1, list: [1, 2] }, type: 'application/json'
    });
  });
});
