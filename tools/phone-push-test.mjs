// Runs the computer's side of a push notice (desktop/phone-push.js, Node) against the phone's side
// (phone/src/push.mjs, Web Crypto): node tools/phone-push-test.mjs The computer seals, the
// receiver's rules open (RFC 8291), the phone decides what to show.
// Plain Node; no network, no real phone, no push service, no service worker.
import { createRequire } from 'node:module';
import * as PN from '../phone/src/noise.mjs';
import { safeId as phoneStoreSafeId } from '../phone/src/keys.mjs';
import {
  checkNotice,
  unsealForTest,
  newNoticeKey,
  planResubscribe,
  pruneSeen,
  cleanName as phoneClean,
  safeId as phoneSafeId,
} from '../phone/src/push.mjs';
const require = createRequire(import.meta.url);
const nodeCrypto = require('node:crypto');
const DN = require('../desktop/remote-noise.js'),
  { sealNotice, cleanName, safeId, fields, PLAIN } = require('../desktop/phone-push.js');
const { safeId: storeSafeId } = require('../desktop/remote-keys.js');

let passed = 0,
  failed = 0;
const ok = (name, pass, detail = '') => {
  if (pass) passed++;
  else {
    failed++;
    console.log('FAIL ' + name + (detail ? '  ' + detail : ''));
  }
};
const throws = fn => {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
};
const hex = b => Buffer.from(b).toString('hex'),
  copy = o => JSON.parse(JSON.stringify(o));
const BARE = JSON.stringify({ show: { title: 'Open Technically Not', bare: true } });
const bare = r => JSON.stringify(r) === BARE;
const MIN = 60 * 1000,
  DAY = 24 * 60 * MIN,
  NOW = 1790000000000;
const cp = String.fromCodePoint;

// A phone's push subscription as its browser makes it: a P-256 key pair and 16 secret bytes.
async function subscribe() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, [
    'deriveBits',
  ]);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)),
    auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    priv: pair.privateKey,
    pub,
    auth,
    forComputer: { p256dh: Buffer.from(pub), auth: Buffer.from(auth) },
  };
}
const open = async (body, sub) => {
  const b = await unsealForTest(new Uint8Array(body), sub.priv, sub.pub, sub.auth);
  return b && new TextDecoder().decode(b);
};

const sub = await subscribe();
const keyA = newNoticeKey(),
  keyB = newNoticeKey();
const computers = [
  { id: 'pc-a', name: 'Desktop', noticeKey: keyA, how: 'scan' },
  { id: 'pc-b', name: 'Laptop', noticeKey: keyB, how: 'scan' },
];
const notice = (over = {}) => ({
  subscription: sub.forComputer,
  noticeKey: Buffer.from(keyA),
  computerId: 'pc-a',
  itemId: 'item-1',
  agent: 'Moss',
  time: NOW - 5000,
  ...over,
});

// A notice as a changed app could make it: any fields, with the right check for them. Nothing here
// cleans or cuts.
const forged = (key, over = {}) => {
  const p = { c: 'pc-a', i: 'item-1', a: 'Moss', t: NOW, ...over };
  return {
    ...p,
    check: nodeCrypto
      .createHmac('sha256', Buffer.from(key))
      .update(DN.fields('tnai-notice-v1', p.c, p.i, String(p.t), p.a))
      .digest('base64'),
  };
};

// 1. The whole way: the computer seals, the receiver opens, the phone shows the name line.
{
  const body = sealNotice(notice()),
    text = await open(body, sub),
    p = JSON.parse(text);
  ok('the computer returns bytes', Buffer.isBuffer(body));
  ok(
    'the header is RFC 8291 shaped: 16-byte salt, record size 4096, key length 65, an uncompressed point',
    body.readUInt32BE(16) === 4096 &&
      body[20] === 65 &&
      body[21] === 4 &&
      body.length === 16 + 4 + 1 + 65 + PLAIN + 16
  );
  ok(
    'two seals of the same notice share no salt, key or sealed byte run',
    hex(body.subarray(0, 16)) !== hex(sealNotice(notice()).subarray(0, 16)) &&
      hex(body.subarray(21, 86)) !== hex(sealNotice(notice()).subarray(21, 86))
  );
  ok(
    'every notice has the same size, whatever the names',
    sealNotice(notice({ agent: 'M', itemId: 'i' })).length === body.length &&
      sealNotice(
        notice({
          agent: cp(0x1f600).repeat(80),
          itemId: 'i'.repeat(64),
          computerId: 'c'.repeat(64),
          time: Number.MAX_SAFE_INTEGER,
        })
      ).length === body.length
  );
  ok(
    'the notice holds only the allowed fields',
    Object.keys(p).sort().join(',') === 'a,c,check,i,t',
    text
  );
  ok(
    'and they are the id, the item, the name and the time',
    p.c === 'pc-a' && p.i === 'item-1' && p.a === 'Moss' && p.t === NOW - 5000
  );
  const expected = nodeCrypto
    .createHmac('sha256', Buffer.from(keyA))
    .update(DN.fields('tnai-notice-v1', 'pc-a', 'item-1', String(NOW - 5000), 'Moss'))
    .digest('base64');
  ok('the check is the HMAC over the labelled fields, in base64', p.check === expected);
  ok(
    "both sides' fields are the bytes of the session code's fields",
    hex(fields('a', '', 'bc')) === hex(DN.fields('a', '', 'bc')) &&
      hex(fields('a', '', 'bc')) === hex(PN.fields('a', '', 'bc'))
  );
  const seen = new Set(),
    shown = await checkNotice(text, computers, seen, NOW);
  ok(
    'the phone shows the line with its own name for the computer first',
    shown.show.title === 'Desktop: Moss needs you' &&
      shown.show.computerId === 'pc-a' &&
      shown.show.itemId === 'item-1' &&
      shown.show.earlier === false &&
      !shown.show.bare,
    JSON.stringify(shown)
  );
  ok(
    'the same notice a second time is bare (replay)',
    bare(await checkNotice(text, computers, seen, NOW))
  );
  ok(
    'also when it arrives as an object',
    bare(await checkNotice(p, computers, seen, NOW)) &&
      (await checkNotice(p, computers, new Set(), NOW)).show.title === 'Desktop: Moss needs you'
  );
  ok(
    'another item of the same computer still shows',
    (
      await checkNotice(
        await open(sealNotice(notice({ itemId: 'item-2' })), sub),
        computers,
        seen,
        NOW
      )
    ).show.itemId === 'item-2'
  );
  const both = new Set(),
    pair = await Promise.all([
      checkNotice(text, computers, both, NOW),
      checkNotice(text, computers, both, NOW),
    ]);
  ok('two copies arriving together show once', pair.filter(bare).length === 1);
}

