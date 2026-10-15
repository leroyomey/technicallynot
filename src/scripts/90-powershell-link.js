/*
 * Technically Not · 90-powershell-link.js — Desktop app on Windows only: the word "PowerShell" in
 * an agent's terminal output is a link. Agents tell the user to run
 * interactive commands (`npx wrangler secret put NAME`) that the `!` prefix can't prompt for; one
 * click opens a new PowerShell thread (TnaiAgents.open('Terminal'),
 * the same path the bell's Update uses, 60) in the project folder, focused. A command comes only
 * from an explicit click on one of two forms (hidden skill 50 tells agents to write them): a `PS>
 * <command>` line (a code block holding just the command, readable and copyable; the command is the
 * link), or a `tnai://powershell?cmd=<percent-encoded>` link (plain text, an OSC 8 hyperlink, or
 * hard-wrapped by the CLI onto indented rows). The click sends the command whole plus Enter to the
 * new panel as one submitted entry (TnaiAgents.send, nothing typed visibly);
 * the hover tip shows the exact command. A command goes to a PowerShell panel that is
 * already open and idle at its prompt instead of a new one (idleShell below);
 * a busy panel, or none, opens a new panel as before. Nothing runs without the click;
 * control characters are stripped. Any other tnai:// link is ignored; http(s) OSC 8 links keep
 * xterm's own confirm-then-open behavior. Not in PowerShell panels themselves. 10 calls
 * attach(term) for every xterm (createTerm); views set term.tnaiPaneId (10, 25, 33) so a PowerShell
 * session's own views get no links.
 */
