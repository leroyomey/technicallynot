// Technically Not phone app · screens.mjs — the phone's control screens, as in the approved look
// (docs/plans/design-concepts/phone-app.html, screens 2, 3, 4 and 9): Agents (every agent of every
// paired computer), one agent (its question with options, task, last report, conversation,
// Interrupt, Stop and a message box), Start an agent, and Activity (finished tasks). The rules are
// in ../src/control.mjs and ../src/conversation.mjs; this file only shows what they hold and hands
// the presses over. Everything a computer sends is set as text only, never as markup.
//
// What a computer lets this phone do is decided and switched on at that computer ("full
// control", off by default): without it the screens show what it reports and say where the switch
// is. Every press answers on the button itself, since the line about it may be off screen.
import { createControl, promptOk } from '../src/control.mjs';
import { createConversation } from '../src/conversation.mjs';
import { createWatch } from '../src/watch.mjs';
import { icon } from './icons.mjs';

// The CLIs a computer can start, by its fixed words.
const CLI_NAMES = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode', cursor: 'Cursor' };

// How each operation's word reads on its button and in the agent's list of what was asked.
const WORDS = {
  asked: 'Sending…',
  sent: 'Sent',
  queued: 'Held there, goes next',
  unconfirmed: 'Sent, not confirmed it started',
  done: 'Done',
  unsent: 'Interrupted, its prompt is back in the box',
  started: 'Started',
  busy: 'Not now: it is working',
  refused: 'Refused by the computer',
  failed: 'The computer could not do it',
  not_sent: 'Not sent: not connected',
  too_long: 'Too long for one message',
  no_reply: 'No reply from the computer',
};
const STATUS = {
  working: ['Working', 'c-work'],
  needs: ['Needs you', 'c-wait'],
  idle: ['Idle', 'c-idle'],
};
const OP_LABEL = {
  prompt: 'Message',
  act: '',
  choose: 'Choice',
  start: 'Start',
  thread: '',
  resume: 'Resume',
};

