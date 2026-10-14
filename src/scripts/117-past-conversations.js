// Technically Not · past-conversations — Desktop only: the past conversations of the open project,
// as what is known about them and what can be done with one. This file draws nothing: the button,
// the list and the one conversation that is read are 138's (a popover of the thread view), which
// is told of every change by the event `tnai:past-threads-changed` and reads `state()`.
//
// Showing asks the main process once for the open project's saved conversations
// (desktop/thread-list.js: Claude Code's own files plus what this app recorded; never by a timer).
// Choosing one reads a short excerpt of it, then. Resume opens a new terminal panel that continues
// the conversation through the app's own resume path (04 TnaiNewTerminalPane + 10
// TnaiAgents.openIn with resumeId, as 47 does for a revived agent) and then opens that agent's
// thread. A conversation that is in a panel now says so, and choosing it opens that thread. A
// conversation of an agent that was started from another computer resumes at "Ask first"; the
// main process holds it to that.
//
// window.TnaiPastThreads (show, close, shown, pick, select, back, selected, state, panelOf,
// resume, paint). Nothing here needs the old Agents and history page: `paint` is that page's old
// hook and always answers that this part does not fill its main area. Test: thread-history.
(() => {
  const native = window.tnaiNative?.threads;
  const agents = window.TnaiAgents;

  // browser, or a build without the feature: there are no past conversations to show
  if (!native?.list || !agents?.openIn) return;
  const say = message =>
    typeof window.toast === 'function' ? window.toast(message) : console.info(message);

  // 138 draws from `state()` each time it hears this.
  const tell = () => window.dispatchEvent(new CustomEvent('tnai:past-threads-changed'));

  // ---- what is known: the last list the main process gave, nothing else ----
  // showing: the list is asked for and on screen. state: 'idle' (never read) | 'reading' | 'ready'
  // | 'failed'. excerpt: what was read of the selected conversation ('reading' until it came).
  let showing = false;
  let state = 'idle';
  let threads = [];
  let more = false;
  let selected = '';
  let excerpt = null;
  let busy = false;
  let asked = 0;
  const find = key => threads.find(thread => thread.key === key) || null;

  // The panel that holds this conversation now, running or stopped: it is that agent, not a past
  // conversation.
  const panelOf = thread =>
    agents
      .sessions()
      .find(
        session =>
          session.sessionId && session.sessionId === thread.id && session.agent === thread.cli
      )?.paneId || '';

  // Asked when the user shows the list; an answer that an ask made later has overtaken is dropped.
  function load() {
    const mine = ++asked;
    state = 'reading';
    tell();
    Promise.resolve(native.list())
      .then(result => {
        if (mine !== asked) return;
        const ok = !!result && result.ok !== false && Array.isArray(result.threads);
        threads = ok
          ? result.threads.filter(
              thread =>
                thread &&
                typeof thread.key === 'string' &&
                typeof thread.id === 'string' &&
                typeof thread.cli === 'string'
            )
          : [];
        more = ok && result.more === true;
        state = ok ? 'ready' : 'failed';
        if (selected && !find(selected)) {
          selected = '';
          excerpt = null;
        }
        tell();
      })
      .catch(() => {
        if (mine !== asked) return;
        threads = [];
        more = false;
        state = 'failed';
        selected = '';
        excerpt = null;
        tell();
      });
  }

  // The list is let go: nothing stays selected in a list that is not shown, and an answer still on
  // its way is dropped.
  function letGo() {
    asked++;
    showing = false;
    state = 'idle';
    selected = '';
    excerpt = null;
  }

  function show() {
    if (showing) return;
    showing = true;
    load();
  }

  function close() {
    if (!showing) return;
    letGo();
    tell();
  }

  // Another project was opened: its conversations are another list, read when the user shows the
  // list there.
  window.addEventListener('tnai:project-changed', () => {
    letGo();
    threads = [];
    more = false;
    tell();
  });

  // ---- the selection: one conversation, with a short excerpt read when it is chosen ----
  function select(key) {
    const next = key && showing && find(key) ? key : '';
    if (next === selected) return;
    selected = next;
    excerpt = null;
    if (selected) {
      const want = selected;
      excerpt = 'reading';
      Promise.resolve(native.peek(want))
        .then(read => {
          if (selected !== want) return;
          excerpt = read && typeof read === 'object' ? read : {};
          tell();
        })
        .catch(() => {
          if (selected !== want) return;
          excerpt = {};
          tell();
        });
    }
    tell();
  }

  // An agent's thread on the Threads page. A thread the list does not hold yet (its session was
  // made a moment ago) is chosen all the same, and shows as soon as the list has it.
  function openThread(paneId) {
    const frame = window.TnaiThreads;
    if (!frame || frame.show(paneId)) return;
    frame.select(paneId);
    frame.open();

    // another computer's agent that fills the thread's main area steps aside (138)
    window.TnaiThreadHistory?.closeRemote?.();
  }

  // A press on a row: its detail, or, when the conversation is in a panel now, that agent's thread
  // (the list is let go). → the panel id in that case, else ''.
  function pick(key) {
    const thread = showing ? find(key) : null;
    if (!thread) return '';
    const paneId = panelOf(thread);
    if (paneId) {
      close();
      openThread(paneId);
      return paneId;
    }
    select(key);
    return '';
  }

  // ---- Resume: a new terminal panel that continues the conversation, by the path a revived agent
  // takes (47 reopen), and then that agent's thread ----
  async function resume(key) {
    const thread = find(key || selected);
    if (!thread || busy) return;
    const paneId = panelOf(thread);
    if (paneId) {
      close();
      openThread(paneId);
      return;
    }
    if (typeof window.TnaiNewTerminalPane !== 'function') {
      say('Not resumed: no thread could be opened.');
      return;
    }
    busy = true;
    tell();
    try {
      const taken =
        !!thread.name &&
        agents
          .sessions()
          .some(session => (session.name || '').toLowerCase() === thread.name.toLowerCase());
      let name =
        thread.name && !taken
          ? thread.name
          : window.TnaiPaneNames?.pick?.() || thread.name || thread.cli;
      const record = window.TnaiNewTerminalPane({ name, quiet: true, reuseEmpty: true });
      if (!record) {
        say(window.TnaiPaneLimit?.message || 'This workspace has no room for another thread.');
        return;
      }
      name = record.name || name;

      // 05 gives the panel its connection select; 07 moves it into its workspace grid
      await new Promise(resolve => setTimeout(resolve, 0));

      // What this app recorded about the conversation goes along (its account, its custom agent,
      // whether the user started it); one it never ran starts as a plain panel on the account
      // chosen in Accounts.
      const opened = await agents.openIn(record.id, thread.cli, {
        name,
        resumeId: thread.id,
        accountId: thread.accountId || '',
        customAgentId: thread.customAgentId || '',
        ownedByUser: thread.known === true && thread.ownedByUser === true,
      });
      if (!opened?.ok) {
        say('Not resumed: ' + (opened?.error || thread.cli + ' could not start.'));
        return;
      }

      // it is an agent in a panel now: the list is let go and its thread is the open one
      close();
      openThread(record.id);
    } catch (error) {
      say('Not resumed: ' + (error?.message || error));
    } finally {
      busy = false;
      tell();
    }
  }

  window.TnaiPastThreads = {
    show,
    close,
    pick,
    resume,

    // '' lets the whole list go; a key shows that conversation's detail.
    select: key => (key ? select(key) : close()),

    // From one conversation back to the list, which stays shown.
    back: () => select(''),
    selected: () => selected,
    shown: () => showing,

    // What 138 draws: the list as it was read, the chosen conversation and its excerpt.
    state: () => ({
      shown: showing,
      state,
      threads: threads.slice(),
      more,
      selected,
      excerpt,
      busy,
    }),

    // The panel a conversation of the list is in now ('' when it is not running anywhere).
    panelOf: key => {
      const thread = find(key);
      return thread ? panelOf(thread) : '';
    },

    // The old Agents and history page asks this from its own render (25): this part never fills
    // that page's main area any more.
    paint: () => false,
  };
})();