// 2. One paired computer cannot speak in another's name.
{
  // sealed with A's notice key, says it is B
  const lie = await open(sealNotice(notice({ computerId: 'pc-b' })), sub);
  ok(
    "a notice made with A's key that names B is bare",
    bare(await checkNotice(lie, computers, new Set(), NOW))
  );
  const seen = new Set();
  await checkNotice(lie, computers, seen, NOW);
  ok(
    "and it does not use up B's item",
    seen.size === 0 &&
      (
        await checkNotice(
          await open(sealNotice(notice({ computerId: 'pc-b', noticeKey: Buffer.from(keyB) })), sub),
          computers,
          seen,
          NOW
        )
      ).show.title === 'Laptop: Moss needs you'
  );
  ok(
    'a computer the phone does not know is bare',
    bare(
      await checkNotice(
        await open(sealNotice(notice({ computerId: 'pc-z' })), sub),
        computers,
        new Set(),
        NOW
      )
    )
  );
  const mine = await open(sealNotice(notice()), sub);
  ok(
    'a computer without a notice key is bare',
    bare(
      await checkNotice(
        mine,
        [{ id: 'pc-a', name: 'Desktop', how: 'scan' }, computers[1]],
        new Set(),
        NOW
      )
    )
  );

  // Known by introduction only: such a computer never gets push keys, so even an entry that holds a
  // key (a fault in the caller) is not honoured.
  ok(
    'an entry marked introduced is bare even with a notice key that fits',
    bare(
      await checkNotice(
        mine,
        [{ ...computers[0], how: 'introduced' }, computers[1]],
        new Set(),
        NOW
      )
    )
  );
  ok(
    'an entry that does not say how it was paired is bare',
    bare(
      await checkNotice(
        mine,
        [{ id: 'pc-a', name: 'Desktop', noticeKey: keyA }, computers[1]],
        new Set(),
        NOW
      )
    ) && bare(await checkNotice(mine, [{ ...computers[0], how: 'Scan' }], new Set(), NOW))
  );
  ok(
    'an id listed twice is trusted for neither',
    bare(
      await checkNotice(
        mine,
        [...computers, { id: 'pc-a', name: 'Other', noticeKey: newNoticeKey(), how: 'scan' }],
        new Set(),
        NOW
      )
    ) &&
      bare(
        await checkNotice(
          mine,
          [...computers, { id: 'pc-a', name: 'Other', how: 'introduced' }],
          new Set(),
          NOW
        )
      )
  );
  ok(
    'no computers at all is bare',
    bare(await checkNotice(mine, [], new Set(), NOW)) &&
      bare(await checkNotice(mine, null, new Set(), NOW))
  );

  // One notice key on two entries: either computer could sign as the other, so the key counts for
  // neither.
  const asB = await open(sealNotice(notice({ computerId: 'pc-b' })), sub);

  // an equal key, not the same object
  const shared = [computers[0], { ...computers[1], noticeKey: Uint8Array.from(keyA) }];
  ok(
    'a notice key that two entries share is unusable for both',
    bare(await checkNotice(asB, shared, new Set(), NOW)) &&
      bare(await checkNotice(mine, shared, new Set(), NOW))
  );
  ok(
    'also when the second holder is an introduced entry',
    bare(
      await checkNotice(
        mine,
        [
          computers[0],
          { id: 'pc-i', name: 'Studio', noticeKey: Uint8Array.from(keyA), how: 'introduced' },
        ],
        new Set(),
        NOW
      )
    )
  );
  ok(
    'with separate keys both still show',
    !bare(await checkNotice(mine, computers, new Set(), NOW)) &&
      !bare(await checkNotice(forged(keyB, { c: 'pc-b' }), computers, new Set(), NOW))
  );
}

