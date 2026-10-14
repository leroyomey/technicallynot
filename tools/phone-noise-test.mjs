// Proves the phone's cryptography (phone/src/noise.mjs, Web Crypto) is byte-for-byte the desktop's
// (desktop/remote-noise.js): node tools/phone-noise-test.mjs The desktop file is proven against the
// published Noise test vector (tools/remote-noise-test.js); equal bytes here carry that proof over.
// Runs in plain Node, whose Web Crypto is the same interface a phone browser has. It does not prove
// a real phone browser.
import { createRequire } from 'node:module';
import * as P from '../phone/src/noise.mjs';
const D = createRequire(import.meta.url)('../desktop/remote-noise.js');

let passed = 0,
  failed = 0;
const ok = (name, pass, detail = '') => {
  if (pass) passed++;
  else {
    failed++;
    console.log('FAIL ' + name + (detail ? '  ' + detail : ''));
  }
};
const hex = b => Buffer.from(b).toString('hex'),
  same = (a, b) => hex(a) === hex(b),
  u8 = b => Uint8Array.from(b);
const throws = async fn => {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
};
const text = s => new TextEncoder().encode(s);

// Fixed keys, so both implementations can be asked for the same handshake.
const A = D.generateKeyPair(),
  B = D.generateKeyPair(),
  EA = D.generateKeyPair(),
  EB = D.generateKeyPair();
const pA = await P.importKeyPair(u8(A.priv), u8(A.pub)),
  pB = await P.importKeyPair(u8(B.priv), u8(B.pub));
const pEA = await P.importKeyPair(u8(EA.priv), u8(EA.pub)),
  pEB = await P.importKeyPair(u8(EB.priv), u8(EB.pub));
const prologue = D.fields('tnai-remote', '1', 'device-a', 'device-b');

// 1. Same inputs, same bytes: every handshake message, both keys and the final hash.
{
  const di = D.handshake({ initiator: true, s: A.priv, rs: B.pub, prologue, e: EA.priv }),
    dr = D.handshake({ initiator: false, s: B.priv, rs: A.pub, prologue, e: EB.priv });
  const pi = await P.handshake({
      initiator: true,
      s: pA,
      rs: u8(B.pub),
      prologue: u8(prologue),
      e: pEA,
    }),
    pr = await P.handshake({
      initiator: false,
      s: pB,
      rs: u8(A.pub),
      prologue: u8(prologue),
      e: pEB,
    });
  const dm1 = di.write(Buffer.from('hello')),
    pm1 = await pi.write(text('hello'));
  ok('message 1 is the same bytes', same(dm1, pm1));
  ok(
    'message 1 opens on both',
    same(dr.read(dm1), text('hello')) && same(await pr.read(pm1), text('hello'))
  );
  const dm2 = dr.write(Buffer.from('hi back')),
    pm2 = await pr.write(text('hi back'));
  ok('message 2 is the same bytes', same(dm2, pm2));
  ok(
    'message 2 opens on both',
    same(di.read(dm2), text('hi back')) && same(await pi.read(pm2), text('hi back'))
  );
  const ds = di.split(),
    ps = await pi.split(),
    dsr = dr.split(),
    psr = await pr.split();
  ok(
    'starter keys and hash are the same',
    same(ds.send, ps.send) && same(ds.recv, ps.recv) && same(ds.hash, ps.hash)
  );
  ok(
    'answerer keys are the same and mirror the starter',
    same(dsr.send, psr.send) && same(psr.send, ps.recv) && same(psr.recv, ps.send)
  );
}

