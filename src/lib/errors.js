/**
 * Error catalogue shared by router.js and http.js (internal module, not part
 * of the package `exports`).
 *
 * Every API error body is `{ error: string, code: string }`. `error` is the
 * human-readable message (French by default, the product language) and `code`
 * is the stable machine-readable identifier clients should switch on.
 */

/**
 * @typedef {'bad_request'|'invalid_body'|'invalid_id'|'unauthorized'|'forbidden'|'not_found'|'conflict'|'payload_too_large'|'too_many_requests'|'internal_error'} ErrorCode
 */

/** @type {Readonly<Record<ErrorCode, { status: number, message: string }>>} */
export const ERRORS = Object.freeze({
  bad_request: { status: 400, message: 'Requête invalide' },
  invalid_body: { status: 400, message: 'Corps de requête invalide' },
  invalid_id: { status: 400, message: 'Identifiant invalide' },
  unauthorized: { status: 401, message: 'Non autorisé' },
  forbidden: { status: 403, message: 'Accès interdit' },
  not_found: { status: 404, message: 'Ressource introuvable' },
  conflict: { status: 409, message: 'Cette ressource existe déjà' },
  payload_too_large: { status: 413, message: 'Requête trop volumineuse' },
  too_many_requests: { status: 429, message: 'Trop de requêtes, veuillez réessayer plus tard' },
  internal_error: { status: 500, message: 'Erreur interne' }
});
