/*
 * Technically Not · 121-thread-asks.js — the thread layout's questions.
 * Desktop app only; does
 * nothing while the thread layout is off or its page is hidden, unless another page asked for a
 * thread's questions (`mount`, below).
 *
 * The app asks the user three things about an agent, each in a card of its own: a tool permission
 * (45), a prompt that was held or not sent (71), and "Trust this folder?" before a new agent
 * starts (74). On the other pages the first two float over the page's lower right corner, and the
 * third is drawn inside the agent's panel or card. On the Threads page nothing may lie over the
 * thread, and there is no panel or card to draw into, so:
 *
 * - the permission card and the held-prompt card, the app's own nodes with their own buttons, are
 *   moved into a row of the thread island, between the terminal and the prompt box, while the
 *   page shows, and moved back to where they were when it hides;
 * - the folder-trust question is shown in the same row for the open thread, with the app's own
 *   words and buttons, and answered through the same call (`tnaiNative.trust.answer`), so
 *   answering here answers it everywhere.
 *
 * The row is part of the thread view (120 builds it and counts its height like the prompt box's,
 * so a card that appears makes the terminal wait and then resize once). Look: the end of
 * src/styles/29-thread-view.css. Test: `real-thread` (a real permission question).
 *
 * Several threads at once (the All threads page, 135): `window.TnaiThreadAsks.mount(host, paneId)`
 * keeps that one thread's questions in `host` (its tool permissions, each a card of its own, and
 * its folder-trust question) until `unmount(host)`. They are answered through the same calls as
 * the app's own cards, so an answer here is an answer everywhere. The app's one floating
 * permission card (45) is not displayed while the question it shows stands in a mounted host.
 * The app's held-prompt notice (71: a prompt of the user's held back until the agent's question is
 * answered, or one the CLI did not start) follows the same rule: while its thread has a mounted
 * host the notice, 71's own node with its own buttons, stands in that host; otherwise it floats as
 * on every other page. 71 does not say which thread its notice is about, so the thread is found
 * by the agent's name the notice shows (one running agent with that name, or it stays floating).
 * Look: the end of src/styles/38-all-threads.css. Test: `all-threads-asks`.
 */