// 2. A phone and a computer talk, in both roles, with fresh one-time keys.
for (const phoneStarts of [true, false]) {
  const who = phoneStarts ? 'phone starts' : 'computer starts';
  const ph = await P.handshake({
    initiator: phoneStarts,
    s: pA,
    rs: u8(B.pub),
    prologue: u8(prologue),
  });
  const pc = D.handshake({ initiator: !phoneStarts, s: B.priv, rs: A.pub, prologue });
  let got1, got2;
  if (phoneStarts) {
    got1 = pc.read(Buffer.from(await ph.write(text('one'))));
    got2 = await ph.read(u8(pc.write(Buffer.from('two'))));
  } else {
    got1 = await ph.read(u8(pc.write(Buffer.from('one'))));
    got2 = pc.read(Buffer.from(await ph.write(text('two'))));
  }
  ok(who + ': both handshake messages open', same(got1, text('one')) && same(got2, text('two')));
  const pk = await ph.split(),
    ck = pc.split();
  ok(
    who + ': keys mirror',
    same(pk.send, ck.recv) && same(pk.recv, ck.send) && same(pk.hash, ck.hash)
  );
  const ad = D.fields('env', 'device-a', 'device-b'),
    body = D.pad(Buffer.from('{"needs":["Moss: allow npm install?"]}'));
  const fromPhone = await P.seal(pk.send, 0, u8(ad), u8(body)),
    opened = D.open(ck.recv, 0, ad, Buffer.from(fromPhone));
  ok(
    who + ': the computer opens what the phone sealed',
    !!opened && same(D.unpad(opened), text('{"needs":["Moss: allow npm install?"]}'))
  );
  const fromPc = D.seal(ck.send, 7, ad, body),
    opened2 = await P.open(pk.recv, 7, u8(ad), u8(fromPc));
  ok(
    who + ': the phone opens what the computer sealed',
    !!opened2 && same(P.unpad(opened2), text('{"needs":["Moss: allow npm install?"]}'))
  );
  ok(
    who + ': same key, counter and data give the same sealed bytes',
    same(await P.seal(pk.send, 3, u8(ad), u8(body)), D.seal(Buffer.from(pk.send), 3, ad, body))
  );
  const bent = u8(fromPc);
  bent[5] ^= 1;
  ok(
    who + ': a changed byte, a wrong counter and wrong data are refused',
    (await P.open(pk.recv, 7, u8(ad), bent)) === null &&
      (await P.open(pk.recv, 8, u8(ad), u8(fromPc))) === null &&
      (await P.open(pk.recv, 7, text('other'), u8(fromPc))) === null
  );
}

// 3. Refusals: the wrong long-term key, a short message, calls out of order, a low-order key.
{
  const C = D.generateKeyPair();
  const ph = await P.handshake({ initiator: true, s: pA, rs: u8(B.pub), prologue: u8(prologue) });
  const stranger = D.handshake({ initiator: false, s: C.priv, rs: A.pub, prologue });
  let refused = false;
  try {
    stranger.read(Buffer.from(await ph.write()));
  } catch {
    refused = true;
  }
  ok("a computer with another key cannot read the phone's first message", refused);
  const pr = await P.handshake({ initiator: false, s: pB, rs: u8(A.pub), prologue: u8(prologue) });
  ok(
    'a message from the wrong sender is refused by the phone',
    await throws(async () =>
      pr.read(u8(D.handshake({ initiator: true, s: C.priv, rs: B.pub, prologue }).write()))
    )
  );
  const p2 = await P.handshake({ initiator: true, s: pA, rs: u8(B.pub) });
  ok('reading before writing is refused', await throws(() => p2.read(new Uint8Array(48))));
  ok('split before the end is refused', await throws(() => p2.split()));
  const p3 = await P.handshake({ initiator: false, s: pB, rs: u8(A.pub) });
  ok('a short message is refused', await throws(() => p3.read(new Uint8Array(31))));
  const p4 = await P.handshake({ initiator: false, s: pB, rs: u8(A.pub) });
  ok('an all-zero one-time key is refused', await throws(() => p4.read(new Uint8Array(48))));
  ok(
    'a wrong prologue does not connect',
    await throws(async () => {
      const a = await P.handshake({ initiator: true, s: pA, rs: u8(B.pub), prologue: text('x') });
      D.handshake({ initiator: false, s: B.priv, rs: A.pub, prologue: Buffer.from('y') }).read(
        Buffer.from(await a.write())
      );
    })
  );
  ok(
    'a bad key length is refused',
    await throws(() => P.handshake({ initiator: true, s: pA, rs: new Uint8Array(31) }))
  );
}

