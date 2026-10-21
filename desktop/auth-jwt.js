// Technically Not desktop · auth-jwt.js — Pure-Node sign-in helpers used by Technically Not sign-in
// (user-auth.js): random values, PKCE, constant-time compare and JSON over HTTPS with a size cap.
// The app never verifies an ID token itself: it sends it to the accounts server, which does. (An
// unused verifier, key cache and signer were removed, audit 2026-10-07, app-2 #10.) No Electron, no
// dependencies.
'use strict';
const crypto = require('crypto');

const b64url = buf =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = (bytes = 32) => b64url(crypto.randomBytes(bytes));
const sha256 = value => crypto.createHash('sha256').update(value).digest();

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

const MAX_RESPONSE = 512 * 1024;

// The response body as text, refused as soon as it passes the cap: a stated length over the cap is
// refused before reading, and reading stops at the cap, so a large answer never fills memory.
async function cappedText(response, host) {
  const tooLarge = () => new Error('Response too large from ' + host);
  const stated = Number(response.headers?.get?.('content-length'));
  if (stated > MAX_RESPONSE) throw tooLarge();
  if (!response.body || typeof response.body.getReader !== 'function') {
    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_RESPONSE) throw tooLarge();
    return text;
  }
  const reader = response.body.getReader(),
    parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    parts.push(Buffer.from(value));
  }
  return Buffer.concat(parts).toString('utf8');
}

// JSON over HTTPS with a timeout and a response size cap. `fetchImpl` defaults to the global fetch
// (Node 18+ / Electron).
async function fetchJson(url, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    ...options,
    redirect: 'error',
    signal: AbortSignal.timeout(options.timeoutMs || 15000),
  });
  const text = await cappedText(response, new URL(url).host);
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: response.status, ok: response.ok, body, headers: response.headers };
}

module.exports = {
  b64url,
  random,
  sha256,
  pkce,
  challengeOf,
  safeEqual,
  fetchJson,
};
