// Technically Not phone app · app.mjs — the first pages: welcome, needs you, computers, add a
// computer (camera scan), almost paired (the six digits), paired. All rules live in ../src and are
// run by the tests in tools/: pairing (pair.mjs), the key store (keys.mjs), the connection and the
// encrypted sessions (link.mjs), what each computer says needs you and the answers (needs.mjs).
// This file only shows screens, reads the camera and hands messages over. What it does NOT have
// yet: signing in, the real relay (it talks to the address it was served from, the stand-in relay
// of tools/phone-pair-try, where a "room" is one test computer), agents, activity, notifications,
// the app lock. Two habits of this file, both learned from mistakes found in review:
// - The connection is never steered step by step. The page keeps what it WANTS (which room, a
// pairing under way, the screen visible) and sync() brings the link there, one change after
// another. Nobody else calls the link's stop, hold or resume.
// - A pairing run has a number. Every step looks at it again after every wait; a cancel just moves
// the number on. Timers: one a second while the digits show, one every 250 ms while the camera
// looks, one every 30 s while Needs you is open.
import { keyStore, idbBackend, onStoreChange } from '../src/keys.mjs';
import { scanPairing, readCode } from '../src/pair.mjs';
import { createLink } from '../src/link.mjs';
import { createNeeds } from '../src/needs.mjs';
import { createOwnRelay } from '../src/own-relay.mjs';
import { icon } from './icons.mjs';

const $ = id => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const WHY = {
  expired: 'The two minutes ran out before the digits were typed.',
  cancelled: 'Pairing was cancelled.',
  already_paired:
    'This phone already knows a computer with that name tag but a different key. Forget it first, then scan again.',
  handshake: 'The secure connection with the computer could not be made. The code may be damaged.',
  not_stored:
    'This phone could not save the computer, so it did not answer. Free some storage and try again.',
  relay: 'The relay could not be reached. Check the connection and try again.',
  offline: 'That computer is not connected. Is its Add a phone page still open?',
  code: 'That is not a Technically Not pairing code.',
};
const KIND = {
  permission: 'Asks permission',
  trust: 'Asks to trust a folder',
  question: 'Asks a question',
  menu: 'Asks you to choose',
  error: 'Stopped on an error',
  draft: 'Has a draft waiting',
  other: 'Needs you',
};
const REFUSED = {
  not_allowed: 'That computer does not let this phone answer. It is switched on at the computer.',
  refused: 'The computer did not take the answer. The question may have changed: read it again.',
  failed: 'The computer could not hand the answer to the agent. Look at the computer.',
  no_reply:
    'The computer has not confirmed the answer. Look at the computer before answering again.',
};
const NOT_SENT = {
  not_live: 'Not sent: that computer is not connected right now.',
  not_sent: 'Not sent: there is no session with that computer at this moment.',
  gone: 'That question changed or is no longer open.',
  again: 'Already answered.',
  kind: 'This one is answered at the computer.',
  bad: 'Not sent.',
};

let store,
  link,
  needs,
  own,
  myId = '';

// "Use my own relay": what the page may know of it ({ set, url }, never the secret), why the link
// last stopped, and whether the remove button has been pressed once.
let relayInfo = { set: false, url: '' },
  connReason = null,
  removeAsked = false,
  editingRelay = false;
let screen = '',
  conn = 'off',
  camera = null,
  scanning = false,
  cameraRun = 0,
  ticking = 0,
  agoTimer = 0;

// A pairing run: `busy` from the scan to its end, `runSeq` its number, `run` the pairing itself
// once the key is read.
let busy = false,
  runSeq = 0,
  run = null,
  runPc = null,
  runLive = false;

// The stand-in relay's room. `tryRoom` is the room of a run under way, in memory only: it is
// written down when the pairing is done, so a scan that fails, is cancelled or was never honest
// cannot move the phone away from the computer it has.
let savedRoom = null,
  tryRoom = null,
  liveRoom = null;
const peers = new Map(),
  known = new Map(),
  cards = new Map(),
  localNote = new Map();

