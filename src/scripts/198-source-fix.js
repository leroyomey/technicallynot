/*
 * Technically Not · 198-source-fix.js — the window's half of "Fix a Technically Not bug from its
 * source…", a row of the thread's "..." menu (137 asks `can` and calls `start`).
 *
 * One press: the main process (desktop/source-fix.js) copies Technically Not's public source at
 * the installed version's tag into the settings folder, never the user's project, and starts a new
 * thread there on the same agent tool as the thread it was pressed in. That thread gets the bug
 * playbook and this thread's details (name, tool, model, state, the error it shows). Its agent
 * asks what went wrong when it is not clear, finds and fixes the cause, and drafts an issue or
 * pull request; the user presses the final button on GitHub's own page.
 *
 * Why the thread's "..." menu: a Technically Not bug shows in a thread (a reply drawn twice, a
 * stall, a start that failed), and the row there hands that thread's details over by itself.
 *
 * window.TnaiSourceFix = { can, start }.
 */
(() => {
  'use strict';
  if (!window.tnaiNative?.sourceFix) return;

  const sessionOf = paneId =>
    (window.TnaiAgents?.sessions?.() || []).find(session => session.paneId === paneId) || null;

  // One copy and one thread at a time.
  let busy = false;

  // An agent thread: the new thread runs on the same tool.
  function can(paneId) {
    const session = sessionOf(paneId);
    return !!session && session.agent !== 'Terminal';
  }

  // What the new thread is told about the thread the row was pressed in.
  function detailsOf(session) {
    const pick = window.TnaiLaunchPrefs?.pane?.(session.paneId, session.agent) || {};
    return {
      thread: session.name || '',
      agent: session.agent || '',
      model: pick.model || '',
      state: session.status || (session.running ? 'running' : 'stopped'),
      error: session.error || session.exitText || '',
    };
  }

  async function start(paneId) {
    const session = sessionOf(paneId);
    if (!session || !can(paneId)) return;
    if (busy) {
      window.toast?.('The source is already being fetched.');
      return;
    }
    busy = true;
    window.toast?.('Getting Technically Not’s public source for a bug fix thread…');
    let answer = null;
    try {
      answer = await window.tnaiNative.sourceFix.start({
        agent: session.agent,
        details: detailsOf(session),
      });
    } catch (error) {
      answer = { ok: false, error: error?.message || String(error) };
    } finally {
      busy = false;
    }
    if (!answer?.ok) {
      window.toast?.(answer?.error || 'Could not start the bug fix thread.');
      if (answer?.paneId) window.TnaiThreads?.show?.(answer.paneId);
      return;
    }
    window.TnaiThreads?.show?.(answer.paneId);
    window.toast?.(
      answer.fromTag
        ? 'Bug fix thread opened on this version’s source. Nothing is posted until you press it on GitHub.'
        : 'Bug fix thread opened on the latest public source (this version’s tag was not found).'
    );
  }

  window.TnaiSourceFix = { can, start };
})();