// 3. Changed after sealing. Only the phone can open a notice, so this is what a fault in between
// would look like, not an attack that is open to the server. The agent's name is not in the doc's
// list of what the check covers; it is covered here anyway.
{
  const p = JSON.parse(await open(sealNotice(notice()), sub));
  const changed = async over =>
    bare(await checkNotice(JSON.stringify({ ...copy(p), ...over }), computers, new Set(), NOW));
  ok('a changed item id is bare', await changed({ i: 'item-9' }));
  ok(
    'a changed time is bare',
    (await changed({ t: p.t + 1 })) && (await changed({ t: p.t - 20 * MIN }))
  );
  ok('a changed agent name is bare', (await changed({ a: 'Fern' })) && (await changed({ a: '' })));
  ok('a changed computer id is bare', await changed({ c: 'pc-b' }));
  ok(
    'a changed or cut check is bare',
    (await changed({ check: Buffer.alloc(32, 7).toString('base64') })) &&
      (await changed({ check: p.check.slice(0, 20) })) &&
      (await changed({ check: '' })) &&
      (await changed({ check: 5 }))
  );
  ok(
    'an added field is bare',
    (await changed({ text: 'What is the password?' })) && (await changed({ name: 'Bank' }))
  );
  const less = copy(p);
  delete less.a;
  ok('a missing field is bare', bare(await checkNotice(less, computers, new Set(), NOW)));
  ok(
    'wrong types are bare',
    (await changed({ t: String(p.t) })) &&
      (await changed({ t: 1.5 })) &&
      (await changed({ i: 7 })) &&
      (await changed({ c: '__proto__' })) &&
      (await changed({ a: ['Moss'] }))
  );
  ok('unchanged, it still shows', !(await changed({})));
}