const phoneName = () =>
  /iPhone|iPad/.test(navigator.userAgent)
    ? 'iPhone'
    : /Android/.test(navigator.userAgent)
      ? 'Android phone'
      : 'Phone';
const limit = (p, ms = 8000) =>
  new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('the store did not answer')), ms);
    Promise.resolve(p).then(
      v => {
        clearTimeout(t);
        res(v);
      },
      e => {
        clearTimeout(t);
        rej(e);
      }
    );
  });

// ---- what the page wants of the connection, and the one place that makes it so ----
let applying = Promise.resolve();

function sync() {
  applying = applying.then(apply, apply);
  return applying;
}

async function apply() {
  // With an own relay there are no rooms: the link goes to that relay's address. Without one it is
  // the stand-in relay's room, as before.
  const room = relayInfo.set ? own.wsUrl() : tryRoom || savedRoom,
    // one socket only while the app is open; a pairing under way is not cut off by a dimmed screen
    up = !!room && (!document.hidden || busy);
  if (!up) {
    liveRoom = null;
    return link.stop().catch(() => {});
  }
  if (liveRoom !== room) {
    await link.stop().catch(() => {});
    liveRoom = room;
  }
  await link.hold(busy).catch(() => {});
  await link.resume().catch(() => {});
}

// ---- screens ----
function show(name) {
  screen = name;
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.dataset.s !== name;
  for (const t of document.querySelectorAll('.tab'))
    t.classList.toggle('on', t.dataset.tab === name);
  if (name !== 'scan') stopCamera();
  if (name !== 'digits') {
    clearInterval(ticking);
    ticking = 0;
  }
  clearInterval(agoTimer);
  agoTimer = 0;
  if (name === 'needs') {
    paintNeeds();
    agoTimer = setInterval(paintNeeds, 30000);
  }
  if (name === 'computers') listComputers();
  if (name === 'scan') startCamera();
}

function tabs() {
  for (const nav of document.querySelectorAll('.tabs'))
    for (const [key, ic, label, on] of [
      ['needs', 'bell', 'Needs you', true],
      ['agents', 'bot', 'Agents', false],
      ['activity', 'clock', 'Activity', false],
      ['computers', 'network', 'Computers', true],
    ]) {
      const b = el('button', 'tab'),
        em = el('em');
      b.dataset.tab = key;
      em.append(icon(ic));
      if (key === 'needs') {
        const u = el('u', 'badge');
        u.hidden = true;
        em.append(u);
      }
      b.append(em, label);
      if (on) b.onclick = () => show(key);
      else {
        b.disabled = true;
        b.title = 'Comes with a later build';
      }
      nav.append(b);
    }
}

// ---- computers ----
async function loadKnown() {
  const all = await store.pairings().catch(() => null);
  if (all) {
    known.clear();
    for (const p of all) known.set(p.id, p);
  }
  return all || [];
}

async function listComputers() {
  const all = await loadKnown(),
    box = $('list');
  box.textContent = '';
  for (const p of all) {
    const card = el('div', 'surf pcrow');
    card.dataset.id = p.id;
    const text = el('div'),
      forget = el('button', 'btn danger', 'Forget');
    text.append(
      el('b', '', pcLabel(p.id)),
      el('span', 'meta status'),
      el(
        'span',
        'meta',
        (p.how === 'scan' ? 'Paired by scan' : 'Added by another computer') +
          ' · ' +
          new Date(p.since).toLocaleDateString()
      )
    );
    forget.onclick = async () => {
      forget.disabled = true;
      await link.forget(p.id).catch(() => {});
      peers.delete(p.id);
      needs.forget(p.id);
      await listComputers();
      paintNeeds();
    };
    card.append(text, forget);
    box.append(card);
  }
  paintComputers();
}
const heardAt = t =>
  t ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

function paintComputers() {
  for (const card of $('list').children) {
    const s = peers.get(card.dataset.id),
      status = card.querySelector('.status'),
      heard = s && s.heard ? ' · last heard ' + heardAt(s.heard) : '';
    status.textContent =
      conn !== 'online'
        ? 'This phone is not connected' + heard
        : s && s.session
          ? 'Connected · encrypted session'
          : s && s.online
            ? 'Connected · making the session…'
            : 'Not connected' + heard;
    status.classList.toggle('on', conn === 'online' && !!(s && s.session));
  }
}

