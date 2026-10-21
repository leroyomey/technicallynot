// Technically Not · remote-talk — Desktop only: the conversation of another computer's agent, read
// only, in the detail that 116 draws in the thread's main area.
//
// - What is drawn is what that computer sent when this one asked (the main process holds it; it
//   is read here by its own call, never from the pushed state). It is marked "As (name) reported
//   it" and drawn in the Readable view's look, but with none of its handlers: no decision, option,
//   helper or terminal button, nothing that reaches an agent of this computer. A say is drawn
//   through the app's markdown, which escapes every tag and fetches nothing.
// - The only button is "Show earlier". A grown turn counter on the row asks for what is new.
// - Keys are "computer id + line break + row id", never a bare panel id, so another computer's
//   "p3" is never this computer's "p3".
//
// window.TnaiRemoteTalk (show). Hook: 116 `paint` calls show(main area, shown agent) or
// show(null). Look: 40-thread-history.css with 30-thread-readable.css. Check: proof 31 of
// tools/desktop-check/remote-check.js.
(() => {
  'use strict';
  const native = window.tnaiNative?.remote;
  if (!native?.log || !native?.askLog) return;

  const SEP = '\n';
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const call = async (name, ...args) => {
    const result = await native[name](...args);
    if (result && result.ok === false) throw result.error || {};
    return result && typeof result === 'object' && 'value' in result ? result.value : result;
  };
  const duration = ms => {
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return seconds + 's';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + 'm ' + (seconds % 60) + 's';
    return Math.floor(minutes / 60) + 'h ' + (minutes % 60) + 'm';
  };

  // the section, built once and moved into whichever detail box is shown
  let section = null;
  let ui = null;

  // the agent shown now, what is held of it, and the one timer (an ask that came too early)
  let shown = null;
  let held = null;
  let heldAt = 0;
  let reading = false;
  let askState = '';
  let retryTimer = 0;

  function build() {
    section = make('section', 'ap-term-sec ap-talk-sec');
    section.dataset.sec = 'talk';
    const bar = make('div', 'ap-term-bar');
    const tools = make('span', 'ap-term-tools');
    const from = make('em');
    const earlier = make('button', 'ap-font', 'Show earlier');
    earlier.type = 'button';
    tools.append(from, earlier);
    bar.append(make('span', '', 'CONVERSATION'), tools);
    const body = make('div', 'ap-term ap-talk');
    body.tabIndex = 0;
    const list = make('div', 'tnt-talk-list');
    const note = make('p', 'ap-none');
    body.append(note, list);
    section.append(bar, body);
    ui = { from, earlier, body, list, note };

    // the one control: one press, one ask
    earlier.addEventListener('click', () => {
      if (!shown || earlier.disabled) return;
      ask('earlier');
    });
  }

  function setNote(text) {
    if (ui.note.textContent !== text) ui.note.textContent = text;
    ui.note.hidden = !text;
  }

  // One entry as plain nodes. Nothing here is a button or a link.
  function entryNode(entry) {
    if (!entry || typeof entry !== 'object') return null;
    if (entry.k === 'you') return make('div', 'tnt-you', entry.text);
    if (entry.k === 'say') {
      const block = make('div', 'tnt-say');
      const markdown = window.TnaiResults?.markdown;
      if (typeof markdown === 'function') block.innerHTML = markdown(String(entry.text || ''));
      else block.textContent = entry.text;

      // the markdown escapes every tag; a link or picture would still be one press away, so it
      // is turned back into its words
      block.querySelectorAll('a, img').forEach(node => node.replaceWith(node.textContent || ''));

      // The copy icon on each code block, as in this computer's own conversations (122). It
      // copies the block's text to this computer's clipboard and reaches nothing else.
      window.TnaiThreadReadable?.copyButtons?.(block);
      return block;
    }
    if (entry.k === 'act') {
      const line = make('div', 'tnt-act');
      line.append(
        make('span', 'tnt-act-verb', entry.verb),
        make('span', 'tnt-act-what', entry.what)
      );
      return line;
    }
    if (entry.k === 'ask') {
      const box = make('section', 'tnt-askbox');
      for (const item of entry.questions || []) {
        if (item.q) box.append(make('b', '', item.q));
        const options = make('ul');
        (item.options || []).forEach(option => options.append(make('li', '', option)));
        if (options.children.length) box.append(options);
      }
      return box;
    }
    if (entry.k === 'worked')
      return make('div', 'tnt-worked', entry.ms ? 'Worked for ' + duration(entry.ms) : 'Finished');
    if (entry.k === 'note') return make('div', 'tnt-note', entry.text);
    return null;
  }

  function draw(keepPlace) {
    const name = shown ? shown.pcName : '';
    const atEnd = ui.body.scrollHeight - ui.body.scrollTop - ui.body.clientHeight < 24;
    const before = ui.body.scrollHeight - ui.body.scrollTop;
    const nodes = (held?.entries || []).map(entryNode).filter(Boolean);
    ui.list.replaceChildren(...nodes);
    ui.from.textContent = held && nodes.length ? 'As ' + name + ' reported it' : '';

    // what the line above the conversation says, at most one thing
    let words = '';
    if (!nodes.length) {
      if (reading || askState === 'asked') words = 'Reading the conversation…';
      else if (askState === 'busy' || held?.state === 'busy')
        words = 'Busy on ' + name + '. Try again in a minute.';
      else if (held?.state === 'no_reply') words = name + ' did not answer.';
      else if (askState === 'not_sent') words = name + ' is not connected for this.';
      else if (held) words = 'Nothing of this conversation is shared yet.';
    } else if (held?.full) words = 'The rest is on ' + name + '’s CLI screen.';
    else if (held?.older && !held?.more) words = 'Earlier parts are not shared.';
    else if (held?.state === 'busy') words = 'Busy on ' + name + '. Try again in a minute.';
    setNote(words);
    ui.earlier.hidden = !(held && held.more && !held.full && nodes.length);

    // a new answer at the end follows the end; earlier parts keep the place being read
    if (keepPlace) ui.body.scrollTop = ui.body.scrollHeight - before;
    else if (atEnd) ui.body.scrollTop = ui.body.scrollHeight;
  }

  async function fetchHeld(keepPlace) {
    const mine = shown;
    reading = true;
    let got = null;
    try {
      got = await call('log', mine.pcId, mine.agId);
    } catch {
      got = null;
    }
    reading = false;
    if (shown !== mine) return;
    held = got && typeof got === 'object' && Array.isArray(got.entries) ? got : null;
    draw(keepPlace);
  }

  async function ask(which) {
    const mine = shown;
    if (!mine) return;
    clearTimeout(retryTimer);
    retryTimer = 0;
    let result = null;
    try {
      result = await call('askLog', mine.pcId, mine.agId, which);
    } catch {
      result = null;
    }
    if (shown !== mine) return;
    askState = result?.state || 'not_sent';

    // asked too early: once more when the wait is over, for this agent only
    if (askState === 'too_often' && which !== 'earlier' && result.wait > 0)
      retryTimer = setTimeout(
        () => {
          retryTimer = 0;
          if (shown === mine) ask(which);
        },
        Math.min(result.wait + 50, 60000)
      );
    if (which === 'earlier') mine.earlierAsked = true;
    draw(false);
  }

  // 116 shows an agent of another computer (t = { pc, ag, pcName }), or nothing (null).
  function show(main, t) {
    if (!main || !t || !t.ag) {
      if (section) section.hidden = true;
      clearTimeout(retryTimer);
      retryTimer = 0;
      shown = null;
      held = null;
      heldAt = 0;
      return;
    }
    if (!section) build();
    if (section.parentElement !== main) main.prepend(section);
    section.hidden = false;
    const key = t.pc.id + SEP + t.ag.id;
    if (!shown || shown.key !== key) {
      clearTimeout(retryTimer);
      retryTimer = 0;
      shown = { key, pcId: t.pc.id, agId: t.ag.id, pcName: t.pcName };
      held = null;
      heldAt = 0;
      askState = '';
      ui.list.replaceChildren();
      if (t.ag.talk) ask('first');
    }
    shown.pcName = t.pcName;
    if (!t.ag.talk) {
      ui.list.replaceChildren();
      ui.from.textContent = '';
      ui.earlier.hidden = true;
      setNote(
        t.pcName +
          ' does not let this computer read its agents’ conversations. It is turned on on ' +
          t.pcName +
          ', on its Devices page.'
      );
      return;
    }
    const mark = t.ag.log;

    // what is held changed in the main process: read it again
    if (mark && mark.at !== heldAt) {
      const keep = heldAt > 0 && held && shown.earlierAsked === true;
      heldAt = mark.at;
      shown.earlierAsked = false;
      fetchHeld(keep);
    }

    // the agent's turn counter grew past what is held: what is new is asked for
    if (mark && Number.isInteger(t.ag.rev) && t.ag.rev > mark.rev && !retryTimer) {
      if (shown.askedRev !== t.ag.rev) {
        shown.askedRev = t.ag.rev;
        ask('new');
      }
    }
    if (!mark && !reading) draw(false);
  }

  window.TnaiRemoteTalk = { show };
})();