(() => {
  'use strict';
  const trust = window.tnaiNative?.trust;
  const permissions = window.tnaiNative?.permissions;
  const threads = () => window.TnaiThreads;
  const row = () => threads()?.slot('main')?.querySelector('.tnt-asks') || null;

  // ---------- the app's own cards: moved in, and moved back ----------
  const CARDS = '.tnai-perm';

  function dockCards() {
    const dock = row();
    if (!dock) return;
    document.querySelectorAll('body > ' + CARDS).forEach(card => dock.append(card));
  }

  function returnCards() {
    document.querySelectorAll('.tnt-asks > ' + CARDS).forEach(card => document.body.append(card));
  }

  // ---------- the folder-trust question, for the open thread ----------
  // id -> { id, paneId, title, body, ok, cancel }, as the main process sends them (74 keeps its own
  // copy for the other pages)
  const asks = new Map();

  function trustCard(ask) {
    const card = document.createElement('section');
    card.className = 'tnt-ask';
    card.dataset.trustAsk = ask.id;
    card.setAttribute('role', 'alertdialog');
    card.innerHTML =
      '<div class="tnt-ask-text"><b></b><p></p></div><div class="tnt-ask-acts">' +
      '<button type="button" class="tnt-ask-no"></button>' +
      '<button type="button" class="tnt-ask-yes"></button></div>';
    card.querySelector('b').textContent = ask.title || 'Trust this folder?';
    card.querySelector('p').textContent = ask.body || '';
    card.querySelector('p').hidden = !ask.body;
    card.querySelector('.tnt-ask-no').textContent = ask.cancel || "Don't allow";
    card.querySelector('.tnt-ask-yes').textContent = ask.ok || 'Trust folder';
    card.querySelector('.tnt-ask-no').addEventListener('click', () => answer(ask.id, false));
    card.querySelector('.tnt-ask-yes').addEventListener('click', () => answer(ask.id, true));
    return card;
  }

  // Only the open thread's question is shown: the row belongs to that thread.
  function paintTrust() {
    const dock = row();
    if (!dock) return;
    const open = threads().selected() || '';
    dock.querySelectorAll(':scope > .tnt-ask').forEach(card => {
      const ask = asks.get(card.dataset.trustAsk);
      if (!ask || ask.paneId !== open) card.remove();
    });
    for (const ask of asks.values()) {
      const shown = dock.querySelector(
        ':scope > .tnt-ask[data-trust-ask="' + CSS.escape(ask.id) + '"]'
      );
      if (ask.paneId === open && !shown) dock.prepend(trustCard(ask));
    }
  }

  function answer(id, yes) {
    if (!asks.delete(id)) return;
    paintTrust();
    paintHosts();
    trust.answer(id, yes).catch(() => {});
  }

  // The main process tells every listener when a question is asked or answered, whatever page
  // answered it. The two listeners exist only while the thread layout is on; while its page is
  // hidden they keep the list and draw only into the hosts another page mounted.
  let stops = [];

  function listen() {
    if (!trust || stops.length) return;
    stops = [
      trust.onAsk(ask => {
        if (!ask?.id || !ask.paneId) return;
        asks.set(ask.id, ask);
        if (threads()?.visible()) paintTrust();
        paintHosts();
      }),
      trust.onDone(({ id } = {}) => {
        if (!asks.delete(id)) return;
        if (threads()?.visible()) paintTrust();
        paintHosts();
      }),
    ];
  }

  function unlisten() {
    if (hosts.size) return;
    stops.forEach(stop => typeof stop === 'function' && stop());
    stops = [];
    asks.clear();
    paintHosts();
  }

  // a window that was reloaded asks for the questions still open
  function readPendingTrust() {
    if (!trust) return;
    trust
      .pending()
      .then(list => {
        (list || []).forEach(ask => ask?.id && ask.paneId && asks.set(ask.id, ask));
        if (threads()?.visible()) paintTrust();
        paintHosts();
      })
      .catch(() => {});
  }

  // ---------- several threads at once: a thread's questions in a host of its own ----------
  // host element -> the thread (panel id) whose questions it holds
  const hosts = new Map();

  // id -> the open tool permission, as the main process sends it (45 keeps its own list for the
  // floating card)
  const prompts = new Map();

  // The permissions answered from a host and not yet confirmed by the main process: 45 still has
  // them in its list for a moment, and its floating card must not flash up for them.
  const leaving = new Set();
  let stopPrompts = null;

  function permissionCard(prompt) {
    const card = document.createElement('section');
    card.className = 'tnt-ask tnt-ask-perm';
    card.dataset.permAsk = prompt.id;
    card.setAttribute('role', 'alertdialog');
    card.innerHTML =
      '<div class="tnt-ask-text"><b></b><p></p><pre class="tnt-ask-detail"></pre></div>' +
      '<div class="tnt-ask-acts">' +
      '<button type="button" class="tnt-ask-yes" data-d="once">Allow once</button>' +
      '<button type="button" data-d="session"></button>' +
      '<button type="button" class="tnt-ask-no" data-d="deny">Deny</button>' +
      '<button type="button" data-d="terminal">Answer on the CLI screen</button></div>';
    card.querySelector('b').textContent = 'Asks to use ' + (prompt.tool || 'a tool');
    const description = card.querySelector('p');
    description.textContent = prompt.description || '';
    description.hidden = !prompt.description;
    const detail = card.querySelector('pre');
    detail.textContent = prompt.detail || '';
    detail.hidden = !prompt.detail;

    // What "for session" covers, in 45's own words (agent-hooks.js sessionScope): the same
    // command, the whole tool, or nothing.
    const session = card.querySelector('[data-d="session"]');
    const scope = prompt.sessionScope;
    session.hidden = scope == null;
    session.textContent = scope ? 'Allow “' + scope + '” for session' : 'Allow for session';
    session.title =
      'Also allow ' +
      (scope || prompt.tool || 'this tool') +
      ' without asking until this session ends';
    card.querySelector('[data-d="terminal"]').title =
      "Close this and answer on the agent's own screen";
    card.addEventListener('click', event => {
      const button = event.target.closest('button[data-d]');
      if (button) answerPermission(prompt.id, button.dataset.d);
    });
    return card;
  }

  // The main process confirms with a done event, which 45 hears too; an answer for a question
  // that already ended is ignored there.
  function answerPermission(id, decision) {
    if (!prompts.delete(id)) return;
    leaving.add(id);
    paintHosts();
    Promise.resolve(permissions.answer(id, decision)).catch(() => {});
  }

  // The cards a thread's host must hold: its permissions and its trust question. A new one is put
  // under the ones already there (paintHost), so they stand in the order they were asked.
  function wantedCards(paneId) {
    const wanted = [];
    for (const prompt of prompts.values())
      if (prompt.paneId === paneId)
        wanted.push({ key: 'perm ' + prompt.id, make: () => permissionCard(prompt) });
    for (const ask of asks.values())
      if (ask.paneId === paneId)
        wanted.push({ key: 'trust ' + ask.id, make: () => trustCard(ask) });
    return wanted;
  }

  // A card that stays is left alone (its buttons keep the keyboard); only what came or went moves.
  function paintHost(host, paneId) {
    const wanted = wantedCards(paneId);
    const keys = new Set(wanted.map(item => item.key));
    [...host.children].forEach(card => {
      if (card !== heldNode() && !keys.has(card.dataset.askKey)) card.remove();
    });
    wanted.forEach(item => {
      const shown = [...host.children].some(card => card.dataset.askKey === item.key);
      if (shown) return;
      const card = item.make();
      card.dataset.askKey = item.key;
      host.append(card);
    });
    showOrHide(host);
  }

  // A host with nothing to show takes no room (the held notice inside it may be hidden by 71).
  function showOrHide(host) {
    const empty = ![...host.children].some(card => !card.hidden);
    if (host.hidden !== empty) host.hidden = empty;
  }

  // ---------- the held-prompt notice (71), in its thread's host ----------
  const heldNode = () => document.querySelector('.tnai-perm.tnai-held');

  // The thread the notice is about: the one running agent with the name the notice shows.
  function heldPane(node) {
    const name = node.querySelector('.tnai-perm-head b')?.textContent.trim() || '';
    if (!name) return '';
    const named = (window.TnaiAgents?.sessions?.() || []).filter(session => session.name === name);
    return named.length === 1 ? named[0].paneId : '';
  }

  // Back to where 71 keeps it: over the page, or in the open thread's row while that page shows.
  function floatHeld(node) {
    const home = threads()?.visible() ? row() || document.body : document.body;
    const was = node.parentElement;
    if (was !== home) home.append(node);
    if (was && hosts.has(was)) showOrHide(was);
  }

  function paintHeld() {
    const node = heldNode();
    if (!node) return;
    const inHost = hosts.has(node.parentElement);
    const paneId = node.hidden || threads()?.visible() ? '' : heldPane(node);
    const host = paneId ? [...hosts.keys()].find(key => hosts.get(key) === paneId) : null;
    if (!host) {
      if (inHost) floatHeld(node);
      return;
    }
    const was = node.parentElement;
    if (was !== host) {
      // the notice is the thread's last word: under its questions
      host.append(node);
      if (was && hosts.has(was)) showOrHide(was);
    }
    showOrHide(host);
  }

  // 71 paints its notice whenever something changes; this follows the node, not 71's state.
  let heldWatch = null;

  function watchHeld() {
    const node = heldNode();
    if (heldWatch || !node) return;
    heldWatch = new MutationObserver(paintHeld);
    heldWatch.observe(node, { attributes: true, attributeFilter: ['hidden'] });
    heldWatch.observe(node.querySelector('.tnai-perm-head b') || node, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  }

  // The app's floating permission card shows one question at a time. While that question stands in
  // a thread's own host it would be the same question twice, one of them lying over the page.
  function paintFloat() {
    const float = document.querySelector('.tnai-perm:not(.tnai-held)');
    if (!float) return;
    const id = float.dataset.promptId || '';
    const paneId = prompts.get(id)?.paneId || '';
    const inHost =
      !threads()?.visible() &&
      !!id &&
      (leaving.has(id) || (!!paneId && [...hosts.values()].includes(paneId)));
    if (float.classList.contains('tnt-ask-in-thread') !== inHost)
      float.classList.toggle('tnt-ask-in-thread', inHost);
  }

  function paintHosts() {
    for (const [host, paneId] of hosts) paintHost(host, paneId);
    paintFloat();
    paintHeld();
  }

  // Once a page has asked for a thread's questions the list is kept for the rest of the run: the
  // hosts come and go with every step of that page, and a list read again each time would show
  // a question a moment late.
  function listenPrompts() {
    if (!permissions || stopPrompts) return;
    stopPrompts = permissions.on(event => {
      if (!event?.id) return;
      if (event.done) {
        prompts.delete(event.id);
        leaving.delete(event.id);
      } else if (event.paneId && !leaving.has(event.id)) prompts.set(event.id, event);
      paintHosts();
    });
    permissions
      .pending()
      .then(list => {
        (list || []).forEach(
          prompt => prompt?.id && prompt.paneId && prompts.set(prompt.id, prompt)
        );
        paintHosts();
      })
      .catch(() => {});
  }

  function mount(host, paneId) {
    if (!host || !paneId) return false;
    const first = !hosts.size;
    hosts.set(host, paneId);
    if (first) {
      listenPrompts();
      if (!stops.length) {
        listen();
        readPendingTrust();
      }
    }
    watchHeld();
    paintHost(host, paneId);
    paintFloat();
    paintHeld();
    return true;
  }

  function unmount(host) {
    if (!hosts.has(host)) return false;

    // 71's notice is the app's own node: it goes back, it is never thrown away with the cards
    const held = heldNode();
    if (held && held.parentElement === host) floatHeld(held);
    hosts.delete(host);
    host.replaceChildren();
    host.hidden = true;
    paintFloat();
    paintHeld();
    return true;
  }

  window.TnaiThreadAsks = {
    mount,
    unmount,

    // how many questions of that thread a mounted host shows now
    count: paneId => (hosts.size ? wantedCards(paneId).length : 0),
  };

  // ---------- only while the Threads page shows ----------
  function shown() {
    dockCards();
    listen();
    readPendingTrust();
    paintFloat();
    paintHeld();
  }
  window.addEventListener('tnai:threads-shown', shown);
  window.addEventListener('tnai:threads-select', () => {
    if (threads()?.visible()) paintTrust();
  });
  window.addEventListener('tnai:threads-hidden', () => {
    returnCards();
    paintFloat();
    paintHeld();
  });
  window.addEventListener('tnai:threads-removed', () => {
    returnCards();
    unlisten();
  });
  if (threads()?.visible()) shown();
})();