// ---- needs you: every open item of every computer with a session, answered here when its kind
// allows ----
const ago = since => {
  if (!since) return '';
  const m = Math.max(0, Math.round((Date.now() - since) / 60000));
  return m < 1
    ? 'now'
    : m < 60
      ? m + 'm'
      : m < 1440
        ? Math.round(m / 60) + 'h'
        : Math.round(m / 1440) + 'd';
};

// A card is one prompt: its computer, its id and its binding (needs.mjs `of`). A new prompt under
// an old id is a new card.
const keyOf = (peer, it) => peer + '\n' + it.id + '\n' + it.of;

// Two computers may give themselves the same name, and one may be known only on another's word: a
// card always says which it is.
function pcLabel(id) {
  const pc = known.get(id),
    name = (pc && pc.name) || 'Computer';
  const twin = [...known.values()].some(p => p.id !== id && (p.name || 'Computer') === name);
  const by = pc && pc.how === 'introduced' ? known.get(pc.by) : null;
  return (
    name +
    (twin ? ' (' + id.slice(-4) + ')' : '') +
    (pc && pc.how === 'introduced' ? ' · added by ' + ((by && by.name) || 'another computer') : '')
  );
}

async function answer(peer, it, say) {
  const key = keyOf(peer, it);
  localNote.delete(key);
  const r = await needs.answer(peer, it.id, it.of, say);
  if (r !== 'sent') localNote.set(key, NOT_SENT[r] || 'Not sent.');
  paintNeeds();
  return r === 'sent';
}

function makeCard(peer, it) {
  const art = el('article', 'surf wait'),
    who = el('div', 'who'),
    names = el('div'),
    c = { art, way: it.way, controls: [] };
  c.tile = el('span', 'tile');
  c.name = el('b');
  c.meta = el('span', 'meta');
  c.ago = el('span', 'ago');
  c.q = el('p', 'q');
  c.note = el('p', 'note');
  names.append(c.name, c.meta);
  who.append(c.tile, names, c.ago);
  art.append(who, c.q);
  if (it.way === 'choice') {
    // a permission prompt whose text this phone was sent: the one thing answered from here
    const acts = el('div', 'acts'),
      y = el('button', 'btn pri', 'Allow'),
      n = el('button', 'btn', 'Deny');
    y.onclick = () => answer(peer, it, 'yes');

    // the prompt this card was made for, never "whatever is under that id now"
    n.onclick = () => answer(peer, it, 'no');
    acts.append(y, n);
    art.append(acts);
    c.controls.push(y, n);
  }
  art.append(c.note);
  return c;
}

