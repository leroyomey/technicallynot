// Technically Not relay · util.js — the few helpers the relay needs: time, base64, a keyed hash
// and a comparison that takes the same time whatever the two texts are.
const enc = new TextEncoder();

export const nowSec = () => Math.floor(Date.now() / 1000);

export function b64url(text) {
  const bytes = enc.encode(text);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(str) {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(out);
}

// Keys made ready for signing, so the same one is not made ready at every call. Only a few are
// kept: one of them is worked out from the host name of each call before the call is proven, so
// without a limit a stranger calling under many names would leave a key in memory for each.
const KEYS_KEPT = 16;
const keys = new Map();

// HMAC-SHA-256 of `data` under `secret`, as hex.
export async function hmacHex(secret, data) {
  let key = keys.get(secret);
  if (!key) {
    // room for the new one: the key that was made ready first goes (a Map keeps that order)
    if (keys.size >= KEYS_KEPT) keys.delete(keys.keys().next().value);
    key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    keys.set(secret, key);
  }
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
  return [...sig].map(b => b.toString(16).padStart(2, '0')).join('');
}

// How many keys are kept ready right now (the tests read it).
export const keysKept = () => keys.size;

export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
