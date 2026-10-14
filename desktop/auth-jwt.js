// Technically Not desktop · auth-jwt.js — Pure-Node OIDC helpers used by Technically Not sign-in
// (user-auth.js): random values, PKCE, constant-time compare, JWKS cache, ID-token (RS256/ES256)
// verification, ES256 signing. No Electron, no dependencies.
'use strict';
const crypto = require('crypto');

const b64url = buf =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = str => Buffer.from(String(str).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const random = (bytes = 32) => b64url(crypto.randomBytes(bytes));
const sha256 = value => crypto.createHash('sha256').update(value).digest();

// map keys for secrets, so lookups don't leak timing about the secret itself
const hashKey = value => sha256(String(value)).toString('hex');

// PKCE (RFC 7636), S256 only.
const pkce = () => {
  const verifier = random(48);
  return { verifier, challenge: b64url(sha256(verifier)) };
};
const challengeOf = verifier => b64url(sha256(String(verifier)));

// Constant-time string equality (hashes first, so lengths never leak and timingSafeEqual always
// gets equal-length input).
const safeEqual = (a, b) =>
  typeof a === 'string' &&
  typeof b === 'string' &&
  crypto.timingSafeEqual(sha256(a), sha256(b)) &&
  a.length === b.length;

// JSON over HTTPS with a timeout and a response size cap. `fetchImpl` defaults to the global fetch
// (Node 18+ / Electron).
async function fetchJson(url, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    ...options,
    redirect: 'error',
    signal: AbortSignal.timeout(options.timeoutMs || 15000),
  });
  const text = await response.text();
  if (text.length > 512 * 1024) throw new Error('Response too large from ' + new URL(url).host);
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: response.status, ok: response.ok, body, headers: response.headers };
}

// JWKS cache per URI: honors Cache-Control max-age (1 min .. 24 h, default 1 h); an unknown `kid`
// forces one refetch at most every 30 s (key rotation).
function jwksCache(fetchImpl = fetch) {
  const cache = new Map();

  async function load(uri, force) {
    const hit = cache.get(uri),
      now = Date.now();
    if (hit && !force && hit.expires > now) return hit.keys;
    if (hit && force && now - hit.fetchedAt < 30000) return hit.keys;
    const r = await fetchJson(uri, {}, fetchImpl);
    if (!r.ok || !Array.isArray(r.body?.keys))
      throw new Error('Could not load the sign-in keys (' + r.status + ').');
    const age = Number(/max-age=(\d+)/.exec(r.headers.get('cache-control') || '')?.[1]) || 3600;
    const keys = r.body.keys.filter(k => k && typeof k.kid === 'string');
    cache.set(uri, {
      keys,
      fetchedAt: now,
      expires: now + Math.min(86400, Math.max(60, age)) * 1000,
    });
    return keys;
  }
  return {
    async key(uri, kid) {
      let jwk = (await load(uri, false)).find(k => k.kid === kid);
      if (!jwk) jwk = (await load(uri, true)).find(k => k.kid === kid);
      if (!jwk) throw new Error('The sign-in token was signed with an unknown key.');
      return jwk;
    },
    clear: () => cache.clear(),
  };
}

const ALGS = { RS256: { kty: 'RSA' }, ES256: { kty: 'EC', crv: 'P-256', sigLength: 64 } };

// Verifies a compact JWS ID token and its OIDC claims. Throws with a readable message on any
// failure; returns the claims. opts: { jwksUri, jwks (jwksCache), issuers: [..], audience, nonce,
// algs, skewSec (default 60), now (ms, tests) }
async function verifyIdToken(token, opts) {
  if (typeof token !== 'string' || token.length > 16384)
    throw new Error('The sign-in token is missing.');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('The sign-in token is malformed.');
  let header, claims;
  try {
    header = JSON.parse(fromB64url(parts[0]).toString('utf8'));
    claims = JSON.parse(fromB64url(parts[1]).toString('utf8'));
  } catch {
    throw new Error('The sign-in token is malformed.');
  }
  const allowed = opts.algs || ['RS256', 'ES256'];
  const spec = ALGS[header?.alg];
  if (!spec || !allowed.includes(header.alg))
    throw new Error('The sign-in token uses an unsupported algorithm.');
  const jwk = await opts.jwks.key(opts.jwksUri, header.kid);
  if (
    jwk.kty !== spec.kty ||
    (spec.crv && jwk.crv !== spec.crv) ||
    (jwk.alg && jwk.alg !== header.alg) ||
    (jwk.use && jwk.use !== 'sig')
  )
    throw new Error('The sign-in key does not match the token.');
  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const signature = fromB64url(parts[2]);
  if (spec.sigLength && signature.length !== spec.sigLength)
    throw new Error('The sign-in token signature is invalid.');
  const valid = crypto.verify(
    'sha256',
    Buffer.from(parts[0] + '.' + parts[1]),
    spec.kty === 'EC' ? { key, dsaEncoding: 'ieee-p1363' } : key,
    signature
  );
  if (!valid) throw new Error('The sign-in token signature is invalid.');

  const now = Math.floor((opts.now || Date.now()) / 1000),
    skew = opts.skewSec ?? 60;
  if (!opts.issuers.includes(claims.iss))
    throw new Error('The sign-in token came from an unexpected issuer.');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!opts.audience || !aud.includes(opts.audience))
    throw new Error('The sign-in token was issued for a different app.');
  if (aud.length > 1 && claims.azp !== opts.audience)
    throw new Error('The sign-in token was issued for a different app.');
  if (typeof claims.exp !== 'number' || claims.exp + skew < now)
    throw new Error('The sign-in token has expired.');
  if (typeof claims.iat !== 'number' || claims.iat - skew > now)
    throw new Error('The sign-in token is not valid yet.');
  if (opts.nonce !== undefined && !safeEqual(String(claims.nonce ?? ''), String(opts.nonce)))
    throw new Error('The sign-in token does not belong to this sign-in attempt.');
  if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255)
    throw new Error('The sign-in token has no account id.');
  return claims;
}

// ES256 JWT (Apple client_secret). `privateKey` is a PEM string or KeyObject.
function signEs256(header, payload, privateKey) {
  const data =
    b64url(JSON.stringify({ ...header, alg: 'ES256', typ: 'JWT' })) +
    '.' +
    b64url(JSON.stringify(payload));
  const sig = crypto.sign('sha256', Buffer.from(data), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  return data + '.' + b64url(sig);
}

// Providers send booleans as true/'true' (Apple sends strings).
const truthy = v => v === true || v === 'true';

module.exports = {
  b64url,
  fromB64url,
  random,
  sha256,
  hashKey,
  pkce,
  challengeOf,
  safeEqual,
  fetchJson,
  jwksCache,
  verifyIdToken,
  signEs256,
  truthy,
};