(() => {
  const native = window.tnaiNative;
  if (!native?.pty || !window.tnaiPlatform?.win) {
    window.TnaiPowerShellLink = { attach() {} };
    return;
  }
  const TIP = 'Open a PowerShell thread';
  const tipFor = cmd => (cmd ? 'Open a PowerShell thread and run: ' + cmd : TIP);
  const PSLINE = /^([ 	]*PS>[ 	]+)(\S.*?)[ 	]*$/; // a code block holding just the command
  const WORD = /\bpowershell\b/gi;

  // encodeURIComponent's output alphabet, so the link ends where the encoded command ends.
  const LINK = /tnai:\/\/powershell\?cmd=([A-Za-z0-9%._~!*'()-]*)/gi;
  const ANSI =
    /\x1b\[[0-?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Za-z0-9]|\x1b[=>78]/g;

  // The command in a tnai://powershell link, or null when it isn't one. Control characters (CR, LF
  // …) are dropped: nothing can press Enter.
  function commandOf(uri) {
    const m = /^tnai:\/\/powershell\/?\?cmd=(.*)$/i.exec(String(uri || '').trim());
    if (!m) return null;
    let raw = m[1].replace(/[.!]+$/, ''); // sentence punctuation after a plain-text link
    while (raw.endsWith(')') && (raw.match(/\(/g) || []).length < (raw.match(/\)/g) || []).length)
      raw = raw.slice(0, -1);
    let cmd = '';
    try {
      cmd = decodeURIComponent(raw.replace(/\+/g, '%20'));
    } catch {
      return '';
    }
    return cmd
      .replace(/[\x00-\x1f\x7f]+/g, ' ')
      .trim()
      .slice(0, 4000);
  }

  // A PowerShell session's own views get no links.
  const inShell = term => {
    const id =
      term.tnaiPaneId || term.element?.closest?.('.terminal-pane[data-pane-id]')?.dataset.paneId;
    return !!id && window.TnaiAgents?.sessions?.().find(s => s.paneId === id)?.agent === 'Terminal';
  };

  // A command goes to a PowerShell panel that is already open and doing nothing, instead of a new
  // panel per click (two PS> commands opened two panels). Used only when
  // it is certain the command would run as in a fresh panel: a running PowerShell panel in the
  // workspace on screen, quiet for QUIET_MS, whose last line is its own first prompt again (a panel
  // this link opened; any prompt style) or the standard `PS <its start folder>>` prompt, so nothing
  // is typed after the prompt, no program is running in it and it has not moved to another folder;
  // and started in the folder the clicked panel works in, when that is known. Anything else opens a
  // new panel.
  const QUIET_MS = 1500,
    prompts = new Map(); // paneId -> the first prompt line of a panel opened here
  const norm = p =>
    String(p || '')
      .replace(/[\\/]+$/, '')
      .toLowerCase();
  const lastLine = text =>
    String(text || '')
      .replace(ANSI, '')
      .split(/\r?\n/)
      .map(l => l.replace(/\s+$/, ''))
      .filter(Boolean)
      .pop() || '';

  async function idleShell(from) {
    const agents = window.TnaiAgents,
      ws = window.TnaiActiveTerminalWorkspaceId || 'workspace-1',
      now = Date.now();
    const shells = agents
      .sessions()
      .filter(
        s =>
          s.agent === 'Terminal' &&
          s.running &&
          s.mode !== 'login' &&
          s.cwd &&
          (!from || norm(s.cwd) === norm(from)) &&
          now - (s.lastOutputAt || 0) > QUIET_MS
      )
      .sort((a, b) => (b.lastOutputAt || 0) - (a.lastOutputAt || 0));

    // All candidates are asked at once: one after another, every busy PowerShell panel put its own
    // round trip (about 100 ms, measured 2026-10-03) before the new panel. The most recently used
    // idle one still wins.
    const found = await Promise.all(
      shells.map(async s => {
        const pane = document.querySelector(
          '.terminal-pane[data-pane-id="' + CSS.escape(s.paneId) + '"]'
        );
        if (!pane || (pane.dataset.workspaceId || 'workspace-1') !== ws) return null;
        let last = '';
        try {
          last = lastLine(String((await native.pty.replay(s.paneId))?.buffer || '').slice(-4000));
        } catch {
          return null;
        }
        const std = /^PS (.+)>$/.exec(last);
        return (prompts.has(s.paneId) && last === prompts.get(s.paneId)) ||
          (std && norm(std[1]) === norm(s.cwd))
          ? { paneId: s.paneId, pane }
          : null;
      })
    );
    return found.find(Boolean) || null;
  }

  // The thread the click opened or used is the open thread, and its terminal takes the keyboard so
  // the user can type at once. The panel underneath is never on screen, so focus given to it went
  // nowhere and the keyboard stayed where it was. The thread's terminal is made a moment after
  // the thread is chosen, so it is looked for briefly; a user who has moved on meanwhile keeps
  // their place.
  function toThread(paneId) {
    if (!window.TnaiThreads?.show?.(paneId)) return;
    const tryFocus = () => {
      if (String(window.TnaiThreads.selected()) !== String(paneId)) return true;
      const term = window.TnaiThreadView?.term?.();
      if (term?.tnaiPaneId !== paneId || !term.element?.getClientRects().length) return false;

      // A terminal that has just come on screen is kept unseen until it has drawn its newest
      // lines (120's veil, visibility hidden), and focus() on it does nothing until then; so the
      // look goes on until the keyboard is really in it.
      term.focus();
      return term.element.contains(document.activeElement);
    };

    // Looked for every 50 ms, 3 s at most. This wait holds nothing up: the thread is on screen
    // from the call above, and only the keyboard follows. (Waking it from the thread view's own
    // events was tried on 2026-10-13 and gave the keyboard too early, before the terminal had its
    // place on screen.)
    const until = Date.now() + 3000;
    const again = () => {
      if (!tryFocus() && Date.now() < until) setTimeout(again, 50);
    };
    again();
  }

  // The panel says whose command it runs (facts only, nothing guessed):
  // its name is "PowerShell · for <the agent whose terminal showed the link>" (a second one for the
  // same agent gets " 2"), and the clicked command is its task. Only a panel this link opened is
  // named, and only while it still has the name given here: a name the user typed, or their own
  // PowerShell panel, is kept.
  const named = new Map(); // paneId -> the name given here

  function label(paneId, by, cmd, fresh) {
    const all = window.TnaiAgents.sessions(),
      who = by && all.find(s => s.paneId === by)?.name,
      mine = all.find(s => s.paneId === paneId);
    if (cmd) window.TnaiLiveTasks?.record?.(paneId, cmd);
    if (
      !who ||
      !mine ||
      !window.TnaiPaneNames?.rename ||
      !(fresh || named.get(paneId) === mine.name)
    )
      return;
    const base = 'PowerShell · for ' + who,
      taken = new Set(all.filter(s => s.paneId !== paneId).map(s => String(s.name).toLowerCase()));
    let name = base;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = base + ' ' + n;
    named.set(paneId, name);
    if (name !== mine.name) window.TnaiPaneNames.rename(paneId, name, true);
  }
  let opening = false;

  async function open(cmd, from, ws, by) {
    const agents = window.TnaiAgents;
    if (opening || !agents?.open) return;
    opening = true;

    // The panel opens beside the agent whose command was clicked: its workspace is shown first
    // (the panel opened in whichever workspace the Terminal page had
    // last, and the agent was then missing from that page's list). A view with no panel changes
    // nothing.
    if (ws && ws !== window.TnaiActiveTerminalWorkspaceId)
      window.TnaiTerminalWorkspaces?.activate?.(ws);

    // The click answers at once: the Threads page shows now, not after the look for an idle panel
    // (both ways below end on that page, with the thread open). Not when no panel can be added:
    // that refusal never left the page the user is on.
    if (!window.TnaiPaneLimit?.full()) window.TnaiThreads?.open?.();
    try {
      const idle = cmd ? await idleShell(from) : null;
      if (idle) {
        if (!agents.send(idle.paneId, cmd))
          window.toast?.('Could not send the command to the PowerShell thread.');
        label(idle.paneId, by, cmd, false);
        toThread(idle.paneId);
        opening = false;
        return;
      }
    } catch {}

    // subscribed before the panel opens, so PowerShell's first prompt is never missed (as 60 does)
    const tails = new Map();

    // the wait below goes on with the output that holds the prompt, not at its next 50 ms look
    let woke = null;
    const off = cmd
      ? native.pty.onData(({ paneId, data }) => {
          tails.set(
            paneId,
            ((tails.get(paneId) || '') + String(data).replace(ANSI, '')).slice(-512)
          );
          woke?.();
        })
      : () => {};
    try {
      // Terminal page, new panel, project folder as its working folder (pty:start in main)
      const opened = await agents.open('Terminal');
      if (!opened?.ok) {
        window.toast?.(
          'Could not open a PowerShell thread' + (opened?.error ? ': ' + opened.error : '.')
        );
        return;
      }
      label(opened.paneId, by, cmd, true);
      toThread(opened.paneId);
      if (!cmd) return;

      // Send the command once the first prompt is there: whole, with Enter, as one submitted entry
      // (nothing typed visibly).
      const until = Date.now() + 8000;
      while (Date.now() < until && !/>\s*$/.test(tails.get(opened.paneId) || ''))
        await new Promise(r => {
          woke = r;
          setTimeout(r, 50);
        });
      if (/>\s*$/.test(tails.get(opened.paneId) || ''))
        prompts.set(opened.paneId, lastLine(tails.get(opened.paneId)));
      if (
        agents.sessions().find(s => s.paneId === opened.paneId)?.running &&
        !agents.send(opened.paneId, cmd)
      )
        window.toast?.('Could not send the command to the PowerShell thread.');
    } finally {
      off?.();
      opening = false;
    }
  }

  // Tooltip through the app's calm tips (83): a title on the terminal while the pointer is on a
  // link.
  const tipOn = (term, event, cmd) => {
    const el = term.element;
    if (!el) return;
    el.setAttribute('title', tipFor(cmd));
    el.dispatchEvent(
      new PointerEvent('pointerover', {
        bubbles: true,
        pointerType: 'mouse',
        clientX: event?.clientX || 0,
        clientY: event?.clientY || 0,
      })
    );
  };
  const tipOff = term => term.element?.setAttribute('title', '');

  // Rows of one logical line: xterm's soft-wrapped rows, plus a tnai:// link a CLI hard-wrapped
  // itself (Claude Code breaks long words at the terminal width with real newlines and indents the
  // next row): a row that runs to the right edge inside an open link, followed by a row that starts
  // with more link characters.
  const rowText = (buf, y) => buf.getLine(y)?.translateToString(true) || '';

  function openLink(term, buf, y) {
    const t = rowText(buf, y).replace(/\s+$/, ''),
      tok = /(\S+)$/.exec(t)?.[1] || '';
    if (
      t.length < term.cols - 4 ||
      !/^[A-Za-z0-9%._~!*'()-]*$/.test(tok.replace(/^tnai:\/\/powershell\?cmd=/i, ''))
    )
      return false;
    return (
      /^tnai:\/\/powershell\?cmd=/i.test(tok) ||
      (t.trimStart() === tok && y > 0 && openLink(term, buf, y - 1))
    );
  }
  const continues = (term, buf, y) =>
    !!buf.getLine(y)?.isWrapped ||
    (y > 0 && openLink(term, buf, y - 1) && /^\s*[A-Za-z0-9%._~!*'()-]/.test(rowText(buf, y)));

  // The logical line around buffer row `y` (0-based), with each character's cell position.
  function lineAround(term, y) {
    const buf = term.buffer.active;
    let first = y,
      last = y;
    while (first > 0 && continues(term, buf, first)) first--;
    while (last + 1 < buf.length && continues(term, buf, last + 1)) last++;
    let text = '';
    const at = [];
    const cell = buf.getNullCell();
    for (let row = first; row <= last; row++) {
      const line = buf.getLine(row);
      if (!line) continue;
      const hard = row > first && !line.isWrapped,
        // joined by our rule: drop the blanks around the join
        hardEnd = row < last && !buf.getLine(row + 1)?.isWrapped;
      let from = 0,
        to = line.length;
      if (hard) while (from < to && !(line.getCell(from, cell), cell.getChars().trim())) from++;
      if (hardEnd) while (to > from && !(line.getCell(to - 1, cell), cell.getChars().trim())) to--;
      for (let x = from; x < to; x++) {
        line.getCell(x, cell);
        const w = cell.getWidth();
        if (!w) continue;
        const chars = cell.getChars() || ' ';
        for (let i = 0; i < chars.length; i++) {
          text += chars[i];
          at.push({ x: x + 1, y: row + 1, w });
        }
      }
    }
    return { text, at };
  }
  const range = (at, start, end) => ({
    start: { x: at[start].x, y: at[start].y },
    end: { x: at[end - 1].x + at[end - 1].w - 1, y: at[end - 1].y },
  });

  // The words an OSC 8 link shows: the buffer text in its range (1-based cells, as xterm hands it
  // to the link handler). '' when it can't be read.
  function shownText(term, r) {
    const buf = term.buffer?.active;
    if (!buf || !r?.start || !r.end) return '';
    let text = '';
    for (let y = r.start.y; y <= r.end.y; y++)
      text +=
        buf
          .getLine(y - 1)
          ?.translateToString(
            true,
            y === r.start.y ? r.start.x - 1 : 0,
            y === r.end.y ? r.end.x : undefined
          ) || '';
    return text;
  }

  // Whether those words are the command the link runs: the command, `PS> command`, or the tnai://
  // address itself (spaces aside).
  const flat = s => String(s || '').replace(/\s+/g, '');
  const showsCommand = (text, cmd, uri) => {
    const t = flat(text);
    return !!t && (t === flat(cmd) || t === flat('PS>' + cmd) || t === flat(uri));
  };

  function attach(term) {
    if (!term || term.tnaiPowerShellLink) return;
    term.tnaiPowerShellLink = true;

    // The folder the clicked panel works in (its session's), '' for a view with no panel.
    const here = () => {
      const id =
        term.tnaiPaneId || term.element?.closest?.('.terminal-pane[data-pane-id]')?.dataset.paneId;
      return (id && window.TnaiAgents?.sessions?.().find(s => s.paneId === id)?.cwd) || '';
    };
    const self = () =>
      term.tnaiPaneId ||
      term.element?.closest?.('.terminal-pane[data-pane-id]')?.dataset.paneId ||
      '';
    const home = () => {
      const id =
        term.tnaiPaneId || term.element?.closest?.('.terminal-pane[data-pane-id]')?.dataset.paneId;
      return (id && window.TnaiTerminalWorkspaceByPane?.[id]) || '';
    };
    const link = (r, text, cmd) => ({
      range: r,
      text,
      decorations: { pointerCursor: true, underline: true },
      activate: () => {
        tipOff(term);
        open(cmd, here(), home(), self());
      },
      hover: event => tipOn(term, event, cmd),
      leave: () => tipOff(term),
    });
    term.registerLinkProvider({
      provideLinks(lineNumber, callback) {
        if (inShell(term)) return callback(undefined);
        const { text, at } = lineAround(term, lineNumber - 1);
        const ps = PSLINE.exec(text);
        if (!ps && !/powershell/i.test(text)) return callback(undefined);
        const links = [],
          taken = [];
        let cmd = '';
        for (const m of text.matchAll(LINK)) {
          const uri = m[0].replace(/[.!]+$/, ''),
            c = commandOf(uri);
          if (c === null) continue;
          if (!cmd) cmd = c;
          taken.push([m.index, m.index + m[0].length]);
          links.push(link(range(at, m.index, m.index + uri.length), uri, c));
        }
        if (ps) {
          // `PS> command`: the command itself is the link
          const c = ps[2].replace(/[ -]+/g, ' ').trim().slice(0, 4000);
          links.push(link(range(at, ps[1].length, ps[1].length + ps[2].length), ps[2], c));
          taken.push([0, text.length]);
        }
        for (const m of text.matchAll(WORD)) {
          if (taken.some(([a, b]) => m.index < b && m.index + m[0].length > a)) continue;
          links.push(link(range(at, m.index, m.index + m[0].length), m[0], cmd));
        }
        callback(
          links.length
            ? links.filter(l => l.range.start.y <= lineNumber && l.range.end.y >= lineNumber)
            : undefined
        );
      },
    });

    // OSC 8 hyperlinks: tnai://powershell opens the panel; http(s) keeps xterm's default (confirm,
    // then open with no opener); anything else is ignored.
    term.options.linkHandler = {
      allowNonHttpProtocols: true,
      activate(event, uri, range) {
        const cmd = commandOf(uri);
        if (cmd !== null) {
          tipOff(term);
          if (inShell(term)) return;

          // An OSC 8 link shows whatever words its writer chose ("open the docs") over the command
          // it runs. Unless those words are the command itself (or the tnai:// address), the
          // command is shown and the user says yes first (a `PS> command` line
          // and a plain tnai:// link show their command and keep running on the one click).
          if (
            cmd &&
            !showsCommand(shownText(term, range), cmd, uri) &&
            !confirm(
              'Run this command in a PowerShell thread?\n\n' +
                cmd +
                '\n\nThe link you clicked shows other words than this command.'
            )
          )
            return;
          open(cmd, here(), home(), self());
          return;
        }
        if (!/^https?:\/\//i.test(uri)) return;
        if (
          !confirm(
            `Do you want to navigate to ${uri}?\n\nWARNING: This link could potentially be dangerous`
          )
        )
          return;
        const w = window.open();
        if (w) {
          try {
            w.opener = null;
          } catch {}
          w.location.href = uri;
        } else console.warn('Opening link blocked as opener could not be cleared');
      },
      hover(event, uri) {
        const c = commandOf(uri);
        if (c !== null && !inShell(term)) tipOn(term, event, c);
      },
      leave(event, uri) {
        if (commandOf(uri) !== null) tipOff(term);
      },
    };
  }

  // run: a command the user pressed a button for (Usage & accounts › Install, 15) opens the same
  // way a clicked "PS>" command does.
  window.TnaiPowerShellLink = {
    attach,
    commandOf,
    showsCommand,
    label,
    run: cmd => open(String(cmd || ''), null, null, null),
  };
})();
