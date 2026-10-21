// Technically Not relay · hub.js — the meeting point: one RelayHub Durable Object passes sealed
// envelopes between the computers that hold this relay's secret. It reads no body and stores no
// message; it keeps the device id per socket and "last seen" per device.
//
// HARD RULE (cost): no timer and no alarm of any kind in this file. Either one keeps the object
// awake and billed around the clock; the test "no timer or alarm" fails on them. Sockets use the
// Hibernation API, and the text "ping" is answered by the runtime without waking the object.
//
// A plain class on purpose: importing "cloudflare:workers" would break the Node tests.
import { json, nowSec } from './util.js';

// seconds: a computer not connected and not heard for this long loses its record
const FORGET_AFTER = 90 * 86400;

// per device, tickets and list reads together: a reconnect loop cannot use up the day's free
// requests
const CALLS_PER_HOUR = 60;

// device ids the relay keeps a record of; one is forgotten 90 days after it was last seen
const MAX_IDS = 32;

// per socket; over it the sender gets rate_limited, over 4x the socket is closed
const MSG_PER_MIN = 120;

// characters per envelope: the app's 4,096-byte size step sealed and base64-encoded, plus the
// envelope fields
const MAX_MSG = 8192;
const MAX_SOCKETS = 8; // computers and phones connected at once

// device ids thrown out with the secret (revoke) that are kept refused
const MAX_REVOKED = 256;

// what computers send each other; the relay's own kinds are hello, presence, err and bye
const KINDS = new Set(['pair', 'hs', 'msg']);

// Close codes the app reads: 4001 replaced by a newer socket of the same device, 4008 flooding,
// 4009 thrown out with the secret (revoke), 4010 came in under the shared phone key, which is
// no longer taken (retirePhoneKey).

const isOpen = ws => ws.readyState === 1;

// How the id of every phone begins (index.js PHONE_ID_START).
const PHONE_ID_START = 'ph-';
const revokedKey = d => 'x:' + d;

// Older phone pages sign with one shared phone key, which speaks for every phone id. Once a phone
// proved with its own key, or a phone was thrown out, that key is no longer taken: "pk" is kept
// and a proof under the shared key is refused as "invalid_proof" (the words an older page already
// shows: check the secret under Change), with `why` for this build's page.
const PHONE_KEY_ENDED = 'pk';

// Nothing is kept in memory between calls (the object sleeps between them): the device id and the
// message count live on the socket's attachment, everything else in storage: "d:<device id>" =
// { i: the random part of the ticket issued last and not yet used, u: that of the ticket used last,
// p: newest proof time accepted, h and n: calls in hour h, seen }, and "k" = the key tickets are
// signed with.
export class RelayHub {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/ask') return this.ask(url);
    if (url.pathname === '/connect') return this.connect(url);
    if (url.pathname === '/presence') return this.presence();
    if (url.pathname === '/drop') return this.drop(url);
    if (url.pathname === '/revoke') return this.revoke(url);