function paintNeeds() {
  const views = needs.all(),
    rows = [];
  for (const v of views) for (const it of v.items) rows.push({ v, it, key: keyOf(v.peer, it) });
  rows.sort((a, b) => (b.it.since || 0) - (a.it.since || 0));
  const sessions = [...peers.values()].filter(s => s.session).length,
    box = $('needsList');
  $('kWait').textContent = String(rows.length);
  $('kPcs').textContent = sessions + ' of ' + known.size;
  for (const u of document.querySelectorAll('.tab .badge')) {
    u.hidden = !rows.length;
    u.textContent = String(rows.length);
  }
  const keep = new Set(rows.map(r => r.key));
  for (const [key, c] of cards)
    if (!keep.has(key)) {
      c.art.remove();
      cards.delete(key);
      localNote.delete(key);
    }
  let before = null;
  for (const { v, it, key } of [...rows].reverse()) {
    // placed from the last to the first, so the order on screen follows `rows` without moving a
    // card that is being typed in more than needed
    let c = cards.get(key);
    if (!c) cards.set(key, (c = makeCard(v.peer, it)));
    const pcName = pcLabel(v.peer),
      live = v.state === 'live',
      agent = it.agent || 'An agent';
    c.tile.textContent = agent.slice(0, 1).toUpperCase();
    c.name.textContent = agent;
    c.meta.textContent =
      (KIND[it.kind] || KIND.other) + ' · ' + pcName + (it.inferred ? ' · inferred' : '');
    c.ago.textContent = ago(it.since);
    c.q.textContent = it.detail || 'This computer does not send the question text to this phone.';
    c.art.classList.toggle('asleep', !live);
    const state = it.answer || '',
      waiting = state === 'sending' || state === 'sent' || state === 'done';
    for (const x of c.controls) x.disabled = !live || waiting;
    c.note.textContent = !live
      ? pcName +
        ' was last heard ' +
        (heardAt(v.heard) || 'a while ago') +
        '. You can answer when it is back; nothing is sent in the meantime.'
      : state === 'sending'
        ? 'Sending…'
        : state === 'sent'
          ? 'Sent. Waiting for the computer to take it…'
          : state === 'done'
            ? 'Answered.'
            : state.startsWith('refused:')
              ? REFUSED[state.slice(8)] || 'The computer did not take the answer.'
              : localNote.get(key) ||
                (it.way
                  ? ''
                  : !it.detail
                    ? 'Without its text it is answered at the computer.'
                    : it.inferred
                      ? 'The computer is not sure of this one, so it is answered there.'
                      : 'This one is answered at the computer.');
    c.note.hidden = !c.note.textContent;
    if (c.art.nextSibling !== before || c.art.parentNode !== box) box.insertBefore(c.art, before);
    before = c.art;
  }
  const none = !rows.length;
  box.hidden = none;
  $('needsClear').hidden = !none;
  if (none) {
    const n = known.size;
    $('clearTitle').textContent = !n
      ? 'No computer yet'
      : !sessions
        ? 'Nothing to show'
        : 'Nothing needs you';
    $('clearText').textContent = !n
      ? 'Pair this phone with a computer to see what needs you there.'
      : !sessions
        ? (n === 1
            ? 'Your computer is not connected right now.'
            : 'None of your ' + n + ' computers is connected right now.') +
          ' Nothing is reported while a computer is away.'
        : sessions +
          ' of ' +
          n +
          (n === 1 ? ' computer is' : ' computers are') +
          ' connected and ' +
          (sessions === 1 ? 'reports' : 'report') +
          ' nothing open.';
    $('clearGo').textContent = n ? 'Computers' : 'Add a computer';
  }
}

// ---- the camera: found codes go to begin(); without a code reader the paste box shows ----
// The phone's own code reader, used where the browser has none (Safari on an iPhone): the middle
// square of the camera picture, the part the screen shows, goes to a worker that hands back the
// text it read (qr-worker.js says why a worker). It answers like the browser's reader, so the loop
// below is one loop. `dead` means the worker cannot be started here, and the paste box takes over.
// Each look takes the picture at another size: a large one reads a dense code, a small one evens
// out the grain of a dim room (tools/phone-qr-test.mjs shows neither size reads everything).
const OWN_SIDES = [720, 360, 540],
  OWN_WAIT = 4000,
  OWN_TRIES = 3;
let ownQr = null;