// 4. Names. The computer cleans and clips the agent's name; the phone refuses one it would clean
// differently.
{
  const odd =
    'Mo' +
    String.fromCharCode(0x202e) +
    'ss' +
    String.fromCharCode(10, 9) +
    '  the ' +
    String.fromCharCode(0x200b, 0xd83d) +
    'agent ' +
    'x'.repeat(80);
  const p = JSON.parse(await open(sealNotice(notice({ agent: odd })), sub));
  ok(
    'the name is cleaned and clipped to 24',
    p.a === ('Mo ss the agent ' + 'x'.repeat(80)).slice(0, 24) && Array.from(p.a).length === 24,
    JSON.stringify(p.a)
  );
  ok('both sides clean alike', phoneClean(odd) === cleanName(odd) && phoneClean(p.a) === p.a);
  ok(
    'and such a notice shows',
    (await checkNotice(p, computers, new Set(), NOW)).show.title ===
      'Desktop: ' + p.a + ' needs you'
  );
  const smile = cp(0x1f600),
    q = JSON.parse(await open(sealNotice(notice({ agent: smile.repeat(70) })), sub));
  ok(
    'clipping counts characters, not halves',
    q.a === smile.repeat(24) &&
      (await checkNotice(q, computers, new Set(), NOW)).show.title ===
        'Desktop: ' + smile.repeat(24) + ' needs you'
  );

  // A computer that seals an uncleaned name with a right check (a changed app) still cannot put a
  // hidden character on the lock screen.
  ok(
    'an uncleaned name is bare even with a right check',
    bare(
      await checkNotice(
        forged(keyA, { a: 'Mo' + String.fromCharCode(0x202e) + 'ss' }),
        computers,
        new Set(),
        NOW
      )
    )
  );
  const none = JSON.parse(await open(sealNotice(notice({ agent: undefined })), sub));
  ok(
    'no agent name still gives a line',
    none.a === '' &&
      (await checkNotice(none, computers, new Set(), NOW)).show.title ===
        'Desktop: An agent needs you'
  );
  const blank = JSON.parse(
    await open(sealNotice(notice({ agent: cp(0x2800, 0x3164, 0xad, 0xe0041) + ' ' })), sub)
  );
  ok(
    'a name that is empty after cleaning shows as An agent',
    blank.a === '' &&
      (await checkNotice(blank, computers, new Set(), NOW)).show.title ===
        'Desktop: An agent needs you'
  );
  const mine = [
    {
      id: 'pc-a',
      name: 'Desk' + String.fromCharCode(0x202e) + 'top ' + 'y'.repeat(90),
      noticeKey: keyA,
      how: 'scan',
    },
  ];
  ok(
    "the computer's name is the phone's own, cleaned",
    (await checkNotice(await open(sealNotice(notice()), sub), mine, new Set(), NOW)).show.title ===
      ('Desk top ' + 'y'.repeat(90)).slice(0, 60) + ': Moss needs you'
  );
  ok(
    'a computer the phone has no name for still gives a line',
    (
      await checkNotice(
        await open(sealNotice(notice()), sub),
        [{ id: 'pc-a', noticeKey: keyA, how: 'scan' }],
        new Set(),
        NOW
      )
    ).show.title === 'Your computer: Moss needs you'
  );

  // The misleading title (review): a computer with its own notice key names its agent "Moss on
  // Laptop needs you" and adds 36 blank characters, so that the true computer falls off the end of
  // a lock-screen line.
  const trick = 'Moss on Laptop needs you' + cp(0x2800).repeat(36);
  const t = JSON.parse(await open(sealNotice(notice({ agent: trick })), sub)),
    line = (await checkNotice(t, computers, new Set(), NOW)).show.title;
  ok(
    'blank filling is removed and the true computer stands first',
    t.a === 'Moss on Laptop needs you' &&
      line === 'Desktop: Moss on Laptop needs you needs you' &&
      line.startsWith('Desktop: '),
    JSON.stringify(line)
  );
  ok(
    'a changed app that sends the filling anyway gets the bare line',
    bare(await checkNotice(forged(keyA, { a: trick }), computers, new Set(), NOW)) &&
      bare(
        await checkNotice(forged(keyA, { a: 'Moss' + cp(0x2800) + 'x' }), computers, new Set(), NOW)
      )
  );
  ok(
    'a name longer than 24 is bare even with a right check, 24 shows',
    bare(await checkNotice(forged(keyA, { a: 'x'.repeat(25) }), computers, new Set(), NOW)) &&
      !bare(await checkNotice(forged(keyA, { a: 'x'.repeat(24) }), computers, new Set(), NOW))
  );

  // Every character the cleaner takes out, on both sides, and the neighbours it must leave alone.
  const gone = [
    0x00, 0x09, 0x7f, 0x9f, 0xad, 0x34f, 0x61c, 0x115f, 0x1160, 0x17b4, 0x17b5, 0x180b, 0x180c,
    0x180d, 0x180e, 0x180f, 0x200b, 0x200f, 0x2028, 0x202e, 0x2060, 0x2069, 0x2800, 0x3164, 0xfe00,
    0xfe0f, 0xfeff, 0xffa0, 0xfff9, 0xfffa, 0xfffb, 0x1d173, 0x1d17a, 0xe0000, 0xe0001, 0xe0020,
    0xe0041, 0xe007f, 0xe0100, 0xe01ef, 0xe0fff,
  ];
  const stays = [
    0x41, 0xe9, 0xae, 0x61b, 0x61d, 0x1161, 0x180a, 0x1810, 0x27ff, 0x2801, 0x3163, 0x3165, 0xfe10,
    0xff9f, 0xffa1, 0xfffc, 0x1d17b, 0x1f600, 0xe1000,
  ];
  const wrongGone = gone.filter(
    c =>
      cleanName('Mo' + cp(c) + 'ss') !== 'Mo ss' ||
      phoneClean('Mo' + cp(c) + 'ss') !== 'Mo ss' ||
      cleanName(cp(c).repeat(40)) !== ''
  );
  const wrongStays = stays.filter(
    c =>
      cleanName('Mo' + cp(c) + 'ss') !== 'Mo' + cp(c) + 'ss' ||
      phoneClean('Mo' + cp(c) + 'ss') !== 'Mo' + cp(c) + 'ss'
  );
  ok(
    'every hiding character becomes a space on both sides',
    wrongGone.length === 0,
    wrongGone.map(c => c.toString(16)).join()
  );
  ok(
    'their neighbours are left alone on both sides',
    wrongStays.length === 0,
    wrongStays.map(c => c.toString(16)).join()
  );
  const acute = cp(0x301),
    marks = 'e' + acute.repeat(30) + 'x' + cp(0x301, 0x20dd, 0x903, 0x302) + 'y' + acute.repeat(2);
  ok(
    'more than two combining marks in a row are cut to two',
    cleanName(marks) === 'e' + acute.repeat(2) + 'x' + cp(0x301, 0x20dd) + 'y' + acute.repeat(2) &&
      cleanName(acute.repeat(9)) === acute.repeat(2),
    JSON.stringify(cleanName(marks))
  );

  // The two cleaners on a list of samples: equal results, a second cleaning changes nothing, never
  // longer than the limit.
  const samples = [
    '',
    ' ',
    'Moss',
    '  Moss  the  agent ',
    odd,
    trick,
    marks,
    smile.repeat(70),
    'x'.repeat(24) + ' y',
    'x'.repeat(23) + ' y',
    'a' + acute.repeat(40) + 'b'.repeat(40),
    acute.repeat(3) + cp(0x2800) + acute.repeat(3),
    String.fromCharCode(0xd83d) + 'half',
    'half' + String.fromCharCode(0xde00),
    cp(0x202e) + 'evil',
    'tab' + String.fromCharCode(9) + 'bed',
    null,
    undefined,
    5,
    {},
    ...gone.map(c => 'a' + cp(c) + 'b' + cp(c).repeat(30) + 'c'),
    ...stays.map(c => cp(c).repeat(30)),
  ];
  const unlike = samples.filter(s =>
    [undefined, 24, 60, 1].some(max => {
      const d = cleanName(s, max),
        f = phoneClean(s, max);
      return (
        d !== f ||
        cleanName(d, max) !== d ||
        phoneClean(f, max) !== f ||
        Array.from(d).length > (max ?? 24)
      );
    })
  );
  ok(
    'both cleaners agree on every sample, and cleaning twice changes nothing',
    unlike.length === 0 && samples.length > 60,
    JSON.stringify(unlike)
  );
}

