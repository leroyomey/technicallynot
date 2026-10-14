// Technically Not desktop · plan-pass.js — The signed plan pass from the accounts server (GET
// /entitlements, POST /auth/refresh): a compact JWS, header {"alg":"EdDSA"}, signed with the
// server's Ed25519 key. Verified here with the public key built into the app
// (the accounts server publishes the same key), then `exp`. Nothing unsigned is ever trusted. Pure
// Node, no Electron.
'use strict';
const crypto = require('crypto');

// The accounts server's pass-signing public key (SPKI, base64).
const PUBLIC_KEY = 'MCowBQYDK2VwAyEAPirak9vrppxQlESVDJors97ZWhGwtCy1Rqoh0r16Ym8=';
const PLANS = new Set(['pro', 'team', 'none']);
const SKEW = 60; // seconds of clock difference allowed on iat

const fromB64url = s => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const keys = new Map();

function keyOf(spki) {
  if (!keys.has(spki))
    keys.set(
      spki,
      crypto.createPublicKey({ key: Buffer.from(spki, 'base64'), format: 'der', type: 'spki' })
    );
  return keys.get(spki);
}

/**
 * verify(pass, { publicKey, now, sub }) → { ok: true, claims } | { ok: false, reason, claims? }
 * reason: 'missing' | 'malformed' | 'signature' | 'claims' | 'account' (issued for another
 * account) | 'expired' (signature good, past exp: claims included).
 * `now` is in seconds.
 */
function verify(pass, { publicKey = PUBLIC_KEY, now = Date.now() / 1000, sub } = {}) {
  if (typeof pass !== 'string' || !pass) return { ok: false, reason: 'missing' };
  if (pass.length > 8192) return { ok: false, reason: 'malformed' };
  const parts = pass.split('.');
  if (parts.length !== 3 || parts.some(p => !/^[\w-]+$/.test(p)))
    return { ok: false, reason: 'malformed' };
  let header, claims;
  try {
    header = JSON.parse(fromB64url(parts[0]).toString('utf8'));
    claims = JSON.parse(fromB64url(parts[1]).toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (header?.alg !== 'EdDSA') return { ok: false, reason: 'malformed' };
  let good = false;
  try {
    good = crypto.verify(
      null,
      Buffer.from(parts[0] + '.' + parts[1]),
      keyOf(publicKey),
      fromB64url(parts[2])
    );
  } catch {
    good = false;
  }
  if (!good) return { ok: false, reason: 'signature' };
  if (
    !claims ||
    typeof claims !== 'object' ||
    !PLANS.has(claims.plan) ||
    typeof claims.exp !== 'number' ||
    typeof claims.iat !== 'number' ||
    claims.iat > now + SKEW
  )
    return { ok: false, reason: 'claims' };
  if (sub !== undefined && claims.sub !== sub) return { ok: false, reason: 'account' };
  const clean = {
    sub: String(claims.sub || ''),
    plan: claims.plan,
    status: typeof claims.status === 'string' ? claims.status : '',
    subscribed: claims.subscribed === true,
    features: Array.isArray(claims.features)
      ? claims.features.filter(f => typeof f === 'string')
      : [],
    limits: claims.limits && typeof claims.limits === 'object' ? claims.limits : {},
    founder: claims.founder === true,
    // past_due: when the paid features end unless the card is updated (seconds)
    graceEnds: claims.graceEnds > 0 ? Number(claims.graceEnds) : null,
    iat: claims.iat,
    exp: claims.exp,
  };
  if (claims.exp <= now) return { ok: false, reason: 'expired', claims: clean };
  return { ok: true, claims: clean };
}

module.exports = { verify, PUBLIC_KEY };
