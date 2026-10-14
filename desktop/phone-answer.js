// Technically Not · phone-answer.js — another device's answer to one of this computer's open "needs
// you" items.
// Used by remote-service.js for a paired computer whose "may answer" switch is on,
// and by a stand-in computer in tests. No phone is wired to it yet: that
// needs its own review. Pure Node: the open items, the device's
// rights, the delivery and the sending are handed in. It is the first thing another device can make
// this computer DO, so it does one thing: a yes or no to a permission prompt. The rules, each of
// which is a check below (most of them come from a review that read the first draft as a
// phone that is hostile but paired):
//  - Only `answer` is read here; any other message is not this file's.
// - The phone must hold BOTH "see" and "answer" on this computer NOW (rights are read at each
// answer, never remembered), and this computer must be sending that phone the question text: nobody
// approves what they cannot read.
// - A limit of answers per device per minute, counted before anything is looked at; past it nothing
// is sent back.
// - The same rules hold a paired computer; its wiring does not
// call this file at all for a computer whose "may answer" switch is off.
// - Only a permission prompt. Never a line of text (that is sending a prompt, a different right),
// never a folder-trust question, never a menu, an error, a
// draft, or an item this computer only inferred.
// - The answer must name the exact prompt the phone was shown: its id AND `of`, a hash of the item
// as this computer lists it now (id, kind, agent, text, since). The app reuses an item id for an
// agent's next prompt; a yes meant for one prompt is refused for the next. Nothing else is read
// from the message: no path, command, agent, terminal or key.
// - At most once: the prompt is marked as taken BEFORE it is delivered and stays taken whatever the
// delivery does. A delivery that fails is not tried again from here; the user looks at the
// computer.
// - A refusal says "not_allowed" (about the phone's own rights) or "refused" (everything else): it
// does not tell a phone what is open or of which kind. What the app's own `deliver` must still
// guarantee is listed in section 6a; this file cannot.
const crypto = require('crypto');
const { clean } = require('./remote-keys.js');
const { fields } = require('./remote-noise.js');
const { shape } = require('./remote-api.js');

const WAYS = { permission: 'choice' };
const PER_MINUTE = 20;
const KEEP_MS = 60 * 1000; // a taken prompt stays taken this long after it closed

// The same bytes as `bindingOf` in phone/src/needs.mjs.
const bindingOf = it =>
  crypto
    .createHash('sha256')
    .update(
      fields(
        'tnai-answer-v1',
        it.id,
        it.kind,
        it.agent,
        it.detail || '',
        String(it.since),
        it.inferred ? '1' : '0'
      )
    )
    .digest()
    .subarray(0, 12)
    .toString('base64');

// items() → this computer's open items ({ id, paneId, kind, detail, since, inferred }).
// agentName(paneId) → the agent's name, as the list sender uses it. rights(phoneId) → what that
// phone may do here ({ see, answer }), or null. showDetail(phoneId) → whether this computer sends
// that phone the question text. deliver(item, say, phoneId) → true (or a promise of true) when
// "yes" or "no" reached the agent. send(phoneId, obj) → the link's send. receive() gives its
// result, or a promise of it when deliver gave one. full(shaped, item) → the shaped item with
// `full` and `can2` when its whole command may travel (`withFull` of remote-control.js, handed in
// because that file requires this one), bind(shaped) → the one binding an answer for it must carry
// (`bindingFor`: v2 for such an item, v1 for a `whole` one). Without `full` nothing changes: every
// item handed in is taken as `whole`, as before.
function phoneAnswers({
  items,
  rights,
  showDetail = () => true,
  agentName = () => '',
  deliver,
  send,
  now = Date.now,
  full = null,
  bind = bindingOf,
}) {
  const taken = new Map(),
    // "id\nof" of prompts an answer was taken for → when it was first seen closed (0: still open);
    // device id → times of its last answers
    recent = new Map();
  const listed = () => {
    // the open items exactly as the list sender shapes them, each with its binding
    const out = [];
    let all = [];
    try {
      all = items() || [];
    } catch {
      /* no items */
    }
    for (const it of all) {
      if (!it || typeof it !== 'object') continue;
      let name = '';
      try {
        name = agentName(it.paneId);
      } catch {
        /* no name */
      }
      let s = shape(
        {
          id: it.id,
          kind: it.kind,
          agent: name,
          detail: it.detail,
          since: it.since,
          inferred: it.inferred,
        },
        true
      );
      if (!s) continue;

      // An item that is not `whole` can be answered only through its full command, and only when
      // that still fits one message: the same rule, by the same function, as the list sender's.
      // Otherwise it is not listed here at all, so no binding matches it.
      if (full && it.whole !== true) {
        try {
          s = full(s, it);
        } catch {
          continue;
        }
        if (!s || s.can2 !== true) continue;
      }
      out.push({ it, s, of: bind(s) });
    }
    return out;
  };

  function receive(from, obj) {
    if (!obj || typeof obj !== 'object' || obj.t !== 'answer') return { ignored: true };
    const id = clean(obj.id, 80),
      of = typeof obj.of === 'string' ? obj.of.slice(0, 24) : '';
    const reply = why => {
      try {
        send(
          from,
          why ? { t: 'answered', id, of, ok: false, why } : { t: 'answered', id, of, ok: true }
        );
      } catch {
        /* no session */
      }
      return why ? { refused: why } : { ok: true };
    };

    // Counted first, before anything is looked at, and past the limit nothing is sent back at all
    // (a reply per message, without limit, was the one thing a device could
    // make this computer do with no right at all).
    const t = now(),
      mine = (recent.get(from) || []).filter(x => t - x < 60000);
    mine.push(t);
    recent.set(from, mine);
    if (mine.length > PER_MINUTE) {
      mine.pop();
      return { refused: 'limit' };
    }
    let may = null;
    try {
      may = rights(from);
    } catch {
      /* no rights */
    }
    if (!may || may.see !== true || may.answer !== true) return reply('not_allowed');
    let detail = false;
    try {
      detail = showDetail(from) === true;
    } catch {
      /* not shown */
    }
    const open = listed(),
      key = id + '\n' + of;

    // A taken prompt is remembered while it is open and for a minute after it was first seen closed
    // (OpenCode asks again under the same id when its server did not take the
    // reply; one press must not be delivered twice).
    for (const [k, closed] of [...taken]) {
      const isOpen = open.some(o => o.s.id + '\n' + o.of === k);
      if (closed) {
        if (t - closed >= KEEP_MS) taken.delete(k);
      } else if (!isOpen) taken.set(k, t);
    }
    const hit = id && of && detail ? open.find(o => o.s.id === id && o.of === of) : null;
    if (
      !hit ||
      WAYS[hit.s.kind] !== 'choice' ||
      hit.s.inferred ||
      !hit.s.detail ||
      taken.has(key) ||
      (obj.say !== 'yes' && obj.say !== 'no')
    )
      return reply('refused');
    taken.set(key, 0); // before the delivery, and for good: at most once
    let r;
    try {
      r = deliver({ id: hit.it.id, paneId: hit.it.paneId, kind: hit.s.kind }, obj.say, from);
    } catch {
      return reply('failed');
    }
    if (r && typeof r.then === 'function')
      return r.then(
        ok => reply(ok === true ? null : 'failed'),
        () => reply('failed')
      );
    return reply(r === true ? null : 'failed');
  }
  return { receive };
}

module.exports = { phoneAnswers, bindingOf, WAYS, PER_MINUTE, KEEP_MS };