// 5. Time: older than ten minutes is "earlier"; older than a day is not shown; more than ten
// minutes ahead is not believed.
{
  const at = async (time, now = NOW) =>
    await checkNotice(await open(sealNotice(notice({ time })), sub), computers, new Set(), now);
  ok('ten minutes old is not yet earlier', (await at(NOW - 10 * MIN)).show.earlier === false);
  ok(
    'older than ten minutes is earlier, and still shows its line',
    (await at(NOW - 10 * MIN - 1)).show.earlier === true &&
      (await at(NOW - 23 * 60 * MIN)).show.title === 'Desktop: Moss needs you'
  );
  ok(
    'a day old still shows, as earlier',
    (await at(NOW - DAY)).show.earlier === true &&
      (await at(NOW - DAY)).show.title === 'Desktop: Moss needs you'
  );
  ok(
    'older than a day is bare, though nothing was seen before',
    bare(await at(NOW - DAY - 1)) && bare(await at(NOW - 400 * DAY))
  );
  ok(
    'a computer clock three minutes ahead is fine',
    (await at(NOW + 3 * MIN)).show.title === 'Desktop: Moss needs you' &&
      (await at(NOW + 3 * MIN)).show.earlier === false
  );
  ok(
    'up to ten minutes ahead is fine (clocks differ)',
    (await at(NOW + 10 * MIN)).show.earlier === false
  );
  ok('further ahead is bare', bare(await at(NOW + 10 * MIN + 1)));
  ok(
    'a time that is not a whole number on the phone is bare',
    bare(await at(NOW, NaN)) && bare(await at(NOW, '5'))
  );
}

// 6. Junk in place of a notice is always the bare line, never an error.
{
  let all = true;
  for (const junk of [
    '',
    '{',
    'null',
    '[]',
    '"text"',
    '5',
    '{"c":"pc-a"}',
    'x'.repeat(5000),
    null,
    undefined,
    5,
    [],
    {},
    new Uint8Array(4),
  ])
    all = all && bare(await checkNotice(junk, computers, new Set(), NOW));
  ok('malformed JSON and other junk are bare', all);
  const long = JSON.parse(await open(sealNotice(notice()), sub)),
    spaced = JSON.stringify(long) + ' '.repeat(3000);
  ok(
    'text far longer than a notice is not read',
    bare(await checkNotice(spaced, computers, new Set(), NOW))
  );
  ok(
    'without a usable seen list nothing but the bare line shows',
    bare(await checkNotice(long, computers, null, NOW)) &&
      bare(await checkNotice(long, computers, {}, NOW))
  );
}

// 7. What the computer refuses to seal.
{
  const bad = over => throws(() => sealNotice(notice(over)));
  ok(
    'wrong-length subscription keys throw',
    bad({ subscription: { p256dh: Buffer.alloc(64, 4), auth: sub.forComputer.auth } }) &&
      bad({ subscription: { p256dh: sub.forComputer.p256dh, auth: Buffer.alloc(15) } }) &&
      bad({ subscription: { p256dh: sub.forComputer.p256dh, auth: Buffer.alloc(17) } }) &&
      bad({ subscription: {} }) &&
      bad({ subscription: null })
  );
  ok(
    'a key that is not a point on the curve throws',
    bad({ subscription: { p256dh: Buffer.alloc(65, 4), auth: sub.forComputer.auth } }) &&
      bad({
        subscription: {
          p256dh: Buffer.concat([Buffer.from([2]), sub.forComputer.p256dh.subarray(1)]),
          auth: sub.forComputer.auth,
        },
      })
  );
  ok(
    'keys as text instead of bytes throw',
    bad({
      subscription: {
        p256dh: sub.forComputer.p256dh.toString('base64'),
        auth: sub.forComputer.auth,
      },
    }) && bad({ noticeKey: Buffer.from(keyA).toString('base64') })
  );
  ok(
    'a wrong-length notice key throws',
    bad({ noticeKey: Buffer.alloc(31) }) &&
      bad({ noticeKey: Buffer.alloc(33) }) &&
      bad({ noticeKey: undefined })
  );
  ok(
    'ids that are not short text throw',
    bad({ computerId: '' }) &&
      bad({ itemId: '' }) &&
      bad({ computerId: 'x'.repeat(65) }) &&
      bad({ itemId: 7 }) &&
      bad({ itemId: null }) &&
      bad({ itemId: ['a'] }) &&
      bad({ computerId: 'constructor' }) &&
      bad({ itemId: '__proto__' })
  );
  ok(
    'an id with a broken half of a character throws',
    bad({ itemId: 'a' + String.fromCharCode(0xd800) }) &&
      bad({ computerId: String.fromCharCode(0xdc00) + 'a' })
  );
  ok(
    'the longest ids a notice may carry fit in one with the longest name, and ids that are not allowed throw',
    !bad({
      computerId: 'x'.repeat(64),
      itemId: cp(0x4e00).repeat(64),
      agent: cp(0x1f600).repeat(24),
    }) &&
      bad({
        computerId: String.fromCharCode(1).repeat(64),
        itemId: String.fromCharCode(1).repeat(64),
      }) &&
      !bad({ computerId: 'x'.repeat(64), itemId: cp(0x4e00).repeat(64) }) &&
      bad({ computerId: cp(0x4e00).repeat(8) }) &&
      bad({ computerId: 'My PC' })
  );
  ok(
    'a time that is not a whole number throws',
    bad({ time: 1.5 }) &&
      bad({ time: '1790000000000' }) &&
      bad({ time: NaN }) &&
      bad({ time: 0 }) &&
      bad({ time: -5 }) &&
      bad({ time: undefined }) &&
      bad({ time: 2 ** 60 })
  );
  ok(
    'an agent name that is not text throws',
    bad({ agent: { toString: () => 'Moss' } }) && bad({ agent: 5 })
  );
  ok('no input at all throws', throws(() => sealNotice()) && throws(() => sealNotice(null)));
}

