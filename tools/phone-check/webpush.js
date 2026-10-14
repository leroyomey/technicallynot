// Sends one Web Push message with Web Crypto only (runs in a Cloudflare Worker and in Node 20+).
// Payload encryption: RFC 8291 (aes128gcm). Sender identification: VAPID, RFC 8292 (ES256).
// Part of the phone check: it answers "can a Worker send a
// sealed push with a signing key".
const te = new TextEncoder();
export const b64u = b =>
  btoa(String.fromCharCode(...new Uint8Array(b)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
export const unb64u = s =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const cat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

export async function hkdf(salt, ikm, info, len) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8)
  );
}

// sub: the browser's PushSubscription as JSON ({ endpoint, keys: { p256dh, auth } }). Returns the
// request body.
export async function encrypt(sub, plain) {
  const uaPublic = unb64u(sub.keys.p256dh),
    auth = unb64u(sub.keys.auth);
  const as = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey(
    'raw',
    uaPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
  const secret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256)
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const ikm = await hkdf(auth, secret, cat(te.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, cat(plain, Uint8Array.of(2)))
  ); // 2 = last record

  // record size 4096
  return cat(salt, Uint8Array.of(0, 0, 16, 0), Uint8Array.of(asPublic.length), asPublic, sealed);
}

// vapid: { jwk: the ECDSA P-256 private key as JWK, pub: its public key, raw, base64url }.
export async function vapidHeader(endpoint, vapid, now = Date.now()) {
  const key = await crypto.subtle.importKey(
    'jwk',
    vapid.jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
  const part = o => b64u(te.encode(JSON.stringify(o)));
  const head =
    part({ typ: 'JWT', alg: 'ES256' }) +
    '.' +
    part({
      aud: new URL(endpoint).origin,
      exp: Math.floor(now / 1000) + 3600,
      sub: 'https://technicallynot.ai',
    });
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te.encode(head));
  return `vapid t=${head}.${b64u(sig)}, k=${vapid.pub}`;
}

export async function send(sub, vapid, data) {
  const body = await encrypt(sub, te.encode(JSON.stringify(data)));
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    body,
    headers: {
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '3600',
      Urgency: 'high',
      Authorization: await vapidHeader(sub.endpoint, vapid),
    },
  });
  return { status: res.status, text: res.ok ? '' : (await res.text()).slice(0, 200) };
}
