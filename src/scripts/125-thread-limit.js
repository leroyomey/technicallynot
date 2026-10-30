// Technically Not · 125-thread-limit.js: "Usage limit reached" in the thread it stops. Desktop app
// only.
//
// When the agent of the open thread is paused by a usage limit, one card stands in the thread's
// own row between the conversation and the prompt box (.tnt-asks, where the permission, held
// prompt and trust cards stand): which account, when it continues, and what the user can do:
// Resume now on another signed-in account (only when one is free), Resume at reset, Resume, and
// Continue with another agent tool that is signed in (user decision 2026-10-05; built 2026-10-29).
//
// Continue with another agent: the old agent cannot write a hand-off letter (it is out of usage),
// so the hand-off is made here from its own record, with no model call: the task, the files it
// changed, its last words and its last report (the thread log, every readable tool). The chosen
// tool starts as a new thread with that text, the old one stays open and paused (it is not
// retired: tnai-agent-orchestration, "A hand-off is a conversation"), its planned resume is
// cancelled so the task is not done twice, and Handoff history (102) records it with the reason
// "usage limit".
//
// Nothing here detects a limit or resumes by itself: 15 (TnaiAccounts.limitFor, switchPane)
// detects and switches, 72 (TnaiLimitResume) plans and resumes. No timer and no observer: the
// card is repainted on their events and when another thread is chosen.
//
// Look: the card is a .tnt-ask (src/styles/29-thread-view.css), no rules of its own.
// `window.TnaiThreadLimit` (`state`, `handOffText`). Test: `thread-limit`.
(() => {
  'use strict';
  const native = window.tnaiNative;
  const accounts = window.TnaiAccounts;
  const resume = window.TnaiLimitResume;
  const agents = window.TnaiAgents;
  const threads = () => window.TnaiThreads;
  if (!native?.pty || !accounts?.limitFor || !resume?.resumeNow) return;

  const say = message => (typeof toast === 'function' ? toast(message) : console.info(message));

  // the plain shells are not agents a task can go to
  const SHELLS = new Set(['Terminal', 'powershell', 'pwsh', 'cmd', 'gitbash', 'wsl']);

  // the tools the app has paused are never offered (the same list as 10's PAUSED, which refuses
  // to start them)
  const PAUSED = new Set(['Gemini CLI', 'Antigravity', 'Droid']);
  const TASK_MAX = 1500;
  const WORDS_MAX = 1200;
  const REPORT_MAX = 1500;
  const FILES_MAX = 40;
  const REPORT_MARK = /^[ \t]*Technically Not report[ \t]*$/m;
  const CHANGED = /^(edit|wrote|write|creat|updat|delet|patch|chang|add|remov|renam|mov)/i;

  // A time today as "11:58 PM", another day with its date.
  function clock(ms) {
    const when = new Date(ms);
    const time = when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (when.toDateString() === new Date().toDateString()) return time;
    return time + ' ' + when.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  const clip = (text, max) => {
    const words = String(text || '').trim();
    return words.length > max ? words.slice(0, max - 1) + '…' : words;
  };

  let card = null;
  let busy = false;
  let choosing = false;

  // The paused thread's own session: { agent, name, ... }
  const sessionOf = paneId => agents?.sessions?.().find(each => each.paneId === paneId) || null;

  // The other agent tools that are installed and signed in, in the order the app lists them.
  function otherTools(paneId) {
    const current = sessionOf(paneId)?.agent || '';
    if (!agents?.info || !window.TnaiTeam?.startLead) return [];
    return agents
      .info()
      .filter(tool => tool?.id && !SHELLS.has(tool.id) && !PAUSED.has(tool.id))
      .filter(tool => tool.id !== current)
      .filter(tool => tool.installed === true && tool.loggedIn === true)
      .map(tool => tool.id);
  }

  // What the card says for the open thread, or null when its agent is not paused.
  function read() {
    const paneId = threads()?.selected?.() || '';
    const limit = paneId ? accounts.limitFor(paneId) : null;
    if (!limit) return null;
    const plan = resume.pending().find(entry => entry.paneId === paneId) || null;
    const planned = !!plan?.scheduled;
    const when = planned && plan.timed ? clock(plan.due) : '';
    let status = 'Paused until you choose.';
    if (planned)
      status = when
        ? 'Continues by itself at ' + when + '.'
        : 'Continues by itself once the limit resets (checked every 30 minutes).';
    return {
      paneId,
      account: limit.accountLabel || '',
      next: limit.suggest === null || limit.suggest === undefined ? null : limit.suggest,
      nextLabel: limit.suggestLabel || 'another account',
      tools: otherTools(paneId),
      planned,
      when,
      status,
    };
  }

  function makeCard() {
    card = document.createElement('div');
    card.className = 'tnt-ask tnt-limit';
    card.setAttribute('role', 'group');
    card.setAttribute('aria-label', 'Usage limit reached');
    card.innerHTML =
      '<div class="tnt-ask-text"><b>Usage limit reached</b><p></p></div>' +
      '<div class="tnt-ask-acts" data-limit-row="main">' +
      '<button type="button" class="tnt-ask-no" data-limit="now" title="Try to continue now. If the limit is still on, this card comes back.">Resume</button>' +
      '<button type="button" class="tnt-ask-no" data-limit="reset"></button>' +
      '<button type="button" class="tnt-ask-no" data-limit="other"></button>' +
      '<button type="button" class="tnt-ask-yes" data-limit="switch"></button>' +
      '</div>' +
      '<div class="tnt-ask-acts" data-limit-row="tools" hidden></div>';
    card.addEventListener('click', event => {
      const button = event.target.closest('[data-limit]');
      if (button) act(button.dataset.limit, button.dataset.tool || '');
    });
  }

  // The row of tools to continue with (several signed in): one button each, and Back.
  function paintTools(row, tools) {
    const names = [...row.querySelectorAll('[data-tool]')].map(button => button.dataset.tool);
    if (names.join('\n') === tools.join('\n') && row.children.length) return;
    row.replaceChildren();
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'tnt-ask-no';
    back.dataset.limit = 'back';
    back.textContent = 'Back';
    row.append(back);
    for (const tool of tools) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tnt-ask-yes';
      button.dataset.limit = 'continue';
      button.dataset.tool = tool;
      button.textContent = tool;
      button.title = 'Start ' + tool + ' with this task and what was done so far';
      row.append(button);
    }
  }

  function paint() {
    const row = threads()?.slot?.('main')?.querySelector('.tnt-asks') || null;
    const state = row ? read() : null;
    if (!state) {
      choosing = false;
      card?.remove();
      return;
    }
    if (!card) makeCard();
    const reset = card.querySelector('[data-limit="reset"]');
    const other = card.querySelector('[data-limit="switch"]');
    const handTo = card.querySelector('[data-limit="other"]');
    const mainRow = card.querySelector('[data-limit-row="main"]');
    const toolRow = card.querySelector('[data-limit-row="tools"]');
    card.querySelector('p').textContent =
      (state.account ? state.account + ' · ' : '') + state.status;
    reset.textContent = 'Resume at reset' + (state.when ? ' · ' + state.when : '');
    reset.setAttribute('aria-pressed', String(state.planned));
    reset.title = state.planned
      ? 'On: this agent continues by itself a minute after the limit resets'
      : 'Continue by itself a minute after the limit resets';
    other.hidden = state.next === null;
    other.textContent = 'Resume now on ' + state.nextLabel;
    other.title =
      'Restart this agent on an account that still has usage and continue its conversation';

    // Continue with another agent tool: named when there is one, a choice when there are more
    const one = state.tools.length === 1;
    handTo.hidden = !state.tools.length;
    handTo.dataset.tool = one ? state.tools[0] : '';
    handTo.textContent = one ? 'Continue with ' + state.tools[0] : 'Continue with another agent';
    handTo.title = one
      ? 'Start ' + state.tools[0] + ' with this task and what was done so far'
      : 'Choose another signed-in agent tool to continue this task';
    if (!state.tools.length) choosing = false;
    paintTools(toolRow, state.tools);
    mainRow.hidden = choosing;
    toolRow.hidden = !choosing;
    card.querySelectorAll('button').forEach(button => {
      button.disabled = busy;
    });
    if (card.parentElement !== row) row.prepend(card);
  }

  async function act(kind, tool) {
    const state = read();
    if (!state || busy) return;
    if (kind === 'reset') {
      say(
        resume.schedule(state.paneId)
          ? 'It continues once the usage limit resets'
          : 'Nothing to resume.'
      );
    } else if (kind === 'now') {
      resume.resumeNow(state.paneId);
    } else if (kind === 'switch' && state.next !== null) {
      busy = true;
      paint();
      try {
        await accounts.switchPane(state.paneId, state.next);
      } finally {
        busy = false;
      }
    } else if (kind === 'other' && !tool) {
      choosing = true;
    } else if (kind === 'back') {
      choosing = false;
    } else if ((kind === 'other' || kind === 'continue') && tool) {
      busy = true;
      paint();
      try {
        await continueWith(state.paneId, tool);
      } finally {
        busy = false;
        choosing = false;
      }
    }
    paint();
  }

  // ---------- the hand-off text, from the thread's own record ----------

  // Entries of the conversation's last part: the tool's record, read by the main process
  async function entriesOf(paneId) {
    try {
      const part = await native.threadLog?.read?.(paneId, -1, '');
      return Array.isArray(part?.entries) ? part.entries : [];
    } catch {
      return [];
    }
  }

  // The parts of a hand-off, from the entries: the task (the last prompt), the files changed and
  // commands run since it, its last words, and the last report written before or during it.
  function partsOf(entries) {
    let start = -1;
    for (let at = entries.length - 1; at >= 0; at--)
      if (entries[at]?.kind === 'you' && String(entries[at].text || '').trim()) {
        start = at;
        break;
      }
    const task = start >= 0 ? String(entries[start].text) : '';
    const since = entries.slice(start + 1);
    const files = [];
    let commands = 0;
    let lastCommand = '';
    for (const entry of since) {
      if (entry?.kind !== 'act') continue;
      const verb = String(entry.verb || '');
      const what = String(entry.what || '').trim();
      if (/^ran\b|^run\b/i.test(verb)) {
        commands++;
        lastCommand = what;
      } else if (CHANGED.test(verb) && what && !files.includes(what)) files.push(what);
    }
    const says = since.filter(entry => entry?.kind === 'say' && String(entry.text || '').trim());
    const lastWords = says.length ? String(says[says.length - 1].text) : '';
    let report = '';
    for (let at = entries.length - 1; at >= 0 && !report; at--) {
      const text = entries[at]?.kind === 'say' ? String(entries[at].text || '') : '';
      const mark = REPORT_MARK.exec(text);
      if (mark) report = text.slice(mark.index).trim();
    }
    return { task, files, commands, lastCommand, lastWords, report };
  }

  // The prompt the new agent gets. The bracket line is the app's own note (hidden in the thread,
  // `splitPrompt`); the rest is the hand-off the user sees as the new thread's first prompt.
  function handOffText(from, parts) {
    const who = from.name + ' (' + from.agent + ')';
    const lines = [
      '[TN.ai handoff: you continue the task of ' +
        who +
        ', which stopped at its usage limit in the middle of it; the user moved the task to you. ' +
        'Continue it from where it stopped and do not redo finished work: check the files it changed before you change them. ' +
        'Its terminal history: `tnai read ' +
        from.name +
        '`.]',
      'Continue this task from where ' + who + ' stopped at its usage limit.',
      '',
      'Task: ' +
        (parts.task ? clip(parts.task, TASK_MAX) : '(not in its record; see its terminal history)'),
    ];
    const done = [];
    if (parts.files.length)
      done.push(
        '- Files it changed: ' +
          parts.files.slice(0, FILES_MAX).join(', ') +
          (parts.files.length > FILES_MAX
            ? ' and ' + (parts.files.length - FILES_MAX) + ' more'
            : '')
      );
    if (parts.commands)
      done.push(
        '- Commands it ran: ' +
          parts.commands +
          (parts.lastCommand ? ', the last: ' + clip(parts.lastCommand, 200) : '')
      );
    if (parts.lastWords) done.push('- Its last words:\n\n' + clip(parts.lastWords, WORDS_MAX));
    lines.push('', 'Done so far:', ...(done.length ? done : ['- Nothing recorded yet.']));
    if (parts.report) lines.push('', 'Its last report:', '', clip(parts.report, REPORT_MAX));
    return lines.join('\n');
  }

  // Each step is also pushed as `tnai:handoff` for the Handoff history (102), as 54 does.
  const tell = (phase, detail) => {
    try {
      window.dispatchEvent(new CustomEvent('tnai:handoff', { detail: { phase, ...detail } }));
    } catch {}
  };

  async function continueWith(paneId, tool) {
    const from = sessionOf(paneId);
    if (!from) {
      say('This thread is no longer running.');
      return false;
    }
    const parts = partsOf(await entriesOf(paneId));
    const text = handOffText({ name: from.name || 'the agent', agent: from.agent || '' }, parts);
    tell('start', {
      paneId,
      name: from.name || '',
      agent: tool,
      accountId: '',
      sessionStartedAt: from.startedAt || 0,
      tokens: 0,
      task: parts.task,
      entry: { edited: parts.files },
      reason: { kind: 'limit' },
    });
    say('Starting ' + tool + ' to continue the task of ' + (from.name || 'this thread') + '…');
    let next = null;
    try {
      next = await window.TnaiTeam.startLead({ agent: tool });
    } catch (error) {
      next = { error: String(error?.message || error || '') };
    }
    if (!next?.paneId) {
      const why = next?.error || tool + ' could not start.';
      tell('failed', { paneId, error: why });
      say('Could not continue with ' + tool + ': ' + why);
      return false;
    }
    tell('started', { paneId, to: { paneId: next.paneId, name: next.name || '' } });
    if (!agents.send(next.paneId, text)) {
      tell('failed', { paneId, error: 'The task could not be sent to ' + tool + '.' });
      say('Could not send the task to ' + tool + '. Its thread is open; paste the task there.');
      return false;
    }

    // the old agent does not pick the task up again at reset; it stays open, so the new one can
    // read its terminal history
    resume.cancel?.(paneId);
    tell('done', { paneId, to: { paneId: next.paneId, name: next.name || '' } });
    const message =
      (next.name || tool) + ' (' + tool + ') continues the task of ' + (from.name || 'this thread');
    window.TnaiLiveTasks?.record?.(next.paneId, message, (next.name || tool) + ' (' + tool + ')');
    threads()?.show?.(next.paneId);
    say(message);
    return true;
  }

  [
    'tnai:account-limit',
    'tnai:account-limit-cleared',
    'tnai:accounts-changed',
    'tnai:limit-plan',
    'tnai:threads-select',
    'tnai:threads-shown',
    'tnai:thread-view',
  ].forEach(name => window.addEventListener(name, paint));

  window.TnaiThreadLimit = {
    // What the card shows right now, for the tests: null when no card stands.
    state: () => (card?.isConnected ? read() : null),

    // The hand-off a new agent gets, from a conversation's entries (for the tests)
    handOffText: (from, entries) => handOffText(from, partsOf(entries || [])),
  };
})();