// 8. A notice sealed for another subscription, or changed on the way, does not open.
{
  const other = await subscribe(),
    body = sealNotice(notice());
  ok(
    'it opens only with the keys it was sealed for',
    (await open(body, other)) === null &&
      (await open(sealNotice(notice({ subscription: other.forComputer })), sub)) === null &&
      (await open(sealNotice(notice({ subscription: other.forComputer })), other)) !== null
  );
  ok(
    'the right key pair with another secret does not open it',
    (await unsealForTest(new Uint8Array(body), sub.priv, sub.pub, other.auth)) === null
  );
  let closed = true;
  for (const at of [0, 15, 18, 20, 30, 86, 200, body.length - 1]) {
    const b = Buffer.from(body);
    b[at] ^= 1;
    closed = closed && (await open(b, sub)) === null;
  }
  ok('one changed byte anywhere and it does not open', closed);
  ok(
    'a cut body does not open',
    (await open(body.subarray(0, body.length - 1), sub)) === null &&
      (await open(body.subarray(0, 90), sub)) === null &&
      (await open(Buffer.alloc(0), sub)) === null
  );

  // The opener here and the sealer in desktop/phone-push.js were written together, so the two
  // agreeing proves little by itself. tools/phone-check/webpush.js is the sealer whose push reached
  // a real phone (2026-10-05); the opener must open that one too.
  const proven = await import('./phone-check/webpush.js');
  const theirs = await proven.encrypt(
    { keys: { p256dh: proven.b64u(sub.pub), auth: proven.b64u(sub.auth) } },
    new TextEncoder().encode('{"hello":1}')
  );
  ok(
    'the opener also opens what the sealer proven on a real phone made',
    (await open(theirs, sub)) === '{"hello":1}' &&
      theirs[20] === body[20] &&
      hex(theirs.subarray(16, 20)) === hex(body.subarray(16, 20))
  );
  ok(
    'the sealed bytes show none of the notice',
    !body.includes('Moss') && !body.includes('pc-a') && !body.includes('item-1')
  );
}