function ownReader() {
  const canvas = document.createElement('canvas'),
    ctx = canvas.getContext('2d', { willReadFrequently: true });
  let w = null,
    seq = 0,
    done = null,
    fails = 0;
  const end = () => {
    if (w) {
      w.terminate();
      w = null;
    }
    if (done) done(null);
  };
  const self = {
    dead: !ctx,
    async detect(video) {
      const vw = video.videoWidth,
        vh = video.videoHeight;
      if (!vw || !vh || self.dead) return []; // no picture yet
      const side = Math.min(vw, vh),
        size = Math.min(side, OWN_SIDES[seq % OWN_SIDES.length]);
      if (canvas.width !== size) canvas.width = canvas.height = size;
      ctx.imageSmoothingQuality = 'high'; // set again: a canvas forgets it when its size changes
      ctx.drawImage(video, (vw - side) / 2, (vh - side) / 2, side, side, 0, 0, size, size);
      const px = ctx.getImageData(0, 0, size, size).data,
        n = ++seq;
      if (!w) {
        try {
          w = new Worker('qr-worker.js');
        } catch {
          self.dead = true;
          return [];
        }
        w.onmessage = e => {
          if (e.data && e.data.n === seq && done) {
            fails = 0;
            done(e.data.text);
          }
        };
        w.onerror = () => {
          if (++fails >= OWN_TRIES) self.dead = true;
          end();
        };
      }
      const text = await new Promise(res => {
        // A picture that takes too long is given up, and the worker with it: the next look starts a
        // fresh one.
        const t = setTimeout(() => {
          if (++fails >= OWN_TRIES) self.dead = true;
          end();
        }, OWN_WAIT);
        done = v => {
          clearTimeout(t);
          done = null;
          res(v);
        };
        w.postMessage({ n, data: px.buffer, width: size, height: size }, [px.buffer]);
      });
      return typeof text === 'string' && text ? [{ rawValue: text }] : [];
    },
    close: end,
  };
  return self;
}

async function startCamera() {
  // a later call takes over: a stream that arrives for an older one is stopped, never left running
  const mine = ++cameraRun;
  $('scanErr').textContent = '';
  $('pasteBox').hidden = true;
  $('camNote').textContent = 'Starting the camera…';
  $('view').classList.remove('live');

  // `#reader=own` at the end of the address picks the phone's own reader where the browser has one
  // too: the way to try it on Android.
  const builtIn =
    location.hash !== '#reader=own' &&
    'BarcodeDetector' in window &&
    (await BarcodeDetector.getSupportedFormats().catch(() => [])).includes('qr_code');
  if (mine !== cameraRun) return;
  if ((!builtIn && !window.Worker) || !navigator.mediaDevices) {
    $('camNote').textContent = 'This browser cannot read a code with the camera.';
    $('pasteBox').hidden = false;
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    });
  } catch {
    if (mine === cameraRun) {
      $('camNote').textContent =
        'The camera is not allowed. Allow it for this page, or paste the code.';
      $('pasteBox').hidden = false;
    }
    return;
  }
  if (mine !== cameraRun || screen !== 'scan') {
    for (const t of stream.getTracks()) t.stop();
    return;
  } // the screen was left, or a newer start took over, while the camera started
  stopCamera();
  cameraRun = mine;
  camera = stream;
  const video = $('cam');
  video.srcObject = camera;
  await video.play().catch(() => {});
  if (mine !== cameraRun) return;
  $('view').classList.add('live');
  const reader = builtIn ? new BarcodeDetector({ formats: ['qr_code'] }) : (ownQr = ownReader());
  scanning = true;
  const look = async () => {
    if (!scanning || mine !== cameraRun) return;
    const found = await reader.detect(video).catch(() => []);

    // the screen was left, or a pasted code began a run, while this look was under way
    if (!scanning || mine !== cameraRun) return;
    if (reader.dead) {
      $('scanErr').textContent =
        'This browser cannot read a code with the camera. Paste the code instead.';
      $('pasteBox').hidden = false;
      return;
    }
    const hit = found.map(f => f.rawValue).find(t => readCode(t));
    if (hit) return begin(hit);
    if (found.length) $('scanErr').textContent = WHY.code;
    setTimeout(look, 250);
  };
  look();
}

function stopCamera() {
  scanning = false;
  cameraRun++;
  if (ownQr) {
    ownQr.close();
    ownQr = null;
  }
  if (camera) {
    for (const t of camera.getTracks()) t.stop();
    camera = null;
  }
  $('cam').srcObject = null;
  $('view').classList.remove('live');
}

// ---- one pairing run: its messages travel over the link's connection, as they will with the real
// relay ----
const sendAll = async (to, msgs) => {
  for (const body of msgs || []) if (!(await link.sendPair(to, body))) return false;
  return true;
};
const untilOnline = ms =>
  new Promise(res => {
    const end = Date.now() + ms,
      t = setInterval(() => {
        if (conn === 'online' || Date.now() > end) {
          clearInterval(t);
          res(conn === 'online');
        }
      }, 100);
  });

