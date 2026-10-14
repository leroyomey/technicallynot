// Test of desktop/remote-noise.js: node tools/remote-noise-test.js (plain Node; also run it in
// Electron's Node, see the last line). The handshake must reproduce the published vector byte for
// byte; the rest checks what the protocol doc promises (section 5).
const noise = require('../desktop/remote-noise.js');
const vector = require('./remote-noise-vector.js');

let passed = 0,
  failed = 0;

function check(name, ok) {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name);
  }
}
const hex = s => Buffer.from(s, 'hex');
const throws = fn => {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
};

// ---- the published vector: both handshake messages and the two transport messages ----
{
  const a = noise.handshake({
    initiator: true,
    s: hex(vector.init_static),
    rs: hex(vector.init_remote_static),
    prologue: hex(vector.init_prologue),
    e: hex(vector.init_ephemeral),
  });
  const b = noise.handshake({
    initiator: false,
    s: hex(vector.resp_static),
    rs: hex(vector.resp_remote_static),
    prologue: hex(vector.resp_prologue),
    e: hex(vector.resp_ephemeral),
  });
  const [m1, m2, m3, m4] = vector.messages;
  const w1 = a.write(hex(m1.payload));
  check('vector: message 1 ciphertext', w1.toString('hex') === m1.ciphertext);
  check('vector: message 1 read', b.read(w1).toString('hex') === m1.payload);
  const w2 = b.write(hex(m2.payload));
  check('vector: message 2 ciphertext', w2.toString('hex') === m2.ciphertext);
  check('vector: message 2 read', a.read(w2).toString('hex') === m2.payload);
  const ka = a.split(),
    kb = b.split();
  check(
    'split: each side sends with the key the other receives with',
    ka.send.equals(kb.recv) && ka.recv.equals(kb.send) && !ka.send.equals(ka.recv)
  );
  check('split: both sides hold the same handshake hash', ka.hash.equals(kb.hash));
  const none = Buffer.alloc(0);
  check(
    'vector: transport message from the starter',
    noise.seal(ka.send, 0, none, hex(m3.payload)).toString('hex') === m3.ciphertext
  );
  check(
    'vector: transport message from the answerer',
    noise.seal(kb.send, 0, none, hex(m4.payload)).toString('hex') === m4.ciphertext
  );
  check(
    'transport: opens with the right key and counter',
    noise.open(kb.recv, 0, none, hex(m3.ciphertext)).toString('hex') === m3.payload
  );
  check(
    'transport: wrong counter does not open',
    noise.open(kb.recv, 1, none, hex(m3.ciphertext)) === null
  );
  check(
    'transport: a message cannot be turned around (other direction key)',
    noise.open(ka.recv, 0, none, hex(m3.ciphertext)) === null
  );
  check(
    'transport: changed associated data does not open',
    noise.open(kb.recv, 0, Buffer.from('x'), hex(m3.ciphertext)) === null
  );
  const flipped = hex(m3.ciphertext);
  flipped[3] ^= 1;
  check('transport: a changed byte does not open', noise.open(kb.recv, 0, none, flipped) === null);
  check(
    'transport: too short does not open',
    noise.open(kb.recv, 0, none, Buffer.alloc(5)) === null
  );
  check(
    'split: only once',
    throws(() => a.split())
  );
}