// 9. Notice keys and the plan after the subscription was made again (section 7.1).
{
  const a = newNoticeKey(),
    b = newNoticeKey();
  ok(
    'a notice key is 32 random bytes, new each time',
    a instanceof Uint8Array && a.length === 32 && hex(a) !== hex(b) && !a.every(x => x === 0)
  );
  const three = [
    ...computers,
    { id: 'pc-c', name: 'Studio', noticeKey: newNoticeKey(), how: 'scan' },
  ];
  const plan = planResubscribe(three, ['pc-b', 'pc-x']);
  ok(
    'online computers get the new keys now, offline ones are marked',
    plan.giveNow.join() === 'pc-b' && plan.needsNewKeys.join() === 'pc-a,pc-c'
  );
  ok(
    'a Set of online ids works too',
    planResubscribe(three, new Set(['pc-a', 'pc-b', 'pc-c'])).needsNewKeys.length === 0 &&
      planResubscribe(three, new Set(['pc-a', 'pc-b', 'pc-c'])).giveNow.length === 3
  );
  ok(
    'nobody online: all are marked',
    planResubscribe(three).giveNow.length === 0 &&
      planResubscribe(three, null).needsNewKeys.length === 3
  );
  ok(
    "a device that is online but not in the phone's list gets nothing",
    !JSON.stringify(plan).includes('pc-x')
  );
  ok(
    'doubles and junk entries are left out',
    planResubscribe(
      [...three, three[0], null, { id: 5 }, {}, 'pc-z', { id: 'pc-q' }],
      ['pc-a', 'pc-q']
    ).giveNow.join() === 'pc-a' &&
      planResubscribe([...three, three[0], null, { id: 5 }, {}], ['pc-a']).needsNewKeys.join() ===
        'pc-b,pc-c' &&
      planResubscribe(null, ['pc-a']).giveNow.length === 0
  );

  // The computer that was just forgotten is the one the new subscription exists to shut out: never
  // in a list, even while the caller's list still holds it and its session is still open.
  const all = ['pc-a', 'pc-b', 'pc-c'],
    forgot = planResubscribe(three, all, ['pc-b']);
  ok(
    'a forgotten computer still in the list is in neither list',
    forgot.giveNow.join() === 'pc-a,pc-c' &&
      forgot.needsNewKeys.length === 0 &&
      !JSON.stringify(planResubscribe(three, [], new Set(['pc-b', 'pc-c']))).includes('pc-b') &&
      planResubscribe(three, [], new Set(['pc-b', 'pc-c'])).needsNewKeys.join() === 'pc-a'
  );
  const mixed = [
    ...three,
    { id: 'pc-i', name: 'Intro', noticeKey: newNoticeKey(), how: 'introduced' },
    { id: 'pc-n', name: 'No word' },
  ];
  ok(
    'a computer known only by introduction is in neither list',
    planResubscribe(mixed, [...all, 'pc-i', 'pc-n']).giveNow.join() === 'pc-a,pc-b,pc-c' &&
      planResubscribe(mixed, []).needsNewKeys.join() === 'pc-a,pc-b,pc-c'
  );

  // The key stores take only letters, digits, _ and - since 0.3.65 (desktop/remote-keys.js safeId).
  // An id they refuse is marked, so the user is told.
  const half = 'pc' + String.fromCharCode(0xd800),
    odd = [
      { id: 'pc_1-A', how: 'scan' },
      { id: 'My PC', how: 'scan' },
      { id: 'x'.repeat(65), how: 'scan' },
      { id: '__proto__', how: 'scan' },
      { id: 5, how: 'scan' },
      { id: half, how: 'scan' },
      { id: 'tab' + String.fromCharCode(9) + '"q"', how: 'scan' },
    ];
  const oddPlan = planResubscribe(
      odd,
      odd.map(c => c.id)
    ),
    oddOff = planResubscribe(odd, []);
  ok(
    'an id the key stores accept gets its keys',
    oddPlan.giveNow.join() === 'pc_1-A' && oddOff.needsNewKeys.includes('pc_1-A')
  );
  ok(
    'an entry whose id is unusable is marked, not dropped',
    oddPlan.needsNewKeys.length === 6 &&
      ['My PC', 'x'.repeat(65), '__proto__', 5, half, odd[6].id].every(id =>
        oddPlan.needsNewKeys.includes(id)
      ) &&
      oddOff.needsNewKeys.length === 7
  );
}

// 10. One id rule everywhere: the key stores' (phone/src/keys.mjs and desktop/remote-keys.js), so
// no paired computer is refused for its id.
{
  const ids = [
    'pc-a',
    'pc_1-A',
    'My PC',
    'a"b',
    'a' + String.fromCharCode(10) + 'b',
    ' ',
    'x'.repeat(64),
    'x'.repeat(65),
    '',
    '__proto__',
    'constructor',
    'toString',
    'hasOwnProperty',
    cp(0x4e00),
    cp(0x1f600).repeat(32),
    cp(0x1f600).repeat(33),
    5,
    null,
    undefined,
    {},
    ['a'],
    true,
  ];
  const unlike = ids.filter(
    id => new Set([safeId(id), phoneSafeId(id), storeSafeId(id), phoneStoreSafeId(id)]).size !== 1
  );
  ok(
    'the four copies of the id rule agree on every sample',
    unlike.length === 0 &&
      safeId('pc_1-A') &&
      !safeId('My PC') &&
      !safeId('__proto__') &&
      !safeId('x'.repeat(65)),
    JSON.stringify(unlike)
  );

  // An item id with a space, a quote and a line break goes the whole way and names exactly that
  // computer and item.
  const pcId = 'My_PC-1',
    itemId = 'item "1"' + String.fromCharCode(10) + ' {x}',
    keyM = newNoticeKey(),
    list = [...computers, { id: pcId, name: 'Mine', noticeKey: keyM, how: 'scan' }];
  const text = await open(
      sealNotice(notice({ computerId: pcId, itemId, noticeKey: Buffer.from(keyM) })),
      sub
    ),
    p = JSON.parse(text),
    shown = await checkNotice(text, list, new Set(), NOW);
  ok(
    'such ids pass through the JSON unchanged and show',
    p.c === pcId &&
      p.i === itemId &&
      Object.keys(p).length === 5 &&
      shown.show.title === 'Mine: Moss needs you' &&
      shown.show.computerId === pcId &&
      shown.show.itemId === itemId,
    JSON.stringify(shown)
  );

  // The check's input is length-prefixed: moving the border between two ids gives other bytes, so a
  // space cannot make one notice read as another.
  ok(
    'the same characters split differently are different bytes under the check',
    hex(fields('My PC', 'x')) !== hex(fields('My', ' PCx')) &&
      hex(fields('My PC', 'x')) !== hex(fields('My PCx', '')) &&
      hex(fields('My PC', 'x')) === hex(PN.fields('My PC', 'x'))
  );
  const moved = [{ id: 'My', name: 'Other', noticeKey: keyM, how: 'scan' }];
  ok(
    'and a notice with the border moved is bare',
    bare(await checkNotice({ ...p, c: 'My', i: ' PC' + itemId }, moved, new Set(), NOW)) &&
      !bare(await checkNotice(forged(keyM, { c: 'My', i: ' PC' + itemId }), moved, new Set(), NOW))
  );
  ok(
    'an id with a broken half of a character is bare even with a right check',
    bare(
      await checkNotice(
        forged(keyA, { i: 'a' + String.fromCharCode(0xd800) }),
        computers,
        new Set(),
        NOW
      )
    )
  );
}