export function createScreens({ el, $, show, label, send, onChanged = () => {} }) {
  let screen = '';

  // the agent the Agent screen shows: { peer, id }; the Agents filter; the start form
  let open = null;
  let filter = 'all';
  let startPick = { peer: '', cli: '' };
  let stopArmed = '';

  const control = createControl({ send, on: { changed: () => repaint() } });
  const talk = createConversation({
    send,
    row: (peer, agentId) => {
      const v = control.view(peer);
      const a = v && v.state !== 'offline' ? v.agents.find(x => x.id === agentId) : null;
      return a && a.lk ? { id: a.id, lk: a.lk } : null;
    },
    on: { changed: () => repaint() },
  });

  // Watch: one view of one agent's screen at a time (watch.mjs).
  const watch = createWatch({
    send,
    fields: (peer, agentId) => control.viewFields(peer, agentId),
    on: { changed: () => repaint() },
  });

  // A repaint waits for the next frame, so a burst of messages paints once.
  let queued = false;

  function repaint() {
    onChanged();
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      paint();
    });
  }

  // A field of the agent screen that has the focus is never redrawn under the user's fingers (the
  // phone's keyboard would close): the screen is drawn again when the focus leaves it.
  const typingIn = box =>
    box.contains(document.activeElement) && document.activeElement.tagName === 'INPUT';

  function paint() {
    if (screen === 'agents') paintAgents();
    if (screen === 'agent' && !typingIn($('agentBody'))) paintAgent();
    if (screen === 'start') paintStart();
    if (screen === 'activity') paintActivity();
  }

  const ago = t => {
    if (!t) return '';
    const m = Math.max(0, Math.round((Date.now() - t) / 60000));
    return m < 1 ? 'now' : m < 60 ? m + 'm' : Math.round(m / 60) + 'h';
  };
  const views = () =>
    control
      .ids()
      .map(id => ({ id, v: control.view(id) }))
      .filter(x => x.v);
  const stateLine = v =>
    v.state === 'live'
      ? 'online'
      : v.state === 'stale'
        ? 'not heard for a while'
        : 'offline · last heard ' + ago(v.heard) + ' ago';
  const tile = name => el('span', 'tile', (name || '?').slice(0, 1).toUpperCase());

  // A button that answers on itself: its word for a few seconds, then its own label again.
  function answerOn(button, word) {
    const own = button.dataset.label || button.textContent;
    button.dataset.label = own;
    button.textContent = WORDS[word] || word;
    clearTimeout(button._t);
    button._t = setTimeout(() => {
      button.textContent = own;
    }, 4000);
  }

  // ---- Agents ----
  function paintAgents() {
    const all = views();
    const rows = all.flatMap(x => x.v.agents);
    $('agentsCount').textContent = all.length === 1 ? '1 computer' : all.length + ' computers';
    const counts = {
      all: rows.length,
      working: rows.filter(a => a.status === 'working').length,
      needs: rows.filter(a => a.status === 'needs').length,
    };
    const chips = $('agentsChips');
    chips.textContent = '';
    for (const [key, text, dot] of [
      ['all', 'All', ''],
      ['working', 'Working', 'c-work'],
      ['needs', 'Needs you', 'c-wait'],
    ]) {
      const b = el('button', 'chip' + (filter === key ? ' on' : ''));
      if (dot) b.append(el('span', 'dot ' + dot));
      b.append(text + ' ', el('b', '', String(counts[key])));
      b.onclick = () => {
        filter = key;
        paintAgents();
      };
      chips.append(b);
    }
    const box = $('agentsList');
    box.textContent = '';
    if (!all.length) {
      box.append(
        el(
          'p',
          'note',
          'No computer is connected. Agents show here once a paired computer is online.'
        )
      );
      return;
    }
    for (const { id, v } of all) box.append(computerCard(id, v));
  }

  function computerCard(id, v) {
    const card = el('section', 'surf' + (v.state === 'offline' ? ' asleep' : ''));
    const head = el('div', 'ghead');
    head.append(el('b', '', label(id)), el('span', 'meta', stateLine(v)));
    card.append(head);
    const shown = v.agents.filter(a => filter === 'all' || a.status === filter);
    const root = v.project ? v.project.root : '';
    const groups = [
      ['Open there', shown.filter(a => root && a.p === root)],
      ['Another project', shown.filter(a => !root || a.p !== root)],
    ];
    for (const [name, list] of groups) {
      if (!list.length) continue;
      card.append(el('div', 'proj', name));
      const rows = el('div', 'rows');
      for (const a of list) rows.append(agentRow(id, v, a));
      card.append(rows);
    }
    if (!shown.length)
      card.append(el('p', 'note', v.agents.length ? 'None in this filter.' : 'No agents.'));
    if (v.state === 'offline')
      card.append(el('p', 'note', 'Shown as last heard. Nothing here is live until it is back.'));
    else if (!v.control)
      card.append(
        el(
          'p',
          'note',
          'Seen only. Full control for this phone is switched on at that computer, on its Devices page.'
        )
      );
    return card;
  }

  function agentRow(peer, v, a) {
    const b = el('button', 'row');
    const text = el('div', 'grow');
    text.append(
      el('b', '', a.name),
      el('span', 'meta', [a.cli, a.task].filter(Boolean).join(' · '))
    );
    const [word, cls] = v.state === 'offline' ? ['As last heard', 'c-idle'] : STATUS[a.status];
    const st = el('span', 'st ' + cls, word);
    st.append(el('i', '', ago(a.since)));
    b.append(tile(a.name), text, st);
    b.onclick = () => openAgent(peer, a.id);
    return b;
  }

  function openAgent(peer, id) {
    open = { peer, id };
    stopArmed = '';
    $('agentText').value = '';
    show('agent');
    talk.ask(peer, id, talk.get(peer, id) ? 'new' : 'first');
  }

  // ---- one agent ----
  function paintAgent() {
    const v = open ? control.view(open.peer) : null;
    const a = v ? v.agents.find(x => x.id === open.id) : null;
    const box = $('agentBody');
    box.textContent = '';
    if (!a) {
      $('agentName').textContent = 'Agent';
      $('agentMeta').textContent = '';
      box.append(el('p', 'note', "This agent is no longer in its computer's list."));
      $('agentStop').hidden = true;
      $('agentSend').hidden = true;
      return;
    }
    const can = !!(v.control && a.to && v.state !== 'offline');
    $('agentTile').textContent = a.name.slice(0, 1).toUpperCase();
    $('agentName').textContent = a.name;
    $('agentMeta').textContent = [a.cli, label(open.peer)].filter(Boolean).join(' · ');
    $('agentStop').hidden = !can;
    $('agentStop').classList.toggle('on', stopArmed === a.id);
    $('agentSend').hidden = !can;
    $('agentText').placeholder = 'Message ' + a.name;
    for (const q of v.choices.filter(c => c.row === a.id)) box.append(choiceCard(v, q, can));
    const [word, cls] = STATUS[a.status];
    const task = el('article', 'surf');
    task.append(el('span', 'lbl ' + cls, word + ' · ' + ago(a.since)));
    task.append(el('p', '', a.task || 'Its task is not shared with this phone.'));
    if (can) task.append(controlsRow(a));
    box.append(task);
    const report = v.reports.find(r => r.id === a.id && r.name === a.name);
    if (report) box.append(reportCard(report));
    box.append(conversationCard(a));
    if (can && v.control.watch) box.append(watchCard(a));
    if (can) box.append(threadCard(a));
    const asked = v.ops.filter(o => o.id === a.id).slice(0, 5);
    if (asked.length) box.append(askedCard(asked));
    if (!can)
      box.append(
        el(
          'p',
          'note',
          v.state === 'offline'
            ? 'That computer is offline. Nothing can be sent until it is back.'
            : 'This phone can see this agent but not control it. Full control is switched on at that computer, on its Devices page.'
        )
      );
  }

  function choiceCard(v, q, can) {
    const card = el('article', 'surf wait');
    card.append(el('span', 'lbl c-wait', 'Needs you · asks you to choose'));
    card.append(el('p', 'q', q.detail));
    const acts = el('div', 'acts opts');
    q.opts.forEach((text, index) => {
      const b = el('button', 'btn' + (index === 0 ? ' pri' : ''), index + 1 + '. ' + text);
      b.disabled = !can;
      b.onclick = async () => {
        const r = await control.choose(open.peer, q.id, index + 1, q.kof);
        answerOn(b, r.state);
      };
      acts.append(b);
    });
    card.append(acts);
    return card;
  }

  const WATCH_WHY = {
    refused: 'That computer did not start the view.',
    busy: 'That computer is showing another view right now.',
    spent: "Today's watching time on that computer is used up.",
    timeout: 'The view ended after ten minutes.',
    gone: 'The view ended on the computer.',
    off: 'That computer no longer lets this phone watch.',
    offline: 'That computer went offline.',
    no_reply: 'That computer did not answer.',
    flood: 'Too many pictures came at once, so the view was stopped.',
    bad: 'The pictures could not be read, so the view was stopped.',
    hidden: 'Stopped while the app was out of view.',
    closed: 'Stopped.',
  };

  // Watch: the agent's screen as text rows, Keep watching and Stop. Costs the computer's daily
  // allowance, so it starts only on a press.
  function watchCard(a) {
    const card = el('article', 'surf');
    card.append(el('span', 'lbl', 'Live screen'));
    const m = watch.model();
    const mine = m && m.peer === open.peer && m.agent === a.id;
    if (!mine) {
      const start = el('button', 'btn small', 'Watch');
      start.onclick = async () => answerOn(start, (await watch.open(open.peer, a.id)).state);
      card.append(
        el(
          'p',
          'note',
          "Shows this agent's screen for ten minutes, from that computer's daily allowance."
        ),
        start
      );
      return card;
    }
    if (m.state === 'asked') card.append(el('p', 'note', 'Asking the computer…'));
    if (m.picture) {
      const text = m.picture.lines.map(l => l.t).join(String.fromCharCode(10));
      const pic = el('pre', 'screenview', text);
      card.append(pic);
      if (m.picture.incomplete)
        card.append(el('p', 'note', 'Some rows may be missing until the next full picture.'));
    }
    const acts = el('div', 'acts');
    if (m.state === 'on') {
      const left = Math.max(0, Math.round((m.until - performance.now()) / 60000));
      card.append(el('p', 'meta', 'Live · ends in about ' + left + ' min'));
      const more = el('button', 'btn small', 'Keep watching');
      more.onclick = async () =>
        answerOn(more, (await watch.keep()) ? 'Ten more minutes' : 'Not yet');
      acts.append(more);
    } else if (m.state === 'ended')
      card.append(el('p', 'note', WATCH_WHY[m.why] || 'The view ended.'));
    const stop = el('button', 'btn small', m.state === 'ended' ? 'Close' : 'Stop watching');
    stop.onclick = () => watch.close('closed');
    acts.append(stop);
    card.append(acts);
    return card;
  }

  // The thread's own controls (plan item 44): rename and close for every CLI; model and effort only
  // where the CLI takes them as a typed command (Claude Code). The access level is set only on the
  // computer itself (user decision 2026-10-21), so it is not here.
  const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
  let closeArmed = { id: '', at: 0 };

  function threadCard(a) {
    const card = el('article', 'surf');
    card.append(el('span', 'lbl', 'Thread'));
    const name = el('div', 'field');
    const nameIn = el('input');
    nameIn.placeholder = 'New name';
    nameIn.maxLength = 40;
    nameIn.setAttribute('aria-label', 'New name for ' + a.name);
    const rename = el('button', 'btn small', 'Rename');
    rename.onclick = async () => {
      const v = nameIn.value.trim();
      if (!v) return;
      answerOn(rename, (await control.thread(open.peer, a.id, 'rename', v)).state);
    };
    name.append(nameIn, rename);
    card.append(name);
    if (a.cli === 'Claude Code') {
      const model = el('div', 'field');
      const modelIn = el('input');
      modelIn.placeholder = 'Model, for example opus';
      modelIn.maxLength = 64;
      modelIn.setAttribute('aria-label', 'Model for ' + a.name);
      const setModel = el('button', 'btn small', 'Switch');
      setModel.onclick = async () => {
        const v = modelIn.value.trim();
        if (!v) return;
        answerOn(setModel, (await control.thread(open.peer, a.id, 'model', v)).state);
      };
      model.append(modelIn, setModel);
      const chips = el('div', 'chips');
      for (const word of EFFORTS) {
        const c = el('button', 'chip', word);
        c.onclick = async () =>
          answerOn(c, (await control.thread(open.peer, a.id, 'effort', word)).state);
        chips.append(c);
      }
      card.append(model, el('span', 'meta', 'Effort'), chips);
    }
    const closeIt = el('button', 'btn danger', 'Close thread');

    // two presses within five seconds; kept outside the card, which a repaint draws again
    closeIt.onclick = async () => {
      if (closeArmed.id !== a.id || Date.now() - closeArmed.at > 5000) {
        closeArmed = { id: a.id, at: Date.now() };
        answerOn(closeIt, 'Press again to close');
        return;
      }
      closeArmed = { id: '', at: 0 };
      answerOn(closeIt, (await control.thread(open.peer, a.id, 'close')).state);
    };
    card.append(closeIt);
    return card;
  }

  function controlsRow(a) {
    const acts = el('div', 'acts');
    const pause = el('button', 'btn', 'Interrupt');
    pause.onclick = async () =>
      answerOn(pause, (await control.act(open.peer, a.id, 'interrupt')).state);
    acts.append(pause);
    return acts;
  }

  function reportCard(r) {
    const card = el('article', 'surf');
    card.append(el('span', 'lbl', 'Last report · ' + ago(r.at) + ' ago'));
    if (r.did) card.append(el('p', '', r.did));
    if (r.text) card.append(el('p', 'out', r.text));
    if (r.more) card.append(el('p', 'note', r.more + ' more characters are on the computer.'));
    return card;
  }

  const LOG_STATE = {
    reading: 'Reading the conversation…',
    busy: 'The computer is busy. Try again in a moment.',
    no_reply: 'The computer did not send the conversation.',
  };

  function conversationCard(a) {
    const card = el('article', 'surf');
    card.append(el('span', 'lbl', 'Conversation'));
    const log = talk.get(open.peer, a.id);
    if (!a.lk) {
      card.append(
        el('p', 'note', "That computer does not share this agent's conversation with this phone.")
      );
      return card;
    }
    if (!log || !log.entries.length) {
      card.append(el('p', 'note', (log && LOG_STATE[log.state]) || 'Nothing to show yet.'));
    } else {
      if (log.more) {
        const earlier = el('button', 'btn small', 'Show earlier');
        earlier.onclick = async () =>
          answerOn(earlier, (await talk.ask(open.peer, a.id, 'earlier')).state);
        card.append(earlier);
      }
      const list = el('div', 'log');
      for (const e of log.entries) list.append(entryLine(e));
      card.append(list);
    }
    const again = el('button', 'btn small', 'Look again');
    again.onclick = async () => {
      const r = await talk.ask(open.peer, a.id, 'new');
      answerOn(
        again,
        r.state === 'too_often' ? 'Wait a few seconds' : r.state === 'asked' ? 'Asked' : r.state
      );
    };
    card.append(again);
    return card;
  }

  // One entry of a conversation, as text only.
  function entryLine(e) {
    if (e.k === 'you') return el('p', 'you', e.text);
    if (e.k === 'say') return el('p', 'say', e.text);
    if (e.k === 'act') return el('p', 'act', e.verb + (e.what ? ' ' + e.what : ''));
    if (e.k === 'ask') return el('p', 'act', 'Asked: ' + e.questions.map(q => q.q).join(' · '));
    if (e.k === 'worked')
      return el('p', 'act', 'Worked ' + Math.max(1, Math.round(e.ms / 1000)) + ' s');
    return el('p', 'act', e.text || '');
  }

  function askedCard(list) {
    const card = el('article', 'surf');
    card.append(el('span', 'lbl', 'Asked from this phone'));
    for (const o of list) {
      const what =
        o.kind === 'act'
          ? o.do === 'stop'
            ? 'Stop'
            : 'Interrupt'
          : o.kind === 'thread'
            ? o.do
            : OP_LABEL[o.kind];
      card.append(el('p', 'meta', what + ': ' + (WORDS[o.state] || o.state)));
    }
    return card;
  }

  async function sendPrompt() {
    const input = $('agentText');
    const go = $('agentGo');
    const text = input.value.trim();
    if (!open || !text) return;
    if (!promptOk(text)) return answerOn(go, 'Start with a word');
    const r = await control.prompt(open.peer, open.id, text);
    if (r.state === 'asked') input.value = '';
    $('agentNote').textContent = WORDS[r.state] || r.state;
  }

  // Stop asks twice: the first press arms it, the second within five seconds sends it.
  async function pressStop() {
    if (!open) return;
    if (stopArmed !== open.id) {
      stopArmed = open.id;
      $('agentNote').textContent = 'Press Stop again to end this agent.';
      paintAgent();
      setTimeout(() => {
        if (stopArmed) {
          stopArmed = '';
          $('agentNote').textContent = '';
          paint();
        }
      }, 5000);
      return;
    }
    stopArmed = '';
    const r = await control.act(open.peer, open.id, 'stop');
    $('agentNote').textContent = 'Stop: ' + (WORDS[r.state] || r.state);
    paintAgent();
  }

  // ---- Start an agent ----
  function paintStart() {
    const all = views();
    const able = all.filter(
      x => x.v.state !== 'offline' && x.v.control && x.v.project && x.v.control.clis.length
    );
    if (!able.some(x => x.id === startPick.peer))
      startPick = { peer: able[0] ? able[0].id : '', cli: '' };
    const box = $('startPcs');
    box.textContent = '';
    for (const { id, v } of all) {
      const b = el('button', 'row' + (id === startPick.peer ? ' on' : ''));
      const ok = able.some(x => x.id === id);
      b.disabled = !ok;
      const text = el('div', 'grow');
      const why =
        v.state === 'offline'
          ? 'Offline'
          : !v.control
            ? 'Does not let this phone start agents'
            : !v.project
              ? 'No project open there'
              : !v.control.clis.length
                ? 'No agent CLI ready there'
                : 'Online';
      text.append(el('b', '', label(id)), el('span', 'meta', why));
      b.append(text);
      b.onclick = () => {
        startPick = { peer: id, cli: '' };
        paintStart();
      };
      box.append(b);
    }
    if (!all.length) box.append(el('p', 'note', 'No computer is connected.'));
    const v = startPick.peer ? control.view(startPick.peer) : null;
    const clis = v && v.control ? v.control.clis : [];
    if (!clis.includes(startPick.cli)) startPick.cli = clis[0] || '';
    const chips = $('startClis');
    chips.textContent = '';
    for (const w of clis) {
      const c = el('button', 'chip' + (w === startPick.cli ? ' on' : ''), CLI_NAMES[w] || w);
      c.onclick = () => {
        startPick.cli = w;
        paintStart();
      };
      chips.append(c);
    }
    const name = startPick.peer ? label(startPick.peer) : 'a computer';
    $('startWhere').textContent =
      'It starts on ' +
      name +
      ' in the project open there, and ' +
      name +
      ' shows that this phone started it.';
    $('startGo').textContent = 'Start on ' + name;
    $('startGo').disabled = !startPick.peer || !startPick.cli;
  }

  async function pressStart() {
    const text = $('startText').value.trim();
    if (text && !promptOk(text)) return answerOn($('startGo'), 'Start the task with a word');
    const r = await control.start(startPick.peer, startPick.cli, text);
    answerOn($('startGo'), r.state);
    if (r.state === 'asked') $('startText').value = '';
  }

  // ---- Activity ----
  function paintActivity() {
    const box = $('activityList');
    box.textContent = '';
    const all = views().flatMap(({ id, v }) => v.reports.map(r => ({ peer: id, r })));
    all.sort((x, y) => y.r.got - x.r.got);
    if (!all.length) {
      box.append(
        el(
          'p',
          'note',
          'Finished work shows here as short reports, when a computer shares it with this phone.'
        )
      );
      return;
    }
    for (const { peer, r } of all) {
      const card = el('article', 'surf');
      const who = el('div', 'who');
      const text = el('div');
      text.append(
        el('b', '', r.name),
        el('span', 'meta', [r.cli, label(peer), ago(r.at) + ' ago'].join(' · '))
      );
      who.append(tile(r.name), text);
      card.append(who);
      if (r.task) card.append(el('p', 'meta', r.task));
      if (r.did) card.append(el('p', '', r.did));
      if (r.text) card.append(el('p', 'out', r.text));
      const more = el('button', 'btn small', 'Open agent');
      more.onclick = () => openAgent(peer, r.id);
      card.append(more);
      box.append(card);
    }
  }

  // ---- wiring the fixed parts once ----
  for (const back of [$('agentBack'), $('startBack')]) back.append(icon('arrow-left'));
  $('agentBack').onclick = () => show('agents');
  $('agentStop').append(icon('square-stop'));
  $('agentStop').onclick = pressStop;
  $('agentGo').append(icon('arrow-up-right'));
  $('agentGo').onclick = sendPrompt;

  // the app out of view: the view stops, its last picture stays with its time
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) watch.close('hidden');
  });
  $('agentBody').addEventListener('focusout', () =>
    setTimeout(() => screen === 'agent' && paint(), 0)
  );
  $('agentText').onkeydown = e => {
    if (e.key === 'Enter') sendPrompt();
  };
  $('agentsStart').append(icon('plus'));
  $('agentsStart').onclick = () => show('start');
  $('startBack').onclick = () => show('agents');
  $('startGo').onclick = pressStart;

  return {
    onMessage(peer, obj) {
      if (obj && (obj.t === 'log' || obj.t === 'logask')) return talk.receive(peer, obj);
      if (obj && (obj.t === 'frame' || obj.t === 'viewing' || obj.t === 'unview'))
        return watch.receive(peer, obj);
      control.onMessage(peer, obj);

      // that computer no longer says this phone may watch: a running view ends
      if (obj && obj.t === 'control') {
        const v = control.view(peer);
        if (!v || !v.control || !v.control.watch) watch.rightEnded(peer);
      }
    },
    sessionStarted: peer => control.sessionStarted(peer),
    sessionEnded(peer) {
      control.sessionEnded(peer);
      talk.drop(peer);
      watch.sessionEnded(peer);
    },
    forget(peer) {
      control.forget(peer);
      talk.drop(peer);
      watch.drop(peer);
    },

    // The page shows a screen: paint it now.
    shown(name) {
      // a view ends when its agent's screen is left; nothing keeps running unseen
      if (name !== 'agent') watch.close('closed');
      screen = name;
      if (name !== 'agent') $('agentNote').textContent = '';
      paint();
    },

    // How many agents wait on the user, for the tab's badge.
    waiting: () =>
      views().reduce((n, x) => n + x.v.agents.filter(a => a.status === 'needs').length, 0),
  };
}
