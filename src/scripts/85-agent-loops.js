/*
 * Technically Not · 85-agent-loops.js — Desktop only: a bell notice (51's TnaiNextActions.notify,
 * same item look as 60's) when main's stuck-loop check (desktop/agent-loops.js, push `agent:loop`)
 * sees a Claude Code agent or its sub-agent repeat the same call with the same result for minutes.
 * One notice per loop; it leaves the bell when the agent moves on, its turn ends (Stop, or
 * agent-turns' interrupted/exit end) or a new task comes. "Go to it" opens that agent's terminal as
 * 71's jump does. Never stops, interrupts or types into the agent. `window.TnaiAgentLoops`
 * (`open`); test `agent-loops`, logic `tools/desktop-check/loop-check.js`.
 */
(() => {
  const native = window.tnaiNative,
    bell = window.TnaiNextActions;
  if (!native?.agentLoops || !bell?.notify) return;
  const open = new Map(); // loop id -> { paneId, since }

  const nameOf = paneId =>
    window.TnaiAgents?.sessions?.().find(s => s.paneId === paneId)?.name ||
    document
      .querySelector(
        '.terminal-pane[data-pane-id="' + CSS.escape(paneId) + '"] .terminal-pane-title'
      )
      ?.textContent.trim() ||
    'An agent';
  const mins = ms => {
    const m = Math.round(ms / 60000);
    return m < 1 ? 'under a minute' : m + ' min';
  };
  const toolWord = t =>
    /^mcp__claude-in-chrome__/.test(t)
      ? 'browser'
      : /^mcp__/.test(t)
        ? t.split('__')[1] || 'tool'
        : t;

  function words(l) {
    const what = l.browser
      ? l.period === 1
        ? 'the same browser step'
        : 'the same ' + l.period + ' browser steps'
      : l.period === 1
        ? 'the same ' + toolWord(l.tools?.[0] || 'tool') + ' call'
        : 'the same ' +
          l.period +
          ' steps (' +
          [...new Set((l.tools || []).map(toolWord))].join(', ') +
          ')';
    return (
      'It repeated ' +
      what +
      ' ' +
      l.repeats +
      ' times in ' +
      mins((l.at || Date.now()) - l.since) +
      ', with the same result each time' +
      (l.failed ? ' (failed)' : '') +
      '. Nothing was stopped: look at its thread, or tell it to try another way.'
    );
  }
  const goTo = paneId => {
    window.TnaiLiveTasks?.setTarget?.(paneId);
    if (window.TnaiLiveTasks?.focusPane) window.TnaiLiveTasks.focusPane(paneId);
    else if (!window.TnaiThreads?.show?.(paneId)) window.TnaiThreads?.open?.();
  };

  function onLoop(l) {
    if (!l?.id) return;
    if (!l.on) {
      open.delete(l.id);
      bell.unnotify('loop:' + l.id);
      return;
    }
    if (open.has(l.id)) return;
    open.set(l.id, { paneId: l.paneId, since: l.since });
    const who = nameOf(l.paneId) + (l.agentId ? '’s sub-agent' : '');

    // A sub-agent that outgrew a small job (main: kind 'overrun'): running long, or changing many
    // files. Exact counts from its own tool calls.
    if (l.kind === 'overrun') {
      const what = [
        l.long ? 'has worked for ' + mins((l.at || Date.now()) - l.since) : '',
        l.files
          ? (l.long ? 'changed ' : 'has changed ') + l.files + (l.files === 1 ? ' file' : ' files')
          : '',
      ]
        .filter(Boolean)
        .join(' and ');
      return bell.notify({
        key: 'loop:' + l.id,
        source: who,
        tag: l.long ? 'Running long' : 'Many files',
        k: 'blocked',
        title: who + (l.long ? ' is taking long' : ' is changing many files'),
        text:
          'It ' +
          what +
          ', more than a small job usually needs. Nothing was stopped: look at its thread, or tell its lead to keep it to the task.',
        action: { label: 'Go to it', run: () => goTo(l.paneId) },
      });
    }
    bell.notify({
      key: 'loop:' + l.id,
      source: who,
      tag: 'May be stuck',
      k: 'blocked',
      title: who + ' may be stuck in a loop',
      text: words(l),
      action: { label: 'Go to it', run: () => goTo(l.paneId) },
    });
  }

  // A turn that ended without a Stop hook (the user pressed Esc, or the CLI exited): its loops are
  // over too.
  native.agentTurns?.on?.(t => {
    if (!t?.paneId || !t.endedAt) return;
    for (const [id, o] of open)
      if (o.paneId === t.paneId && t.endedAt >= o.since) onLoop({ id, on: false });
  });
  native.agentLoops.on(onLoop);
  native.agentLoops
    .list()
    .then(list => (list || []).forEach(onLoop))
    .catch(() => {}); // loops already open when the window (re)loaded

  window.TnaiAgentLoops = { open: () => [...open.keys()] };
})();