// 11. Replay and the list of what was shown (section 7.5): the list's key is computer id + item id
// + time, and it can be kept small.
{
  const seen = new Set(),
    first = await open(sealNotice(notice({ time: NOW - MIN })), sub);
  ok(
    'a notice shows once',
    !bare(await checkNotice(first, computers, seen, NOW)) &&
      bare(await checkNotice(first, computers, seen, NOW)) &&
      seen.size === 1
  );

  // The same item waiting again (a reused item id) is a new notice: it must not show bare for ever.
  const again = await checkNotice(
    await open(sealNotice(notice({ time: NOW })), sub),
    computers,
    seen,
    NOW
  );
  ok(
    'the same item id with a new time is a new notice',
    again.show.title === 'Desktop: Moss needs you' &&
      again.show.itemId === 'item-1' &&
      seen.size === 2
  );
  ok(
    'and each of the two is still shown only once',
    bare(await checkNotice(first, computers, seen, NOW)) &&
      bare(await checkNotice(forged(keyA, { t: NOW }), computers, seen, NOW)) &&
      seen.size === 2
  );

  // An item id may hold any character, so the key must not let two different pairs of ids read as
  // one.
  const k1 = newNoticeKey(),
    k2 = newNoticeKey(),
    k3 = newNoticeKey(),
    near = [
      { id: 'ab', name: 'One', noticeKey: k1, how: 'scan' },
      { id: 'a', name: 'Two', noticeKey: k2, how: 'scan' },
      { id: 'a_b', name: 'Three', noticeKey: k3, how: 'scan' },
    ],
    one = new Set();
  const shows = [
    await checkNotice(forged(k1, { c: 'ab', i: 'c' }), near, one, NOW),
    await checkNotice(forged(k2, { c: 'a', i: 'bc' }), near, one, NOW),
    await checkNotice(forged(k2, { c: 'a', i: ' bc' }), near, one, NOW),
    await checkNotice(forged(k3, { c: 'a_b', i: 'c' }), near, one, NOW),
    await checkNotice(forged(k2, { c: 'a', i: 'b c' }), near, one, NOW),
  ];
  ok(
    'ids that run together differently are different notices',
    shows.every(r => !bare(r)) && one.size === 5,
    JSON.stringify(shows.map(r => r.show.title))
  );

  // pruneSeen: the key carries the time, so nothing else is needed to drop what is older than a
  // day.
  const T = NOW - 5000,
    kept = new Set(),
    text = await open(sealNotice(notice()), sub);
  await checkNotice(text, computers, kept, NOW);
  ok(
    "the key in the list starts with the notice's time",
    kept.size === 1 &&
      [...kept][0].startsWith(T + ' ') &&
      [...kept][0].includes('pc-a') &&
      [...kept][0].endsWith('item-1'),
    JSON.stringify([...kept])
  );
  ok(
    'pruneSeen keeps a key up to a day old and gives back the same list',
    pruneSeen(kept, T + DAY) === kept &&
      kept.size === 1 &&
      bare(await checkNotice(text, computers, kept, T + DAY))
  );
  ok('pruneSeen removes a key older than a day', pruneSeen(kept, T + DAY + 1).size === 0);
  ok(
    'and the notice it forgot is too old to show again',
    bare(await checkNotice(text, computers, kept, T + DAY + 1)) && kept.size === 0
  );

  // A phone that gets notices for a year: the list holds only the last day's.
  const year = new Set();
  let most = 0;
  for (let d = 0; d < 400; d++) {
    const now = NOW + d * DAY;
    pruneSeen(year, now);
    await checkNotice(forged(keyA, { i: 'item-' + d, t: now }), computers, year, now);
    most = Math.max(most, year.size);
  }
  ok(
    'with pruning the list stays small over 400 days',
    most <= 2 && year.size <= 2,
    'most ' + most
  );
  const junk = new Set([
    'pc-a item-1',
    '',
    'x 1:ab',
    7,
    NOW + ' 4:pc-ax',
    NOW - DAY - 1 + ' 4:pc-ay',
  ]);
  ok(
    "keys that are not this file's are removed too, and junk in place of a list is no error",
    [...pruneSeen(junk, NOW)].join('|') === NOW + ' 4:pc-ax' &&
      pruneSeen(null, NOW) === null &&
      pruneSeen({}, NOW) !== null &&
      pruneSeen(new Set(['1 1:ab']), NaN).size === 1
  );
}

console.log(failed ? failed + ' FAILED, ' + passed + ' passed' : 'all ' + passed + ' passed');
process.exit(failed ? 1 : 0);