// 3b. From the security review of 2026-10-05: junk must not end a waiting handshake, and loose
// inputs are refused.
{
  for (const phoneStarts of [true, false]) {
    const who = phoneStarts ? 'phone starts' : 'computer starts';
    const ph = await P.handshake({
      initiator: phoneStarts,
      s: pA,
      rs: u8(B.pub),
      prologue: u8(prologue),
    });
    const pc = D.handshake({ initiator: !phoneStarts, s: B.priv, rs: A.pub, prologue });
    if (phoneStarts) pc.read(Buffer.from(await ph.write()));
    const real = u8(pc.write(Buffer.from('real')));
    const junk = crypto.getRandomValues(new Uint8Array(48)),
      bent = Uint8Array.from(real);
    bent[40] ^= 1;
    ok(
      who + ': junk and a changed message are refused',
      (await throws(() => ph.read(junk))) && (await throws(() => ph.read(bent)))
    );
    let got = null;
    try {
      got = await ph.read(real);
    } catch {}
    ok(who + ': the real message still opens after junk', !!got && same(got, text('real')));
    if (!phoneStarts) pc.read(Buffer.from(await ph.write()));
    ok(
      who + ': and the handshake finishes with matching keys',
      same((await ph.split()).send, pc.split().recv)
    );
  }
  const key = crypto.getRandomValues(new Uint8Array(32)),
    ad = text('ad'),
    body = text('x');
  ok(
    'seal refuses a counter of -1, 2^32, 1.5 and true',
    (await throws(() => P.seal(key, -1, ad, body))) &&
      (await throws(() => P.seal(key, 2 ** 32, ad, body))) &&
      (await throws(() => P.seal(key, 1.5, ad, body))) &&
      (await throws(() => P.seal(key, true, ad, body)))
  );
  ok(
    'seal refuses a 16-byte key, missing data and text in place of bytes',
    (await throws(() => P.seal(new Uint8Array(16), 0, ad, body))) &&
      (await throws(() => P.seal(key, 0, undefined, body))) &&
      (await throws(() => P.seal(key, 0, ad, 'x')))
  );
  ok(
    'open gives null for the same loose inputs',
    (await P.open(key, -1, ad, new Uint8Array(32))) === null &&
      (await P.open(new Uint8Array(16), 0, ad, new Uint8Array(32))) === null &&
      (await P.open(key, 0, undefined, new Uint8Array(32))) === null
  );
  ok(
    'the last allowed counter seals and opens',
    same(await P.open(key, 2 ** 32 - 1, ad, await P.seal(key, 2 ** 32 - 1, ad, body)), body)
  );
  ok(
    'fields refuses what is neither bytes nor text',
    (await throws(async () => P.fields(new ArrayBuffer(4)))) &&
      (await throws(async () => P.fields(1))) &&
      (await throws(async () => P.fields(undefined)))
  );
}

// 4. A key made on the phone cannot be exported, and works.
{
  const k = await P.generateKeyPair();
  ok(
    'a generated private key cannot be exported',
    (await throws(() => crypto.subtle.exportKey('pkcs8', k.priv))) &&
      (await throws(() => crypto.subtle.exportKey('jwk', k.priv)))
  );
  const ph = await P.handshake({ initiator: true, s: k, rs: u8(B.pub) }),
    pc = D.handshake({ initiator: false, s: B.priv, rs: Buffer.from(k.pub) });
  pc.read(Buffer.from(await ph.write()));
  await ph.read(u8(pc.write()));
  ok(
    'a generated key completes a handshake with a computer',
    same((await ph.split()).send, pc.split().recv)
  );
}

// 5. Fields, padding and hashing give the desktop's bytes.
{
  ok('fields', same(P.fields('a', text('bc'), '', 'δ'), D.fields('a', Buffer.from('bc'), '', 'δ')));
  ok(
    'a field over 65535 bytes is refused',
    await throws(async () => P.fields(new Uint8Array(0x10000)))
  );
  for (const len of [0, 1, 254, 255, 1022, 1023, 4094]) {
    const plain = Buffer.alloc(len, 7),
      dp = D.pad(plain),
      pp = P.pad(u8(plain));
    ok(
      'pad ' + len,
      same(dp, pp) && same(P.unpad(pp), plain) && same(D.unpad(Buffer.from(pp)), plain)
    );
  }
  ok('too long to pad is refused', await throws(async () => P.pad(new Uint8Array(4095))));
  ok(
    'unpad refuses a wrong size and a wrong length',
    P.unpad(new Uint8Array(100)) === null &&
      P.unpad(Uint8Array.of(0xff, 0xff, ...new Uint8Array(254))) === null
  );
  ok(
    'sha256',
    same(await P.sha256(text('ab'), text('c')), D.sha256(Buffer.from('ab'), Buffer.from('c')))
  );
  ok(
    'step sizes and the largest message',
    JSON.stringify(P.STEPS) === JSON.stringify(D.STEPS) && P.MAX_PLAIN === D.MAX_PLAIN
  );
}

console.log(failed ? failed + ' FAILED, ' + passed + ' passed' : 'all ' + passed + ' passed');
process.exit(failed ? 1 : 0);