// ---- fresh keys: two computers that paired agree; anyone else does not ----
{
  const A = noise.generateKeyPair(),
    B = noise.generateKeyPair(),
    X = noise.generateKeyPair();
  check(
    'keys: 32 bytes, public matches private',
    A.priv.length === 32 && A.pub.length === 32 && noise.publicFromPrivate(A.priv).equals(A.pub)
  );
  const prologue = noise.fields('1', 'device-a', 'device-b', Buffer.alloc(16, 7));
  const run = (sa, rsa, sb, rsb, pa = prologue, pb = prologue) => {
    const a = noise.handshake({ initiator: true, s: sa, rs: rsa, prologue: pa }),
      b = noise.handshake({ initiator: false, s: sb, rs: rsb, prologue: pb });
    b.read(a.write());
    a.read(b.write(Buffer.from('hello')));
    return [a.split(), b.split()];
  };
  const [ka, kb] = run(A.priv, B.pub, B.priv, A.pub);
  check('fresh: session keys agree', ka.send.equals(kb.recv) && ka.recv.equals(kb.send));
  const [k2] = run(A.priv, B.pub, B.priv, A.pub);
  check('fresh: every connection gets new keys', !k2.send.equals(ka.send));
  check(
    'wrong key: a stranger posing as the starter is refused',
    throws(() => run(X.priv, B.pub, B.priv, A.pub))
  );
  check(
    'wrong key: a stranger posing as the answerer is refused',
    throws(() => run(A.priv, B.pub, X.priv, A.pub))
  );
  check(
    'prologue: a different pairing id is refused',
    throws(() =>
      run(
        A.priv,
        B.pub,
        B.priv,
        A.pub,
        prologue,
        noise.fields('1', 'device-a', 'device-b', Buffer.alloc(16, 8))
      )
    )
  );
  check(
    'prologue: a different version is refused',
    throws(() =>
      run(
        A.priv,
        B.pub,
        B.priv,
        A.pub,
        prologue,
        noise.fields('2', 'device-a', 'device-b', Buffer.alloc(16, 7))
      )
    )
  );
  check(
    'all-zero key agreement ends the handshake',
    throws(() => noise.handshake({ initiator: true, s: A.priv, rs: Buffer.alloc(32) }).write())
  );
  const a = noise.handshake({ initiator: true, s: A.priv, rs: B.pub });
  check(
    'order: the starter cannot read first',
    throws(() => a.read(Buffer.alloc(48)))
  );
  check(
    'order: split before the end is refused',
    throws(() => a.split())
  );
  check(
    'bad key length is refused',
    throws(() => noise.handshake({ initiator: true, s: Buffer.alloc(31), rs: B.pub }))
  );
}

// ---- length-prefixed fields and padding ----
{
  check(
    'fields: ("ab","c") differs from ("a","bc")',
    !noise.fields('ab', 'c').equals(noise.fields('a', 'bc'))
  );
  for (const [len, step] of [
    [0, 256],
    [100, 256],
    [254, 256],
    [255, 1024],
    [1022, 1024],
    [1023, 4096],
    [4094, 4096],
  ]) {
    const plain = Buffer.alloc(len, 0x41),
      padded = noise.pad(plain);
    check(
      `pad: ${len} bytes → the ${step} step and back`,
      padded.length === step && noise.unpad(padded).equals(plain)
    );
  }
  check(
    'pad: more than one envelope holds is refused',
    throws(() => noise.pad(Buffer.alloc(4095)))
  );
  check('unpad: a size that is no step is refused', noise.unpad(Buffer.alloc(300)) === null);
  const lying = Buffer.alloc(256);
  lying.writeUInt16BE(9999);
  check('unpad: a length beyond the buffer is refused', noise.unpad(lying) === null);
  check(
    'sealed size shows only the step: 3 and 200 bytes look the same',
    noise.seal(Buffer.alloc(32, 1), 0, Buffer.alloc(0), noise.pad(Buffer.alloc(3))).length ===
      noise.seal(Buffer.alloc(32, 1), 0, Buffer.alloc(0), noise.pad(Buffer.alloc(200))).length
  );
}

// A junk answer leaves the waiting handshake as it was: the real answer after it is still read
// (phone security review, 2026-10-05).
{
  const a = noise.generateKeyPair(),
    b = noise.generateKeyPair();
  const start = noise.handshake({ initiator: true, s: a.priv, rs: b.pub }),
    answer = noise.handshake({ initiator: false, s: b.priv, rs: a.pub });
  const m1 = start.write();
  let junk1 = false;
  try {
    answer.read(Buffer.alloc(64, 9));
  } catch {
    junk1 = true;
  }
  let short = false;
  try {
    answer.read(Buffer.alloc(8));
  } catch {
    short = true;
  }
  answer.read(m1);
  const m2 = answer.write();
  let junk2 = false;
  try {
    start.read(Buffer.alloc(80, 7));
  } catch {
    junk2 = true;
  }
  let wrong = false;
  try {
    start.read(Buffer.concat([m2.subarray(0, 32), Buffer.alloc(m2.length - 32, 1)]));
  } catch {
    wrong = true;
  }
  let real = true;
  try {
    start.read(m2);
  } catch {
    real = false;
  }
  const ka = real ? start.split() : null,
    kb = answer.split();
  check('junk before message 1 and before message 2 is refused', junk1 && short && junk2 && wrong);
  check(
    'the real messages are still read after the junk, and both sides get the same keys',
    real && ka.send.equals(kb.recv) && ka.recv.equals(kb.send)
  );
}

console.log(
  `${passed} passed, ${failed} failed (${process.versions.electron ? 'Electron ' + process.versions.electron : 'Node ' + process.versions.node})`
);
process.exit(failed ? 1 : 0);

// In Electron's Node (what the app runs): $env:ELECTRON_RUN_AS_NODE=1;
// .\node_modules\.bin\electron.cmd tools\remote-noise-test.js
