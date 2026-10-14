/*
 * Technically Not · 60-bell-notices.js — Desktop app: turns real checks into top-bar bell notices
 * (TnaiNextActions.notify, 51), each pushed, never polled here:
 * - Technically Not update: desktop/updater.js state (`update:state`) says a new version is
 * available / downloaded, and "Notify me" is on (Settings › Updates); gone once current.
 * - Agent CLI updates: desktop/cli-updates.js (`cli-updates:state`; npm registry vs `<cli>
 * --version`, 90 s after start and every 6 h) per installed CLI, with its own update command.
 * - A skill an agent saved (`skills:saved` from desktop/skill-service.js): one notice per skill
 * until the user opened it on the Skills page (18).
 */
(() => {
  const native = window.tnaiNative,
    bell = window.TnaiNextActions;
  if (!native || !bell?.notify) return;

  // Technically Not itself: the bell is the only place an update shows (36 keeps Settings ›
  // Updates); it stays until it is handled. Every update notice says only 'current → new' and
  // carries the Update button itself: no dialog to click into.
  if (native.update) {
    const onUpdate = s => {
      if (!s) return;
      const name =
        'Technically Not ' + s.next + (s.nextBuild ? ' (build ' + s.nextBuild + ')' : '');
      if (!['available', 'downloading', 'ready'].includes(s.status)) {
        if (['current', 'unconfigured', 'dev', 'off'].includes(s.status))
          bell.unnotify('tnai-update');
        return;
      }
      if (s.prefs?.notify === false) return bell.unnotify('tnai-update');
      const ready = s.status === 'ready',
        downloading = s.status === 'downloading';
      bell.notify({
        key: 'tnai-update',
        source: 'Technically Not',
        tag: 'Update',
        k: 'update',
        title:
          name +
          (ready
            ? ' is ready'
            : downloading
              ? ' is downloading' + (s.percent ? ' · ' + s.percent + '%' : '')
              : ' is available'),
        text: 'v' + s.version + ' → v' + s.next,
        action: downloading
          ? null
          : {
              label: ready ? 'Restart to update' : 'Update',
              run: () =>
                window.TnaiUpdates?.updateNow
                  ? window.TnaiUpdates.updateNow()
                  : window.TnaiSettings?.open?.('updates'),
            },
      });
    };
    native.update.onState(onUpdate);
    native.update
      .state()
      .then(onUpdate)
      .catch(() => {});
  }

  // Installed agent CLIs with a newer release. Update runs the CLI's own update command in a new
  // PowerShell panel on the Terminal page (visible, so its output and any prompt stay in front of
  // the user). Windows locks a running CLI's files, so that CLI's idle panels are stopped first and
  // resumed (same conversation) afterwards; while one is working the update waits. A printed end
  // marker tells Technically Not it finished (independent of the user's prompt style), then
  // cli-updates.js checks again so the notice clears. The panel was opened only to run the update,
  // so it closes itself when the update succeeds; on a failure or no end marker it stays open with
  // the output.
  if (native.cliUpdates) {
    let shown = new Set(),
      last = [];
    const updating = new Set();
    const ANSI =
        /\x1b\[[0-?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Za-z0-9]|\x1b[=>78]/g,
      DONE = /Technically Not update finished - exit code (-?\d+)/;
    const agents = () => window.TnaiAgents;
    const runUpdate = async u => {
      if (updating.has(u.id) || !agents()) return;
      const mine = agents()
        .sessions()
        .filter(s => s.agent === u.id && (s.running || s.status === 'starting'));
      const busy = mine.filter(s => ['working', 'starting'].includes(s.status));
      if (busy.length)
        return window.toast?.(
          u.id +
            ' is working in ' +
            busy.length +
            (busy.length === 1 ? ' panel' : ' panels') +
            '. Update when it finishes' +
            (window.tnaiPlatform.win ? ': Windows can’t replace a CLI that is running.' : '.')
        );
      updating.add(u.id);
      onCli({ updates: last });

      // subscribed before the panel opens, so PowerShell's first prompt is never missed
      const tails = new Map();
      let paneId = '',
        sent = false,
        finished = null;
      const off = native.pty.onData(({ paneId: id, data }) => {
        // every agent's output passes here: only the update panel's is read once it is known
        if (paneId && id !== paneId) return;
        const tail = ((tails.get(id) || '') + String(data).replace(ANSI, '')).slice(-1024);
        tails.set(id, tail);
        if (sent && id === paneId && DONE.test(tail)) finished?.(Number(tail.match(DONE)[1]));
      });
      const end = async code => {
        off();
        updating.delete(u.id);
        for (const s of mine)
          await agents()
            .restart(s.paneId, { resume: true })
            .catch(() => {});
        if (mine.length)
          window.toast?.(
            'Restarted ' +
              mine.length +
              ' ' +
              u.id +
              (mine.length === 1 ? ' panel' : ' panels') +
              ' on the updated version, same conversation.'
          );
        if (code === 0)
          document
            .querySelector(
              '.terminal-pane[data-pane-id="' +
                CSS.escape(paneId) +
                '"] .terminal-pane-tools button[title="Close terminal"]'
            )
            ?.click();
        else if (code !== undefined)
          window.toast?.(
            u.id + ' update ended with exit code ' + code + '. Its output is in the Terminal panel.'
          );
        await native.cliUpdates
          .check?.()
          .then(onCli)
          .catch(() => onCli({ updates: last }));
      };
      for (const s of mine) await agents().stop(s.paneId);
      const opened = await agents().open('Terminal');
      if (!opened?.ok) {
        window.toast?.('Could not open a thread' + (opened?.error ? ': ' + opened.error : '.'));
        return end();
      }
      paneId = opened.paneId;

      // PowerShell on Windows, a POSIX shell (zsh / bash) on macOS and Linux
      const win = window.tnaiPlatform.win;

      // Wait for the shell's first prompt so the command isn't typed into a console that is still
      // starting.
      const until = Date.now() + 8000;
      while (Date.now() < until && !(win ? />\s*$/ : /[$#%>❯]\s*$/).test(tails.get(paneId) || ''))
        await new Promise(r => setTimeout(r, 50));
      tails.set(paneId, '');
      const code = new Promise(resolve => {
        finished = resolve;
        setTimeout(() => resolve(undefined), 15 * 60 * 1000);
      });
      sent = true;
      agents().send(
        paneId,
        u.command +
          (win
            ? "; Write-Host ('Technically Not update finished - exit code ' + $LASTEXITCODE)"
            : '; printf \'Technically Not update finished - exit code %s\\n\' "$?"')
      );
      end(await code);
    };

    function onCli(s) {
      last = s?.updates || [];
      const now = new Set();
      for (const u of last) {
        now.add(u.id);
        const busy = updating.has(u.id);
        bell.notify({
          key: 'cli:' + u.id,
          source: u.id,
          tag: 'Update',
          k: 'update',
          title: u.id + ' ' + u.latest + (busy ? ' is updating…' : ' is available'),
          text: u.installed + ' → ' + u.latest,
          action: busy ? null : { label: 'Update', run: () => runUpdate(u) },
        });
      }
      for (const id of shown) if (!now.has(id)) bell.unnotify('cli:' + id);
      shown = now;
    }
    native.cliUpdates.onState(onCli);
    native.cliUpdates
      .state()
      .then(s => s?.checkedAt && onCli(s))
      .catch(() => {});
  }

  // A skill an agent saved (`tnai skill save`; desktop/skill-service.js pushes `skills:saved`) is
  // on for every session at once, so the user is told:
  // one notice per skill until its details were opened on the Skills page, which also
  // carries the "New · agent-written" mark (18 keeps which ones are unopened, across restarts).
  // Open goes to that skill.
  const ui = window.TnaiSkillsUI,
    lib = window.TnaiSkills;
  if (native.skills?.onSaved && ui?.agentSaved && lib?.onChange) {
    let told = new Set();
    const openIt = id => {
      document.querySelector('.side-item[data-ai-tool="skills"]')?.click();
      ui.select(id);
    };
    const sync = () => {
      const now = new Set();
      for (const k of lib.list() || []) {
        if (!ui.isAgentNew(k)) continue;
        now.add(k.id);
        bell.notify({
          key: 'skill-saved:' + k.id,
          source: 'Skills',
          tag: 'Skill',
          k: 'next',
          title: 'An agent saved the skill “' + k.name + '”',
          text:
            (k.everywhere ? 'It loads in every new session. ' : '') +
            'Open it to read it, switch it off or remove it.',
          action: { label: 'Open', run: () => openIt(k.id) },
        });
      }
      for (const id of told) if (!now.has(id)) bell.unnotify('skill-saved:' + id);
      told = now;
    };
    lib.onChange(sync);
    window.addEventListener('tnai:agent-skill-opened', sync);
    native.skills.onSaved(s => {
      if (!s?.id) return;

      // saved again: a notice the user closed for the earlier version comes back
      bell.unnotify('skill-saved:' + s.id);
      ui.agentSaved(s.id);
      Promise.resolve(lib.refresh()).catch(() => {}); // the library list now holds it → sync
    });
    sync();
  }
})();