// Ends a run, however it ends. The number moves on, so every step of it that is still waiting
// somewhere stops when it wakes.
function endRun() {
  runSeq++;
  busy = false;
  run = null;
  runPc = null;
  runLive = false;
  tryRoom = null;
  clearInterval(ticking);
  ticking = 0;
}

function fail(why) {
  if (run) run.cancel();
  endRun();
  sync();
  $('failText').textContent = WHY[why] || 'Pairing ended (' + why + ').';
  show('failed');
}

// Cancel, Back or leaving. A run that is already done (the computer is stored; the screen had not
// caught up yet) is not thrown away: it finishes as it would have a moment later.
function closeRun() {
  if (run && run.state === 'done') return finish(run);
  if (run) run.cancel();
  endRun();
  sync();
}

function finish(r) {
  const res = r.result(),
    id = res.peer;
  $('pairedTitle').textContent = 'Paired with ' + (res.name || 'the computer');
  $('pairedName').textContent = res.name || 'Computer';
  $('pairedMeta').textContent = 'Paired by scan · just now';
  savedRoom = id;
  store.setNote('room', id).catch(() => {}); // only now is the room written down
  endRun();

  // The computer is in the store now: its first session starts on this same connection, then the
  // connection is what it should be.
  link
    .ensure(id)
    .catch(() => {})
    .then(() => sync());
  loadKnown().then(() => {
    paintNeeds();
  });
  show('paired');
}

async function begin(code) {
  if (busy) return; // one run at a time
  stopCamera();
  const pc = readCode(code);
  if (!pc) {
    $('failText').textContent = WHY.code;
    return show('failed');
  }
  const mine = ++runSeq,
    gone = () => mine !== runSeq;
  busy = true;
  run = null;
  runPc = pc.id;
  runLive = false;
  tryRoom = pc.id; // set before the first wait: a cancel from now on is seen
  $('digitsFor').textContent = 'Code scanned';
  $('digitsText').textContent = '······';
  $('digitsNote').textContent = 'Making the secure connection…';
  show('digits');
  let key;
  try {
    key = await limit(store.identity());
  } catch {
    return gone() ? undefined : fail('not_stored');
  }
  if (gone()) return;
  let r;
  try {
    r = scanPairing({ self: { id: myId, ...key }, name: phoneName(), code, store });
  } catch {
    return fail('code');
  }
  run = r;

  // the stand-in relay names a room after the computer; the real relay will route by the account
  // instead
  await sync();
  if (gone()) return;
  if (!(await untilOnline(12000))) return gone() ? undefined : fail('relay');
  if (gone()) return;
  runLive = true;
  const first = await r.start();
  if (gone()) return;
  if (first.ended) return fail(first.ended);
  if (!(await sendAll(pc.id, first.send))) return gone() ? undefined : fail('relay');
  if (gone()) return;
  clearInterval(ticking);
  ticking = setInterval(update, 1000); // the digits run out on the clock, with or without a message
  update();
}

async function onPair(from, obj) {
  const r = run;
  if (!r || from !== runPc) return;
  const res = await r.receive(obj, from);
  if (run !== r && r.state !== 'done') return;

  // Done: the computer is stored, and the message that goes out now is what tells the computer so.
  // The link must know the new pairing BEFORE that message leaves, or the computer's first
  // handshake could arrive at a link that does not know it yet.
  if (r.state === 'done') await link.refresh().catch(() => {});
  await sendAll(from, res.send);
  if (run === r) update();
}

function update() {
  const r = run;
  if (!r) return;
  if (r.state === 'done') return finish(r);
  if (r.state === 'ended') return fail(r.reason || 'expired');
  const d = r.shows;
  if (d) {
    $('digitsText').textContent = d.slice(0, 3) + ' ' + d.slice(3);
    $('digitsNote').textContent = 'The computer is showing a box for them now.';
  } else if (r.state === 'show') {
    $('digitsText').textContent = '······';
    $('digitsNote').textContent = 'The two minutes are over. Waiting a moment for the computer…';
  }
}