    // asked by the Worker only (index.js ticketKeyOf); no call of a device is passed on to it
    if (url.pathname === '/key') return json(200, { k: await this.ticketKey() });
    return json(404, { error: 'not_found' });
  }

  // The key tickets are signed with: 32 random bytes as hex, made once and kept under "k". Only
  // the relay has it (this object and the Worker in front of it), never a device, so a holder of
  // the secret cannot sign a ticket (index.js says why that matters).
  async ticketKey() {
    const kept = await this.ctx.storage.get('k');
    if (typeof kept === 'string' && /^[0-9a-f]{64}$/.test(kept)) return kept;
    const made = [...crypto.getRandomValues(new Uint8Array(32))]
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('');
    await this.ctx.storage.put('k', made);
    return made;
  }

  sockets(deviceId) {
    return (deviceId ? this.ctx.getWebSockets(deviceId) : this.ctx.getWebSockets()).filter(isOpen);
  }
  deviceOf(ws) {
    return ws.deserializeAttachment()?.d ?? null;
  }
  online() {
    return [
      ...new Set(
        this.sockets()
          .map(ws => this.deviceOf(ws))
          .filter(Boolean)
      ),
    ];
  }
  send(ws, text) {
    try {
      ws.send(text);
    } catch {
      /* the socket went away meanwhile */
    }
  }
  say(ws, obj) {
    this.send(ws, JSON.stringify({ v: 1, ...obj }));
  }

  // A client can take seconds to see a close (it waits for the connection to end), so the reason
  // goes ahead of it as a message.
  shut(ws, code, reason) {
    if (code !== 1000) this.say(ws, { kind: 'bye', reason });
    try {
      ws.close(code, reason);
    } catch {
      /* already closed */
    }
  }
  tell(exceptDevice, obj) {
    for (const ws of this.sockets()) if (this.deviceOf(ws) !== exceptDevice) this.say(ws, obj);
  }

  // Before a ticket is made or the list is read: each proof of the secret counts once (a copied
  // request is refused, and told the newest time so an honest clock can step past it), one device
  // gets a limited number of calls an hour, and the relay knows a limited number of device ids (ids
  // are chosen by the caller, so without that a holder of the secret could fill the storage). p =
  // the proof's time in milliseconds; i = the random part of the ticket being issued, empty when
  // the call is a list read (which leaves an issued ticket alone).
  async ask(url) {
    const d = url.searchParams.get('d'),
      p = Number(url.searchParams.get('p')),
      i = url.searchParams.get('i') || '',
      // the kind of key that signed the proof: 'secret', 'device' or 'phone' (index.js proven)
      by = url.searchParams.get('b') || '';
    if (!d || !Number.isFinite(p)) return json(400, { error: 'invalid_proof' });

    // thrown out by the owner of the secret (revoke below): nothing of it is counted or kept
    if (await this.isRevoked(d)) return json(403, { error: 'device_revoked' });

    // the shared phone key after a phone moved to its own key, or after a phone was thrown out
    const phoneKeyEnded = !!(await this.ctx.storage.get(PHONE_KEY_ENDED));
    if (by === 'phone' && phoneKeyEnded)
      return json(401, { error: 'invalid_proof', why: 'phone_key_retired' });
    let rec = await this.ctx.storage.get('d:' + d);
    if (!rec) {
      // Full: first forget what is long gone, so a relay whose old computers are no longer used
      // does not stay full for ever; then refuse.
      if ((await this.forget()) >= MAX_IDS) return json(429, { error: 'too_many_ids' });
      rec = {};
    }
    const hour = Math.floor(nowSec() / 3600);
    if (p <= (rec.p || 0)) return json(401, { error: 'proof_used', after: rec.p });
    const n = rec.h === hour ? rec.n || 0 : 0;
    if (n >= CALLS_PER_HOUR) return json(429, { error: 'rate_limited' });

    // A phone proved with its own key: it has moved, so the shared key is no longer taken, and
    // sockets that came in under it are closed.
    if (by === 'device' && d.startsWith(PHONE_ID_START) && !phoneKeyEnded) await this.endPhoneKey();

    // `b` remembers which kind of key the issued ticket was asked with (connect marks the socket)
    await this.ctx.storage.put('d:' + d, {
      ...rec,
      p,
      h: hour,
      n: n + 1,
      ...(i ? { i, b: by } : {}),
    });

    // A list read is done here. A ticket is signed by the Worker, which is handed the key with
    // this yes (the Worker reads it and passes on only the ticket).
    if (!i) return json(200, { ok: true });
    return json(200, { ok: true, k: await this.ticketKey() });
  }

  async connect(url) {
    const d = url.searchParams.get('d'),
      r = url.searchParams.get('r') || '';
    if (!d || !r) return json(400, { error: 'invalid_ticket' });

    // Only the one ticket this relay issued last for the device, known by its random part, and
    // only once. (Every device holds the key tickets are signed with, so a signature alone is not
    // enough: a made-up ticket is not the issued one, and its random part cannot be guessed.)
    const rec = (await this.ctx.storage.get('d:' + d)) || {};
    if (r && r === rec.u) return json(401, { error: 'ticket_used' });
    if (!rec.i || r !== rec.i) return json(401, { error: 'invalid_ticket' });

    // A ticket asked for under the shared phone key just before that key ended (a move or a
    // phone revoke) lives a minute more: it opens nothing, and it is used up so it stays dead.
    if (rec.b === 'phone' && (await this.ctx.storage.get(PHONE_KEY_ENDED))) {
      await this.ctx.storage.put('d:' + d, { ...rec, i: '' });
      return json(401, { error: 'invalid_proof', why: 'phone_key_retired' });
    }

    // The limit first: a refused connect must not close the device's working socket.
    if (this.sockets().filter(ws => this.deviceOf(ws) !== d).length >= MAX_SOCKETS)
      return json(429, { error: 'too_many_devices' });
    for (const old of this.sockets(d)) this.shut(old, 4001, 'replaced'); // one socket per device
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], [d]);

    // `pk`: this socket came in under the shared phone key (endPhoneKey closes it)
    pair[1].serializeAttachment({ d, w: nowSec(), n: 0, ...(rec.b === 'phone' ? { pk: 1 } : {}) });
    await this.ctx.storage.put('d:' + d, { ...rec, i: '', u: r, seen: nowSec() });
    this.say(pair[1], { kind: 'hello', device: d, online: this.online().filter(x => x !== d) });

    // Told every time, also when this socket replaced one the relay still held (a computer back
    // from sleep): the others cannot know their session with it is gone, and without this nobody
    // starts a new one.
    this.tell(d, { kind: 'presence', device: d, online: true });
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  // Routing only: `from` must be the socket's own device, `to` a connected device of this relay.
  async webSocketMessage(ws, message) {
    const at = ws.deserializeAttachment() || {},
      now = nowSec();
    if (now - at.w >= 60) {
      at.w = now;
      at.n = 0;
    }
    at.n++;
    ws.serializeAttachment(at);

    // a broken sender must not keep the object awake
    if (at.n > MSG_PER_MIN * 4) return this.shut(ws, 4008, 'flooding');
    if (at.n > MSG_PER_MIN)
      return this.say(ws, {
        kind: 'err',
        code: 'rate_limited',
        retry: Math.max(1, at.w + 60 - now),
      });
    if (typeof message !== 'string') return this.say(ws, { kind: 'err', code: 'invalid' });
    if (message.length > MAX_MSG) return this.say(ws, { kind: 'err', code: 'too_large' });
    let m = null;
    try {
      m = JSON.parse(message);
    } catch {
      /* refused below */
    }
    if (
      !m ||
      !Number.isInteger(m.v) ||
      !KINDS.has(m.kind) ||
      m.from !== at.d ||
      typeof m.to !== 'string' ||
      !m.to ||
      m.to.length > 64 ||
      m.to === at.d ||
      typeof m.body !== 'string'
    )
      return this.say(ws, { kind: 'err', code: 'invalid' });
    const targets = this.sockets(m.to);

    // nothing queues: the sender is told
    if (!targets.length) return this.say(ws, { kind: 'err', code: 'offline', to: m.to });
    for (const target of targets) this.send(target, message);
  }

  async webSocketClose(ws) {
    await this.gone(ws);
    this.shut(ws, 1000, 'bye');
  }
  async webSocketError(ws) {
    await this.gone(ws);
  }

  // thrown out with the secret (revoke below)
  async isRevoked(d) {
    return !!(await this.ctx.storage.get(revokedKey(d)));
  }

  async gone(ws) {
    const d = this.deviceOf(ws);

    // a newer socket of the same device is still here
    if (!d || this.sockets(d).some(o => o !== ws)) return;

    // Thrown out: revoke removed its record and told the others already. The close that answers
    // revoke's own close must not write "seen" back, or the id is listed again and counts toward
    // the 32 ids for 90 days.
    if (await this.isRevoked(d)) return;
    const seen = nowSec(),
      rec = (await this.ctx.storage.get('d:' + d)) || {};
    await this.ctx.storage.put('d:' + d, { ...rec, seen });
    this.tell(d, { kind: 'presence', device: d, online: false, last_seen: seen });
  }

  // Records of devices that are not connected and were last heard of more than FORGET_AFTER ago
  // are removed. Returns how many records are left. Bounded work, no timer: it runs when the list
  // is read and when a new device id arrives at a full relay.
  async forget() {
    const on = new Set(this.online());
    let left = 0;
    for (const [key, rec] of await this.ctx.storage.list({ prefix: 'd:' })) {
      const last = rec?.seen ?? Math.floor((rec?.p || 0) / 1000);
      if (!on.has(key.slice(2)) && nowSec() - last > FORGET_AFTER)
        await this.ctx.storage.delete(key);
      else left++;
    }
    return left;
  }

  // One device's record is removed at a user's word (the app's Remove on an unpaired computer, or
  // check.mjs cleaning up after itself). A connected device is not removed: it would only come
  // back at once, and the user would see the Remove do nothing.
  async drop(url) {
    const d = url.searchParams.get('d');
    if (!d) return json(400, { error: 'invalid_device' });
    if (this.online().includes(d)) return json(409, { error: 'online' });
    const had = await this.ctx.storage.delete('d:' + d);
    return json(200, { ok: true, removed: !!had });
  }

  // One device thrown out at the word of the secret's owner (index.js revoke): "x:<id>" is kept,
  // its record goes, its socket is closed (4009) and the others are told it is offline. Every
  // later call of that id is refused in ask(). undo lets it in again. p is the proof's time; only
  // a newer one than the last revoke proof is taken ("rp"), so a copied call does nothing.
  //
  // A phone id throws out that phone alone, and ends the shared phone key of older phone pages
  // (endPhoneKey): the lost phone may still hold that key, which would sign for a new phone id at
  // once. Phones that already keep their own key stay; phones still on the shared key must type
  // the secret again. The answer says `phone_key_ended: true` so the tool can say so. Undo lets
  // the phone back; the shared key stays ended.
  async revoke(url) {
    const d = url.searchParams.get('d'),
      p = Number(url.searchParams.get('p')),
      undo = url.searchParams.get('undo') === '1';
    if (!d || !Number.isFinite(p)) return json(400, { error: 'invalid_proof' });
    const last = (await this.ctx.storage.get('rp')) || 0;
    if (p <= last) return json(401, { error: 'proof_used', after: last });
    await this.ctx.storage.put('rp', p);
    const phone = d.startsWith(PHONE_ID_START);
    const mark = revokedKey(d);
    if (undo) {
      const had = await this.ctx.storage.delete(mark);
      return json(200, { ok: true, revoked: false, changed: !!had });
    }
    if (!(await this.ctx.storage.get(mark))) {
      const held = (await this.ctx.storage.list({ prefix: 'x:' })).size;
      if (held >= MAX_REVOKED) return json(429, { error: 'too_many_revoked' });
      await this.ctx.storage.put(mark, nowSec());
    }
    await this.ctx.storage.delete('d:' + d);
    const open = this.sockets(d);
    for (const ws of open) this.shut(ws, 4009, 'revoked');
    if (open.length)
      this.tell(d, { kind: 'presence', device: d, online: false, last_seen: nowSec() });
    if (!phone) return json(200, { ok: true, revoked: true });
    await this.endPhoneKey();
    return json(200, { ok: true, revoked: true, phone_key_ended: true });
  }

  // The shared phone key of older phone pages is no longer taken (PHONE_KEY_ENDED): kept once,
  // and every socket that came in under it is closed (4010), the others told it is offline.
  async endPhoneKey() {
    if (!(await this.ctx.storage.get(PHONE_KEY_ENDED)))
      await this.ctx.storage.put(PHONE_KEY_ENDED, nowSec());
    for (const ws of this.sockets()) {
      const at = ws.deserializeAttachment() || {};
      if (!at.pk) continue;
      this.shut(ws, 4010, 'phone_key_retired');
      if (!this.sockets(at.d).some(o => o !== ws))
        this.tell(at.d, { kind: 'presence', device: at.d, online: false, last_seen: nowSec() });
    }
  }

  async presence() {
    await this.forget();
    const on = new Set(this.online()),
      devices = [];
    for (const [key, rec] of await this.ctx.storage.list({ prefix: 'd:' })) {
      const id = key.slice(2);
      if (on.has(id) || rec?.seen)
        devices.push({ id, online: on.has(id), last_seen: on.has(id) ? nowSec() : rec.seen });
    }
    return json(200, { devices });
  }
}