// ---- your own relay: the card on the Computers screen ----
// The same sentences as the desktop's Devices page.
const RELAY_ERR = {
  bad_url:
    'The address must start with https:// and have no path, for example https://my-relay.example.workers.dev.',
  bad_secret: 'The secret must be 32 to 200 characters long, with no spaces.',
  not_saved: 'It could not be saved. Try again.',
  invalid_proof: 'Your relay refused the secret. Check the address and the secret under Change.',
  relay_not_set_up: 'Your relay has no secret yet. Finish its setup, then connect again.',
  clock_off: "This phone's clock is more than two minutes off. Set the time, then connect again.",
  too_many_ids:
    'Your relay knows too many devices. Set a new secret on the relay and here; your pairings stay.',
  refused: 'No relay answers at that address. Check the address under Change.',
  device_required: 'This phone has no device id yet. Close the app and open it again.',
  network: 'The relay could not be reached. Check the connection and try again.',
};
const RELAY_CONN = {
  online: 'Connected through your relay.',
  connecting: 'Connecting…',
  off: 'Connects once a computer is paired.',
  waiting: 'Not connected right now. It tries again by itself.',
};

// Shows the saved line, or the two fields. `problem` is a sentence to show under them.
function paintRelay(problem = '') {
  if (!$('relayBox')) return;
  const shown = relayInfo.set && !editingRelay;
  for (const id of ['relayLine', 'relayMeta', 'relayChange', 'relayRemove']) $(id).hidden = !shown;
  for (const id of ['relayUrlBox', 'relaySecretBox', 'relaySave']) $(id).hidden = shown;
  $('relayLine').textContent =
    'Through your own relay: ' + relayInfo.url.replace(/^https?:\/\//, '');
  $('relayRemove').textContent = removeAsked ? 'Press again to remove' : 'Remove';
  const stopped = conn === 'stopped' && RELAY_ERR[connReason];
  $('relayMeta').textContent = relayInfo.set && !stopped ? RELAY_CONN[conn] || '' : '';
  $('relayErr').textContent = problem || (relayInfo.set && stopped ? RELAY_ERR[connReason] : '');
}

// Anything that changed the relay: the link goes to the new address (or back to the rooms).
async function relayChanged() {
  removeAsked = false;
  paintRelay();
  await sync();
}

function relaySetup() {
  $('relaySave').onclick = async () => {
    $('relaySave').disabled = true;
    const saved = await own.set($('relayUrl').value, $('relaySecret').value);
    if (!saved.ok) {
      $('relaySave').disabled = false;
      return paintRelay(RELAY_ERR[saved.error]);
    }

    // the secret is in the key now: clear the field, and ask the relay once so a wrong secret or
    // address shows here and not as a link that never comes up
    $('relaySecret').value = '';
    $('relayUrl').value = '';
    editingRelay = false;
    relayInfo = await own.get();
    $('relaySave').disabled = false;
    await relayChanged();
    try {
      const list = await own.check(myId);
      $('relayMeta').textContent =
        'The relay answered · ' +
        list.length +
        (list.length === 1 ? ' device' : ' devices') +
        ' connected';
    } catch (e) {
      paintRelay(RELAY_ERR[e?.code] || RELAY_ERR.network);
    }
  };
  $('relayChange').onclick = () => {
    editingRelay = true;
    removeAsked = false;
    paintRelay();
  };
  $('relayRemove').onclick = async () => {
    if (!removeAsked) {
      removeAsked = true;
      return paintRelay();
    }
    const gone = await own.clear();
    if (!gone.ok) return paintRelay(RELAY_ERR.not_saved);
    relayInfo = await own.get();
    editingRelay = false;
    await relayChanged();
  };
  paintRelay();
}

// ---- start ----
async function main() {
  const backend = idbBackend();
  store = keyStore(backend);
  own = createOwnRelay({ backend });
  let started = false;
  try {
    await limit(
      (async () => {
        // one time limit for the whole start, and every read in it must succeed
        // Made once: two copies opened at the same first start get the same id (keys.mjs noteOnce).
        myId =
          (await store.note('device')) ||
          (await store.noteOnce(
            'device',
            'ph-' +
              [...crypto.getRandomValues(new Uint8Array(5))]
                .map(b => b.toString(16).padStart(2, '0'))
                .join('')
          ));
        savedRoom = (await store.note('room')) || null;
        relayInfo = await own.get();
        started = !!(await store.note('started'));
        for (const p of await store.pairings()) known.set(p.id, p);
      })()
    );
  } catch {
    return show('nostore');
  } // a store that is refused or hangs gets a screen that says so, not a blank page

  needs = createNeeds({
    send: (id, obj) => link.send(id, obj),
    on: { changed: () => paintNeeds() },
  });
  link = createLink({
    self: { id: myId },
    store,
    name: phoneName,
    // An own relay's address when one is set, else the page's own host (the stand-in relay).
    url: () =>
      relayInfo.set
        ? own.wsUrl()
        : (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host,
    // With an own relay: a ticket from that relay. Otherwise the stand-in relay's "ticket" is the
    // room and this device. The room is the one sync() decided on, nothing a message can set.
    getTicket: async () => {
      if (relayInfo.set) return own.ticket(myId);
      if (!liveRoom) throw { status: 503, code: 'no_room' };
      return liveRoom + '~' + myId;
    },
    on: {
      state: s => {
        conn = s.connection;
        connReason = s.reason || null;
        paintRelay();
        if (busy && runLive && run && run.state !== 'done' && conn !== 'online') fail('relay');
        paintComputers();
        paintNeeds();
      },
      peer: (id, s) => {
        peers.set(id, s);
        if (!s.session) needs.sessionEnded(id);
        paintComputers();
        paintNeeds();
      },
      session: id => {
        needs.sessionStarted(id);
        paintComputers();
      },
      // every field is read again as untrusted text there, and only ever set as text here
      message: (id, obj) => needs.onMessage(id, obj),
      pair: (from, obj) => {
        onPair(from, obj).catch(() => {});
      },
      unreachable: id => {
        if (busy && runPc === id && !(run && run.state === 'done')) fail('offline');
      },
    },
  });

  // Another open copy of the app paired or forgot a computer: the link reads the store again, and
  // so do the lists. The room is read again too (another copy may have paired the first computer),
  // and sync() then makes the connection if there is one to make.
  onStoreChange(async () => {
    if (!busy) savedRoom = (await store.note('room').catch(() => savedRoom)) || savedRoom;
    await link.refresh().catch(() => {});
    sync();
    await loadKnown();
    if (screen === 'computers') listComputers();
    paintNeeds();
  });

  // Add to Home screen, where the browser offers it (Chrome on Android). An installed app does not
  // show the row.
  let offer = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    offer = e;
    $('installRow').hidden = false;
  });
  window.addEventListener('appinstalled', () => {
    offer = null;
    $('installRow').hidden = true;
  });
  $('install').onclick = async () => {
    const o = offer;
    if (!o) return;
    offer = null;
    $('installRow').hidden = true;
    try {
      await o.prompt();
    } catch {
      /* the browser took its offer back */
    }
  };

  tabs();
  relaySetup();
  $('start').onclick = async () => {
    await store.setNote('started', true).catch(() => {});
    show('computers');
  };
  $('add').onclick = () => show('scan');
  $('cancel').onclick = () => {
    closeRun();
    if (screen === 'digits') show('computers');
  };
  $('usePaste').onclick = () => {
    const t = $('paste').value.trim();
    if (readCode(t)) begin(t);
    else $('scanErr').textContent = WHY.code;
  };

  // A press that ends a run which had in fact just finished lands on Paired (closeRun shows it);
  // any other goes where it says.
  for (const b of document.querySelectorAll('[data-go]'))
    b.onclick = () => {
      const was = screen;
      if (busy) closeRun();
      if (screen === was) show(b.dataset.go);
    };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopCamera();
    else if (screen === 'scan' && !camera) startCamera();
    sync();
  });

  show(!started ? 'welcome' : known.size ? 'needs' : 'computers');
  sync();
}
main();
